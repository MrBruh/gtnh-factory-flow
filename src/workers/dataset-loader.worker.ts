import { parseRecipeDatasetJson } from "@/lib/import-export";
import { enrichDatasetRecipes } from "@/lib/datasets/enrich";
import type { DatasetResourceIndexEntry, RecipeDataset } from "@/lib/datasets";
import { getRecipePowerTier, GT_VOLTAGE_TIERS } from "@/lib/model";
import type { MachineTier, Recipe, ResourceAmount } from "@/lib/model/types";

type TierFilter = "all" | Exclude<MachineTier, "DEMO">;

type WorkerRequest =
  | {
      id: number;
      type: "init";
      datasetUrl: string;
      expectedVersionId: string;
      cacheKey: string;
    }
  | {
      id: number;
      type: "queryRecipes";
      datasetUrl: string;
      expectedVersionId: string;
      cacheKey: string;
      query: string;
      resource?: Pick<ResourceAmount, "kind" | "id">;
      mode: "recipes" | "uses";
      recipeMap?: string;
      maxTier: TierFilter;
      limit: number;
    };

type DatasetSummary = Omit<RecipeDataset, "recipes"> & {
  recipeCount: number;
  recipes: [];
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
      recipes: Recipe[];
      total: number;
      recipeMaps: string[];
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

let loadedDataset: RecipeDataset | undefined;
let loadedDatasetCacheKey: string | undefined;
let loadingDataset:
  | {
      cacheKey: string;
      promise: Promise<RecipeDataset>;
    }
  | undefined;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void handleRequest(event.data);
};

async function handleRequest(request: WorkerRequest) {
  try {
    if (request.type === "init") {
      loadedDataset = await ensureDataset(
        request.datasetUrl,
        request.expectedVersionId,
        request.cacheKey,
      );
      postMessage({
        id: request.id,
        ok: true,
        type: "init",
        summary: summarizeDataset(loadedDataset),
      } satisfies WorkerResponse);
      return;
    }

    loadedDataset = await ensureDataset(request.datasetUrl, request.expectedVersionId, request.cacheKey);

    const result = queryRecipes(loadedDataset.recipes, request);
    postMessage({
      id: request.id,
      ok: true,
      type: "queryRecipes",
      recipes: result.recipes,
      total: result.total,
      recipeMaps: result.recipeMaps,
    } satisfies WorkerResponse);
  } catch (error) {
    postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "Dataset worker request failed.",
    } satisfies WorkerResponse);
  }
}

async function ensureDataset(
  datasetUrl: string,
  expectedVersionId: string,
  cacheKey: string,
): Promise<RecipeDataset> {
  if (loadedDataset?.datasetVersionId === expectedVersionId && loadedDatasetCacheKey === cacheKey) {
    return loadedDataset;
  }

  if (loadingDataset?.cacheKey === cacheKey) {
    return loadingDataset.promise;
  }

  loadingDataset = {
    cacheKey,
    promise: loadDataset(datasetUrl, expectedVersionId, cacheKey),
  };

  try {
    const dataset = await loadingDataset.promise;
    loadedDataset = dataset;
    loadedDatasetCacheKey = cacheKey;
    return dataset;
  } finally {
    if (loadingDataset?.cacheKey === cacheKey) {
      loadingDataset = undefined;
    }
  }
}

