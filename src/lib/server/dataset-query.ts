import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type {
  DatasetManifest,
  DatasetResource,
  DatasetResourceIndexEntry,
  DatasetVersion,
  RecipeSummary,
} from "@/lib/datasets/types";
import type { MachineTier, Recipe, ResourceAmount } from "@/lib/model/types";
import { getRecipePowerTier, GT_VOLTAGE_TIERS } from "@/lib/model";

type TierFilter = "all" | Exclude<MachineTier, "DEMO">;

interface RecipeIndexShard {
  id: string;
  path: string;
  start: number;
  end: number;
}

interface LoadedRecipeIndex {
  version: DatasetVersion;
  resources: DatasetResource[];
  resourceIndex: DatasetResourceIndexEntry[];
  recipeMaps: string[];
  recipeCount: number;
  recipes?: RecipeSummary[];
  shards: RecipeIndexShard[];
  indexes?: QueryIndexes;
}

interface QueryIndexes {
  recipeIndexesByResource: Map<string, number[]>;
  recipeMaps: string[];
  tierIndexes: number[];
  searchText: string[];
  iconScores: number[];
  allRecipeIndexes: number[];
}

interface RecipeShardPayload {
  datasetVersionId: string;
  recipes: Recipe[];
}

const datasetRoot = path.join(process.cwd(), "public", "datasets", "gtnh");
const loadedCatalogs = new Map<string, LoadedRecipeIndex>();
const loadedShards = new Map<string, Recipe[]>();
let manifestCache: DatasetManifest | undefined;

export async function getDatasetCatalog(versionId: string) {
  const catalog = await loadCatalog(versionId);
  return {
    schemaVersion: 1 as const,
    datasetVersionId: catalog.version.id,
    gtnhVersion: catalog.version.gtnhVersion,
    sourceInfo: catalog.version.sourceInfo,
    resources: catalog.resources,
    resourceIndex: catalog.resourceIndex,
    recipes: [],
    recipeCount: catalog.recipeCount,
    oreDictionary: {},
    recipeMaps: catalog.recipeMaps,
    generatedAt: catalog.version.publishedAt,
  };
}

export async function queryDatasetRecipes(
  versionId: string,
  request: {
    query: string;
    resource?: Pick<ResourceAmount, "kind" | "id">;
    mode: "recipes" | "uses";
    recipeMap?: string;
    maxTier: TierFilter;
    limit: number;
  },
) {
  const catalog = await loadRecipeIndex(versionId);
  const indexes = ensureIndexes(catalog);
  const query = normalizeText(request.query);
  const recipeMaps = new Set<string>();
  const candidates = request.resource
    ? indexes.recipeIndexesByResource.get(getResourceModeKey(request.resource, request.mode)) ?? []
    : indexes.allRecipeIndexes;
  const eligible: number[] = [];

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
    eligible.push(recipeIndex);
  }

  const sortedRecipeMaps = [...recipeMaps].sort((a, b) => a.localeCompare(b));
  const effectiveMap = request.recipeMap || (request.resource ? sortedRecipeMaps[0] : undefined);
  const withIcons: Array<{ recipeIndex: number; iconScore: number }> = [];
  const withoutIcons: number[] = [];
  let total = 0;

  for (const recipeIndex of eligible) {
    if (effectiveMap && indexes.recipeMaps[recipeIndex] !== effectiveMap) {
      continue;
    }
    total += 1;
    if (withIcons.length + withoutIcons.length >= request.limit * 2) {
      continue;
    }
    const iconScore = indexes.iconScores[recipeIndex] ?? 0;
    if (iconScore > 0) {
      withIcons.push({ recipeIndex, iconScore });
    } else {
      withoutIcons.push(recipeIndex);
    }
  }

  const recipeIndexes = [
    ...withIcons.sort((a, b) => b.iconScore - a.iconScore).map((entry) => entry.recipeIndex),
    ...withoutIcons,
  ].slice(0, request.limit);

  return {
    recipes: recipeIndexes.map((index) => catalog.recipes?.[index]).filter(Boolean),
    total,
    recipeMaps: sortedRecipeMaps,
  };
}

export async function getDatasetRecipe(versionId: string, recipeId: string): Promise<Recipe | undefined> {
  const catalog = await loadRecipeIndex(versionId);
  const recipeIndex = catalog.recipes?.findIndex((recipe) => recipe.id === recipeId) ?? -1;
  if (recipeIndex === -1) {
    return undefined;
  }
  const summary = catalog.recipes?.[recipeIndex] as (RecipeSummary & { shardIndex?: number }) | undefined;
  const shard =
    summary?.shardIndex !== undefined
      ? catalog.shards[summary.shardIndex]
      : catalog.shards.find((entry) => recipeIndex >= entry.start && recipeIndex < entry.end);
  if (!shard) {
    return undefined;
  }
  const recipes = await loadShard(catalog.version, shard);
  return recipes.find((recipe) => recipe.id === recipeId);
}

async function loadManifest(): Promise<DatasetManifest> {
  if (manifestCache) {
    return manifestCache;
  }
  const manifest = JSON.parse(
    await fs.readFile(path.join(datasetRoot, "datasets.manifest.json"), "utf8"),
  ) as DatasetManifest;
  manifestCache = manifest;
  return manifest;
}

