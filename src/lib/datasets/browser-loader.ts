"use client";

import type { MachineTier, Recipe, ResourceAmount } from "@/lib/model/types";
import { resolveDatasetUrl } from "./remote";
import type { DatasetVersion, RecipeDataset, RecipeSummary } from "./types";

type TierFilter = "all" | Exclude<MachineTier, "DEMO">;

export interface RecipeDatasetQuery {
  query: string;
  resource?: Pick<ResourceAmount, "kind" | "id">;
  mode: "recipes" | "uses";
  recipeMap?: string;
  maxTier: TierFilter;
  limit: number;
}

export interface RecipeDatasetQueryResult {
  recipes: RecipeSummary[];
  total: number;
  recipeMaps: string[];
}

type DatasetSummary = Omit<RecipeDataset, "recipes"> & {
  recipeCount: number;
  recipes: [];
};

type WorkerRequest =
  | {
      id: number;
      type: "init";
      datasetUrl: string;
      expectedVersionId: string;
      cacheKey: string;
    }
  | ({
      id: number;
      type: "queryRecipes";
      datasetUrl: string;
      expectedVersionId: string;
      cacheKey: string;
    } & RecipeDatasetQuery)
  | {
      id: number;
      type: "getRecipe";
      datasetUrl: string;
      expectedVersionId: string;
      cacheKey: string;
      recipeId: string;
    };

type WorkerResponse =
  | {
      id: number;
      ok: true;
      type: "init";
      summary: DatasetSummary;
    }
  | {
      id: number;
      ok: true;
      type: "queryRecipes";
      recipes: RecipeSummary[];
      total: number;
      recipeMaps: string[];
    }
  | {
      id: number;
      ok: true;
      type: "getRecipe";
      recipe: Recipe;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

type WorkerRequestInput = WorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

let nextWorkerRequestId = 1;
let datasetWorker: Worker | undefined;

export async function initRecipeDatasetVersion(
  manifestUrl: string,
  version: DatasetVersion,
): Promise<RecipeDataset> {
  const datasetUrl = getVersionedDatasetUrl(manifestUrl, version);
  const cacheKey = getDatasetCacheKey(version);
  const response = await sendDatasetWorkerRequest({
    type: "init",
    datasetUrl,
    expectedVersionId: version.id,
    cacheKey,
  });

  if (response.type !== "init") {
    throw new Error("Dataset worker returned an unexpected response.");
  }

  return response.summary;
}

export async function getRecipeDatasetRecipe(
  manifestUrl: string,
  version: DatasetVersion,
  recipeId: string,
): Promise<Recipe> {
  const datasetUrl = getVersionedDatasetUrl(manifestUrl, version);
  const cacheKey = getDatasetCacheKey(version);
  const response = await sendDatasetWorkerRequest({
    type: "getRecipe",
    datasetUrl,
    expectedVersionId: version.id,
    cacheKey,
    recipeId,
  });

  if (response.type !== "getRecipe") {
    throw new Error("Dataset worker returned an unexpected response.");
  }

  return response.recipe;
}

export async function queryRecipeDatasetRecipes(
  manifestUrl: string,
  version: DatasetVersion,
  query: RecipeDatasetQuery,
): Promise<RecipeDatasetQueryResult> {
  const datasetUrl = getVersionedDatasetUrl(manifestUrl, version);
  const cacheKey = getDatasetCacheKey(version);
  const response = await sendDatasetWorkerRequest({
    type: "queryRecipes",
    datasetUrl,
    expectedVersionId: version.id,
    cacheKey,
    ...query,
  });

  if (response.type !== "queryRecipes") {
    throw new Error("Dataset worker returned an unexpected response.");
  }

  return {
    recipes: response.recipes,
    total: response.total,
    recipeMaps: response.recipeMaps,
  };
}

export const loadRecipeDatasetVersion = initRecipeDatasetVersion;

function getVersionedDatasetUrl(manifestUrl: string, version: DatasetVersion): string {
  const datasetUrl = new URL(resolveDatasetUrl(manifestUrl, version.recipeDatasetPath));
  datasetUrl.searchParams.set(
    "datasetVersion",
    version.checksumSha256 ?? version.publishedAt ?? version.id,
  );
  return datasetUrl.toString();
}

function sendDatasetWorkerRequest(
  request: WorkerRequestInput,
): Promise<Extract<WorkerResponse, { ok: true }>> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(new Error("Web Workers are not available."));
      return;
    }

    const worker = getDatasetWorker();
    const id = nextWorkerRequestId;
    nextWorkerRequestId += 1;

    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) {
        return;
      }

      cleanup();
      if (event.data.ok) {
        resolve(event.data);
      } else {
        reject(new Error(event.data.error));
      }
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      datasetWorker?.terminate();
      datasetWorker = undefined;
      reject(new Error(event.message || "Dataset worker failed."));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ ...request, id } as WorkerRequest);
  });
}

function getDatasetWorker(): Worker {
  if (!datasetWorker) {
    datasetWorker = new Worker(new URL("../../workers/dataset-loader.worker.ts", import.meta.url), {
      type: "module",
    });
  }

  return datasetWorker;
}

function getDatasetCacheKey(version: DatasetVersion): string {
  return [
    "worker-v5",
    version.id,
    version.recipeDatasetPath,
    version.checksumSha256,
    version.sourceInfo.gitCommit,
    version.publishedAt,
  ]
    .filter(Boolean)
    .join("|");
}