async function loadDataset(
  datasetUrl: string,
  expectedVersionId: string,
  cacheKey: string,
): Promise<RecipeDataset> {
  const cached = await readCachedDataset(cacheKey).catch(() => undefined);
  if (cached?.datasetVersionId === expectedVersionId) {
    return cached;
  }

  const response = await fetch(datasetUrl, {
    cache: "force-cache",
    headers: {
      Accept: "application/json, application/gzip, application/octet-stream",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load dataset (${response.status}).`);
  }

  const text = await readDatasetResponseText(response, datasetUrl);
  const dataset = enrichDatasetRecipes(parseRecipeDatasetJson(text));

  if (dataset.datasetVersionId !== expectedVersionId) {
    throw new Error(
      `Dataset id mismatch: manifest expected ${expectedVersionId}, file contains ${dataset.datasetVersionId}.`,
    );
  }

  await writeCachedDataset(cacheKey, dataset).catch(() => undefined);
  return dataset;
}

function summarizeDataset(dataset: RecipeDataset): DatasetSummary {
  return {
    ...dataset,
    recipes: [],
    recipeCount: dataset.recipes.length,
    resourceIndex: dataset.resourceIndex ?? buildDatasetResourceIndex(dataset),
  };
}

function queryRecipes(
  recipes: Recipe[],
  request: Extract<WorkerRequest, { type: "queryRecipes" }>,
): { recipes: Recipe[]; total: number; recipeMaps: string[] } {
  const query = normalizeText(request.query);
  const activeMap = request.recipeMap || undefined;
  const resultsWithIcons: Array<{ recipe: Recipe; iconScore: number }> = [];
  const resultsWithoutIcons: Recipe[] = [];
  const recipeMaps = new Set<string>();
  let total = 0;

  for (const recipe of recipes) {
    const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
    if (request.resource && !recipeHasResource(recipe, request.resource, request.mode)) {
      continue;
    }

    if (!recipeMatchesTier(recipe, request.maxTier)) {
      continue;
    }

    if (!request.resource && query && !recipeMatchesQuery(recipe, query)) {
      continue;
    }

    if (recipeMap) {
      recipeMaps.add(recipeMap);
    }

    if (activeMap && recipeMap !== activeMap) {
      continue;
    }

    total += 1;
    if (resultsWithIcons.length + resultsWithoutIcons.length >= request.limit * 2) {
      continue;
    }

    const iconScore = recipeIconScore(recipe);
    if (iconScore > 0) {
      resultsWithIcons.push({ recipe, iconScore });
    } else {
      resultsWithoutIcons.push(recipe);
    }
  }

  return {
    recipes: [
      ...resultsWithIcons
        .sort((left, right) => right.iconScore - left.iconScore)
        .map((entry) => entry.recipe),
      ...resultsWithoutIcons,
    ].slice(0, request.limit),
    total,
    recipeMaps: [...recipeMaps].sort((a, b) => a.localeCompare(b)),
  };
}

async function readDatasetResponseText(response: Response, datasetUrl: string): Promise<string> {
  if (!datasetUrl.endsWith(".gz")) {
    return response.text();
  }

  if (!response.body || !("DecompressionStream" in globalThis)) {
    throw new Error("This browser cannot decompress GTNH dataset files.");
  }

  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function buildDatasetResourceIndex(dataset: RecipeDataset): DatasetResourceIndexEntry[] {
  const resourcesByKey = new Map<string, RecipeDataset["resources"][number]>(
    dataset.resources.map((resource) => [`${resource.kind}:${resource.id}`, resource] as const),
  );
  const index = new Map<string, DatasetResourceIndexEntry>();

  for (const recipe of dataset.recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) {
      const key = `${resource.kind}:${resource.id}`;
      const existing = index.get(key);
      const datasetResource = resourcesByKey.get(key);
      if (existing) {
        existing.recipeCount += 1;
      } else {
        index.set(key, {
          kind: resource.kind,
          id: resource.id,
          displayName: resource.displayName ?? datasetResource?.displayName,
          iconPath: resource.iconPath ?? datasetResource?.iconPath,
          recipeCount: 1,
        });
      }
    }
  }

  return [...index.values()];
}

function recipeHasResource(
  recipe: Recipe,
  resource: Pick<ResourceAmount, "kind" | "id">,
  mode: "recipes" | "uses",
): boolean {
  const resources = mode === "recipes" ? recipe.outputs : recipe.inputs;
  return resources.some((entry) => entry.kind === resource.kind && entry.id === resource.id);
}

function recipeMatchesQuery(recipe: Recipe, query: string): boolean {
  return [
    recipe.name,
    recipe.machineType,
    recipe.source?.recipeMap,
    recipe.source?.rawRecipeId,
    ...recipe.inputs.map((input) => input.displayName ?? input.id),
    ...recipe.outputs.map((output) => output.displayName ?? output.id),
  ]
    .filter(Boolean)
    .some((value) => normalizeText(value ?? "").includes(query));
}

function recipeMatchesTier(recipe: Recipe, maxTier: TierFilter) {
  if (maxTier === "all") {
    return true;
  }

  const maxIndex = getTierIndex(maxTier);
  const recipeIndex = getTierIndex(getRecipeTier(recipe));
  return recipeIndex <= maxIndex;
}

function getRecipeTier(recipe: Recipe): Exclude<MachineTier, "DEMO"> {
  const declaredTier = recipe.minimumTier;
  if (isKnownTier(declaredTier)) {
    return declaredTier;
  }

  return getRecipePowerTier(recipe);
}

function isKnownTier(tier: string): tier is Exclude<MachineTier, "DEMO"> {
  return GT_VOLTAGE_TIERS.some((entry) => entry.tier === tier);
}

function getTierIndex(tier: Exclude<MachineTier, "DEMO">) {
  const index = GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === tier);
  return index === -1 ? GT_VOLTAGE_TIERS.length - 1 : index;
}

function recipeIconScore(recipe: Recipe): number {
  return [...recipe.inputs, ...recipe.outputs].reduce(
    (score, resource) => score + (resource.iconPath ? 1 : 0),
    0,
  );
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

const DB_NAME = "gtnh-factory-flow-worker";
const DB_VERSION = 1;
const DATASET_STORE = "recipe-datasets";

async function readCachedDataset(cacheKey: string): Promise<RecipeDataset | undefined> {
  const db = await openDatasetCache();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DATASET_STORE, "readonly").objectStore(DATASET_STORE).get(cacheKey);
    request.onsuccess = () => resolve(request.result as RecipeDataset | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not read dataset cache."));
  });
}

async function writeCachedDataset(cacheKey: string, dataset: RecipeDataset): Promise<void> {
  const db = await openDatasetCache();
  await new Promise<void>((resolve, reject) => {
    const request = db
      .transaction(DATASET_STORE, "readwrite")
      .objectStore(DATASET_STORE)
      .put(dataset, cacheKey);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not write dataset cache."));
  });
}

function openDatasetCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DATASET_STORE)) {
        db.createObjectStore(DATASET_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open dataset cache."));
  });
}