async function loadCatalog(versionId: string): Promise<LoadedRecipeIndex> {
  const cached = loadedCatalogs.get(versionId);
  if (cached) {
    return cached;
  }

  const manifest = await loadManifest();
  const version = manifest.versions.find((entry) => entry.id === versionId);
  if (!version?.resourceIndexPath) {
    throw new Error(`Dataset ${versionId} has no server resource index.`);
  }
  const catalog = await readGzipJson<LoadedRecipeIndex>(publicPathToFile(version.resourceIndexPath));
  const loaded = {
    ...catalog,
    version,
  };
  loadedCatalogs.set(versionId, loaded);
  return loaded;
}

async function loadRecipeIndex(versionId: string): Promise<LoadedRecipeIndex> {
  const catalog = await loadCatalog(versionId);
  if (catalog.recipes) {
    return catalog;
  }
  if (!catalog.version.recipeIndexPath) {
    throw new Error(`Dataset ${versionId} has no recipe index.`);
  }
  const recipeIndex = await readGzipJson<LoadedRecipeIndex>(publicPathToFile(catalog.version.recipeIndexPath));
  catalog.recipes = hydrateSummaries(recipeIndex.recipes ?? [], catalog);
  catalog.shards = recipeIndex.shards;
  catalog.recipeCount = recipeIndex.recipeCount;
  return catalog;
}

async function loadShard(version: DatasetVersion, shard: RecipeIndexShard): Promise<Recipe[]> {
  const key = `${version.id}:${shard.id}`;
  const cached = loadedShards.get(key);
  if (cached) {
    return cached;
  }
  const payload = await readGzipJson<RecipeShardPayload>(publicPathToFile(shard.path));
  loadedShards.set(key, payload.recipes);
  return payload.recipes;
}

async function readGzipJson<T>(filePath: string): Promise<T> {
  const data = await fs.readFile(filePath);
  return JSON.parse(gunzipSync(data).toString("utf8")) as T;
}

function publicPathToFile(publicPath: string): string {
  return path.join(process.cwd(), "public", publicPath.replace(/^\//, ""));
}

function hydrateSummaries(recipes: RecipeSummary[], catalog: LoadedRecipeIndex): RecipeSummary[] {
  const resourcesByKey = new Map(
    [...catalog.resources, ...catalog.resourceIndex].map((resource) => [
      `${resource.kind}:${resource.id}`,
      resource,
    ]),
  );
  return recipes.map((recipe) => ({
    ...recipe,
    inputs: recipe.inputs.map((resource) => hydrateResource(resource, resourcesByKey)),
    outputs: recipe.outputs.map((resource) => hydrateResource(resource, resourcesByKey)),
  }));
}

function hydrateResource<T extends ResourceAmount>(
  resource: T,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): T {
  const indexed = resourcesByKey.get(`${resource.kind}:${resource.id}`);
  if (!indexed) {
    return resource;
  }
  return {
    ...resource,
    displayName: resource.displayName ?? indexed.displayName,
    iconPath: resource.iconPath ?? indexed.iconPath,
    iconAtlas: resource.iconAtlas ?? indexed.iconAtlas,
  };
}

function ensureIndexes(catalog: LoadedRecipeIndex): QueryIndexes {
  if (catalog.indexes) {
    return catalog.indexes;
  }
  const recipeIndexesByResource = new Map<string, number[]>();
  const recipeMaps: string[] = [];
  const tierIndexes: number[] = [];
  const searchText: string[] = [];
  const iconScores: number[] = [];
  const allRecipeIndexes: number[] = [];

  catalog.recipes?.forEach((recipe, recipeIndex) => {
    allRecipeIndexes.push(recipeIndex);
    recipeMaps[recipeIndex] = recipe.recipeMap;
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

  catalog.indexes = { recipeIndexesByResource, recipeMaps, tierIndexes, searchText, iconScores, allRecipeIndexes };
  return catalog.indexes;
}

function addRecipeIndex(index: Map<string, number[]>, key: string, recipeIndex: number) {
  const existing = index.get(key);
  if (existing) {
    existing.push(recipeIndex);
  } else {
    index.set(key, [recipeIndex]);
  }
}

function getResourceModeKey(resource: Pick<ResourceAmount, "kind" | "id">, mode: "recipes" | "uses") {
  return `${mode}:${resource.kind}:${resource.id}`;
}

function buildRecipeSearchText(recipe: RecipeSummary): string {
  return normalizeText(
    [
      recipe.name,
      recipe.machineType,
      recipe.recipeMap,
      ...recipe.inputs.map((input) => input.displayName ?? input.id),
      ...recipe.outputs.map((output) => output.displayName ?? output.id),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function recipeMatchesTierIndex(indexes: QueryIndexes, recipeIndex: number, maxTier: TierFilter) {
  if (maxTier === "all") {
    return true;
  }
  return (indexes.tierIndexes[recipeIndex] ?? GT_VOLTAGE_TIERS.length - 1) <= getTierIndex(maxTier);
}

function getRecipeTier(recipe: RecipeSummary): Exclude<MachineTier, "DEMO"> {
  return GT_VOLTAGE_TIERS.some((entry) => entry.tier === recipe.minimumTier)
    ? (recipe.minimumTier as Exclude<MachineTier, "DEMO">)
    : getRecipePowerTier(recipe as Recipe);
}

function getTierIndex(tier: Exclude<MachineTier, "DEMO">) {
  const index = GT_VOLTAGE_TIERS.findIndex((entry) => entry.tier === tier);
  return index === -1 ? GT_VOLTAGE_TIERS.length - 1 : index;
}

function recipeIconScore(recipe: RecipeSummary): number {
  return [...recipe.inputs, ...recipe.outputs].reduce(
    (score, resource) => score + (resource.iconPath || resource.iconAtlas ? 1 : 0),
    0,
  );
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}
