import { parseRecipeDatasetJson } from "@/lib/import-export";
import { enrichDatasetRecipes } from "@/lib/datasets/enrich";
import type { DatasetResourceIndexEntry, RecipeDataset, RecipeSummary } from "@/lib/datasets";
import { getRecipePowerTier, GT_VOLTAGE_TIERS } from "@/lib/model";
import { getNeiRecipeLayout } from "@/lib/nei/layout";
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
    }
  | {
      id: number;
      type: "getRecipe";
      datasetUrl: string;
      expectedVersionId: string;
      cacheKey: string;
      recipeId: string;
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

interface CachedQueryResult {
  recipeIndexes: number[];
  total: number;
  recipeMaps: string[];
}

interface RecipeWorkerIndexes {
  cacheKey: string;
  allRecipeIndexes: number[];
  recipeIndexesByResource: Map<string, number[]>;
  recipeMaps: string[];
  tierIndexes: number[];
  searchText: string[];
  iconScores: number[];
  queryCache: Map<string, CachedQueryResult>;
}

const MAX_QUERY_CACHE_ENTRIES = 160;

let loadedDataset: RecipeDataset | undefined;
let loadedDatasetCacheKey: string | undefined;
let loadedIndexes: RecipeWorkerIndexes | undefined;
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
      ensureRecipeIndexes(loadedDataset, request.cacheKey);
      postMessage({
        id: request.id,
        ok: true,
        type: "init",
        summary: summarizeDataset(loadedDataset),
      } satisfies WorkerResponse);
      return;
    }

    loadedDataset = await ensureDataset(
      request.datasetUrl,
      request.expectedVersionId,
      request.cacheKey,
    );
    ensureRecipeIndexes(loadedDataset, request.cacheKey);

    if (request.type === "getRecipe") {
      const recipe = loadedDataset.recipes.find((entry) => entry.id === request.recipeId);
      if (!recipe) {
        throw new Error(`Recipe ${request.recipeId} was not found in dataset.`);
      }
      postMessage({
        id: request.id,
        ok: true,
        type: "getRecipe",
        recipe,
      } satisfies WorkerResponse);
      return;
    }

    const result = queryRecipes(loadedDataset, request);
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
    loadedIndexes = undefined;
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
  if (cached?.datasetVersionId === expectedVersionId && hasUsableIconAtlas(cached)) {
    return cached;
  }

  const response = await fetch(datasetUrl, {
    cache: "no-store",
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

function hasUsableIconAtlas(dataset: RecipeDataset): boolean {
  const indexedResources = dataset.resourceIndex ?? dataset.resources;
  return indexedResources.some((resource) => Boolean(resource.iconAtlas));
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
  dataset: RecipeDataset,
  request: Extract<WorkerRequest, { type: "queryRecipes" }>,
): { recipes: RecipeSummary[]; total: number; recipeMaps: string[] } {
  const indexes = ensureRecipeIndexes(dataset, request.cacheKey);
  const cacheKey = getQueryCacheKey(request);
  const cached = indexes.queryCache.get(cacheKey);
  if (cached) {
    indexes.queryCache.delete(cacheKey);
    indexes.queryCache.set(cacheKey, cached);
    return materializeQueryResult(dataset, cached);
  }

  const query = normalizeText(request.query);
  const activeMap = request.recipeMap || undefined;
  const resultsWithIcons: Array<{ recipeIndex: number; iconScore: number }> = [];
  const resultsWithoutIcons: number[] = [];
  const recipeMaps = new Set<string>();
  const candidates = getCandidateRecipeIndexes(indexes, request);
  const eligibleRecipeIndexes: number[] = [];
  let total = 0;

  for (const recipeIndex of candidates) {
    if (!recipeMatchesTierIndex(indexes, recipeIndex, request.maxTier)) {
      continue;
    }

    if (!request.resource && query && !indexes.searchText[recipeIndex]?.includes(query)) {
      continue;
    }

    const recipeMap = indexes.recipeMaps[recipeIndex];
    if (recipeMap) {
      recipeMaps.add(recipeMap);
    }

    eligibleRecipeIndexes.push(recipeIndex);
  }

  const sortedRecipeMaps = [...recipeMaps].sort((a, b) => a.localeCompare(b));
  const effectiveMap = activeMap ?? (request.resource ? sortedRecipeMaps[0] : undefined);

  for (const recipeIndex of eligibleRecipeIndexes) {
    if (effectiveMap && indexes.recipeMaps[recipeIndex] !== effectiveMap) {
      continue;
    }

    total += 1;
    if (resultsWithIcons.length + resultsWithoutIcons.length >= request.limit * 2) {
      continue;
    }

    const iconScore = indexes.iconScores[recipeIndex] ?? 0;
    if (iconScore > 0) {
      resultsWithIcons.push({ recipeIndex, iconScore });
    } else {
      resultsWithoutIcons.push(recipeIndex);
    }
  }

  const result: CachedQueryResult = {
    recipeIndexes: [
      ...resultsWithIcons
        .sort((left, right) => right.iconScore - left.iconScore)
        .map((entry) => entry.recipeIndex),
      ...resultsWithoutIcons,
    ].slice(0, request.limit),
    total,
    recipeMaps: sortedRecipeMaps,
  };
  rememberQuery(indexes, cacheKey, result);
  return materializeQueryResult(dataset, result);
}

function materializeQueryResult(
  dataset: RecipeDataset,
  result: CachedQueryResult,
): { recipes: RecipeSummary[]; total: number; recipeMaps: string[] } {
  return {
    recipes: result.recipeIndexes
      .map((recipeIndex) => dataset.recipes[recipeIndex])
      .filter((recipe): recipe is Recipe => Boolean(recipe))
      .map(summarizeRecipe),
    total: result.total,
    recipeMaps: result.recipeMaps,
  };
}

function summarizeRecipe(recipe: Recipe): RecipeSummary {
  const layout = getNeiRecipeLayout(recipe);
  const visibleInputs = new Set<number>();
  const visibleOutputs = new Set<number>();

  for (const slot of layout.slots) {
    if (slot.side === "input") {
      visibleInputs.add(slot.resourceIndex);
    } else {
      visibleOutputs.add(slot.resourceIndex);
    }
  }

  return {
    id: recipe.id,
    name: recipe.name,
    recipeMap: recipe.source?.recipeMap ?? recipe.machineType,
    machineType: recipe.machineType,
    minimumTier: recipe.minimumTier,
    durationTicks: recipe.durationTicks,
    eut: recipe.eut,
    programmedCircuit: recipe.programmedCircuit,
    inputs: recipe.inputs.filter((_, index) => visibleInputs.has(index)),
    outputs: recipe.outputs.filter((_, index) => visibleOutputs.has(index)),
    source: recipe.source,
    nei: recipe.nei,
    slots: layout.slots.map((slot) => ({
      side: slot.side,
      kind: slot.kind,
      resourceIndex: slot.resourceIndex,
      x: slot.x,
      y: slot.y,
    })),
  };
}

function rememberQuery(indexes: RecipeWorkerIndexes, key: string, result: CachedQueryResult) {
  indexes.queryCache.set(key, result);
  if (indexes.queryCache.size <= MAX_QUERY_CACHE_ENTRIES) {
    return;
  }

  const oldestKey = indexes.queryCache.keys().next().value;
  if (oldestKey) {
    indexes.queryCache.delete(oldestKey);
  }
}

function getCandidateRecipeIndexes(
  indexes: RecipeWorkerIndexes,
  request: Extract<WorkerRequest, { type: "queryRecipes" }>,
): number[] {
  if (!request.resource) {
    return indexes.allRecipeIndexes;
  }

  return (
    indexes.recipeIndexesByResource.get(getResourceModeKey(request.resource, request.mode)) ?? []
  );
}

function ensureRecipeIndexes(dataset: RecipeDataset, cacheKey: string): RecipeWorkerIndexes {
  if (loadedIndexes?.cacheKey === cacheKey) {
    return loadedIndexes;
  }

  const recipeIndexesByResource = new Map<string, number[]>();
  const recipeMaps: string[] = [];
  const tierIndexes: number[] = [];
  const searchText: string[] = [];
  const iconScores: number[] = [];
  const allRecipeIndexes: number[] = [];

  dataset.recipes.forEach((recipe, recipeIndex) => {
    allRecipeIndexes.push(recipeIndex);
    recipeMaps[recipeIndex] = recipe.source?.recipeMap ?? recipe.machineType;
    tierIndexes[recipeIndex] = getTierIndex(getRecipeTier(recipe));
    searchText[recipeIndex] = buildRecipeSearchText(recipe);
    iconScores[recipeIndex] = recipeIconScore(recipe);

    for (const output of recipe.outputs) {
      addRecipeIndex(recipeIndexesByResource, getResourceModeKey(output, "recipes"), recipeIndex);
    }

    for (const input of recipe.inputs) {
      addRecipeIndex(recipeIndexesByResource, getResourceModeKey(input, "uses"), recipeIndex);
    }
  });

  loadedIndexes = {
    cacheKey,
    allRecipeIndexes,
    recipeIndexesByResource,
    recipeMaps,
    tierIndexes,
    searchText,
    iconScores,
    queryCache: new Map(),
  };
  return loadedIndexes;
}

function addRecipeIndex(index: Map<string, number[]>, key: string, recipeIndex: number) {
  const existing = index.get(key);
  if (existing) {
    existing.push(recipeIndex);
  } else {
    index.set(key, [recipeIndex]);
  }
}

function getResourceModeKey(
  resource: Pick<ResourceAmount, "kind" | "id">,
  mode: "recipes" | "uses",
) {
  return `${mode}:${resource.kind}:${resource.id}`;
}

function getQueryCacheKey(request: Extract<WorkerRequest, { type: "queryRecipes" }>) {
  return [
    normalizeText(request.query),
    request.resource ? `${request.resource.kind}:${request.resource.id}` : "",
    request.mode,
    request.recipeMap ?? "",
    request.maxTier,
    request.limit,
  ].join("|");
}

function buildRecipeSearchText(recipe: Recipe): string {
  return normalizeText(
    [
      recipe.name,
      recipe.machineType,
      recipe.source?.recipeMap,
      recipe.source?.rawRecipeId,
      ...recipe.inputs.map((input) => input.displayName ?? input.id),
      ...recipe.outputs.map((output) => output.displayName ?? output.id),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

async function readDatasetResponseText(response: Response, datasetUrl: string): Promise<string> {
  if (!isGzipDatasetUrl(datasetUrl)) {
    return response.text();
  }

  if (!response.body || !("DecompressionStream" in globalThis)) {
    throw new Error("This browser cannot decompress GTNH dataset files.");
  }

  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function isGzipDatasetUrl(datasetUrl: string): boolean {
  return new URL(datasetUrl, self.location.origin).pathname.endsWith(".gz");
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
          iconPath: getCurrentIconPath(resource.iconPath, datasetResource?.iconPath),
          iconAtlas: datasetResource?.iconAtlas ?? resource.iconAtlas,
          recipeCount: 1,
        });
      }
    }
  }

  return [...index.values()];
}

function getCurrentIconPath(
  resourceIconPath: string | undefined,
  datasetIconPath: string | undefined,
): string | undefined {
  if (isLegacyRenderedIconPath(resourceIconPath)) {
    return datasetIconPath;
  }

  return datasetIconPath ?? resourceIconPath;
}

function isLegacyRenderedIconPath(iconPath: string | undefined): boolean {
  return typeof iconPath === "string" && iconPath.includes("/textures/rendered/");
}

function recipeMatchesTierIndex(
  indexes: RecipeWorkerIndexes,
  recipeIndex: number,
  maxTier: TierFilter,
) {
  if (maxTier === "all") {
    return true;
  }

  return (indexes.tierIndexes[recipeIndex] ?? GT_VOLTAGE_TIERS.length - 1) <= getTierIndex(maxTier);
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
    (score, resource) => score + (resource.iconPath || resource.iconAtlas ? 1 : 0),
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
    const request = db
      .transaction(DATASET_STORE, "readonly")
      .objectStore(DATASET_STORE)
      .get(cacheKey);
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
