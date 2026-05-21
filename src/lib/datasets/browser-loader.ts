"use client";

import type { MachineTier, Recipe, ResourceAmount } from "@/lib/model/types";
import type {
  DatasetResourceIndexEntry,
  DatasetVersion,
  RecipeDataset,
  RecipeSummary,
} from "./types";

type TierFilter = "all" | Exclude<MachineTier, "DEMO">;

export interface RecipeDatasetQuery {
  query: string;
  resource?: Pick<ResourceAmount, "kind" | "id">;
  mode: "recipes" | "uses";
  recipeMap?: string;
  maxTier: TierFilter;
  offset: number;
  limit: number;
}

export interface RecipeDatasetQueryResult {
  recipes: RecipeSummary[];
  total: number;
  recipeMaps: string[];
  recipeMapIcons?: Record<string, DatasetResourceIndexEntry>;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface RecipeDatasetResourceQuery {
  query: string;
  offset: number;
  limit: number;
}

export interface RecipeDatasetResourceQueryResult {
  resources: DatasetResourceIndexEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export async function initRecipeDatasetVersion(
  _manifestUrl: string,
  version: DatasetVersion,
): Promise<RecipeDataset> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/catalog`,
    window.location.origin,
  );
  addDatasetCacheKey(url, version);
  return fetchJson<RecipeDataset>(url.toString());
}

export async function getRecipeDatasetRecipe(
  _manifestUrl: string,
  version: DatasetVersion,
  recipeId: string,
): Promise<Recipe> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/recipes/${encodeURIComponent(recipeId)}`,
    window.location.origin,
  );
  addDatasetCacheKey(url, version);
  return fetchJson<Recipe>(url.toString());
}

export async function queryRecipeDatasetRecipes(
  _manifestUrl: string,
  version: DatasetVersion,
  query: RecipeDatasetQuery,
): Promise<RecipeDatasetQueryResult> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/recipes`,
    window.location.origin,
  );
  url.searchParams.set("query", query.query);
  url.searchParams.set("mode", query.mode);
  url.searchParams.set("maxTier", query.maxTier);
  url.searchParams.set("offset", String(query.offset));
  url.searchParams.set("limit", String(query.limit));
  addDatasetCacheKey(url, version);
  if (query.recipeMap) {
    url.searchParams.set("recipeMap", query.recipeMap);
  }
  if (query.resource) {
    url.searchParams.set("resourceKind", query.resource.kind);
    url.searchParams.set("resourceId", query.resource.id);
  }

  return fetchJson<RecipeDatasetQueryResult>(url.toString());
}

export async function queryRecipeDatasetResources(
  _manifestUrl: string,
  version: DatasetVersion,
  query: RecipeDatasetResourceQuery,
): Promise<RecipeDatasetResourceQueryResult> {
  const url = new URL(
    `/api/datasets/${encodeURIComponent(version.id)}/resources`,
    window.location.origin,
  );
  url.searchParams.set("query", query.query);
  url.searchParams.set("offset", String(query.offset));
  url.searchParams.set("limit", String(query.limit));
  addDatasetCacheKey(url, version);

  return fetchJson<RecipeDatasetResourceQueryResult>(url.toString());
}

export const loadRecipeDatasetVersion = initRecipeDatasetVersion;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  const payload = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    throw new Error(
      typeof payload === "object" && payload && "error" in payload && payload.error
        ? payload.error
        : `Request failed (${response.status}).`,
    );
  }

  return payload as T;
}

function addDatasetCacheKey(url: URL, version: DatasetVersion) {
  url.searchParams.set("datasetHash", version.checksumSha256 ?? version.publishedAt ?? version.id);
}
