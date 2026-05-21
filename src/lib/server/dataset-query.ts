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
  resourceIndexes?: ResourceQueryIndexes;
  resourcesByKey?: Map<string, DatasetResource | DatasetResourceIndexEntry>;
  recipeMapIconCandidates?: RecipeMapIconCandidate[];
  recipeMapIconCache?: Map<string, DatasetResourceIndexEntry | undefined>;
}

interface RecipeLookupIndexFile {
  schemaVersion: 1;
  datasetVersionId: string;
  recipeCount: number;
  shards: RecipeIndexShard[];
  recipeMaps: string[];
  recipeIds?: string[];
  tierIndexes: number[];
  entries: Array<[string, Array<[number, number[]]>]>;
}

interface LoadedRecipeLookupIndex {
  version: DatasetVersion;
  recipeCount: number;
  shards: RecipeIndexShard[];
  recipeMaps: string[];
  recipeMapIds: Map<string, number>;
  recipeIds: string[];
  recipeIndexesById?: Map<string, number>;
  tierIndexes: number[];
  entries: Map<string, Map<number, number[]>>;
}

interface QueryIndexes {
  recipeIndexesByResource: Map<string, number[]>;
  recipeIndexesByResourceAndMap: Map<string, number[]>;
  recipeMaps: string[];
  recipeMapsByResource: Map<string, string[]>;
  recipeMapIcons: Map<string, DatasetResourceIndexEntry | undefined>;
  tierIndexes: number[];
  searchText: string[];
  iconScores: number[];
  allRecipeIndexes: number[];
}

interface ResourceQueryIndexes {
  sortedResourceIndexes: number[];
  searchText: string[];
}

interface RecipeShardPayload {
  datasetVersionId: string;
  recipes: Recipe[];
}

const datasetRoot = path.join(process.cwd(), "public", "datasets", "gtnh");
const loadedCatalogs = new Map<string, LoadedRecipeIndex>();
const pendingCatalogLoads = new Map<string, Promise<LoadedRecipeIndex>>();
const pendingRecipeIndexLoads = new Map<string, Promise<LoadedRecipeIndex>>();
const loadedRecipeLookupIndexes = new Map<string, LoadedRecipeLookupIndex>();
const pendingRecipeLookupLoads = new Map<string, Promise<LoadedRecipeLookupIndex>>();
const loadedShards = new Map<string, Recipe[]>();
const pendingShardLoads = new Map<string, Promise<Recipe[]>>();
let manifestCache: DatasetManifest | undefined;

export async function getDatasetCatalog(versionId: string) {
  const catalog = await loadCatalog(versionId);
  return {
    schemaVersion: 1 as const,
    datasetVersionId: catalog.version.id,
    gtnhVersion: catalog.version.gtnhVersion,
    sourceInfo: catalog.version.sourceInfo,
    resources: [],
    resourceIndex: [],
    recipes: [],
    recipeCount: catalog.recipeCount,
    oreDictionary: {},
    recipeMaps: catalog.recipeMaps,
    generatedAt: catalog.version.publishedAt,
  };
}

export async function queryDatasetResources(
  versionId: string,
  request: {
    query: string;
    offset: number;
    limit: number;
  },
) {
  const catalog = await loadCatalog(versionId);
  const indexes = ensureResourceIndexes(catalog);
  const query = normalizeText(request.query);
  const matches: number[] = [];

  for (const resourceIndex of indexes.sortedResourceIndexes) {
    const resource = catalog.resourceIndex[resourceIndex];
    if (!resource || (!resource.iconPath && !resource.iconAtlas)) {
      continue;
    }
    if (query && !indexes.searchText[resourceIndex]?.includes(query)) {
      continue;
    }
    matches.push(resourceIndex);
  }

  return {
    resources: matches
      .slice(request.offset, request.offset + request.limit)
      .map((index) => catalog.resourceIndex[index])
      .filter(Boolean),
    total: matches.length,
    offset: request.offset,
    limit: request.limit,
    hasMore: request.offset + request.limit < matches.length,
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
    offset: number;
    limit: number;
  },
) {
  const catalog = await loadCatalog(versionId);
  if (request.resource && catalog.version.recipeLookupIndexPath) {
    return queryDatasetRecipesFromLookup(catalog, { ...request, resource: request.resource });
  }

  const recipeCatalog = await loadRecipeIndex(versionId);
  const indexes = ensureIndexes(recipeCatalog);
  const query = normalizeText(request.query);
  const candidates = request.resource
    ? (indexes.recipeIndexesByResource.get(getResourceModeKey(request.resource, request.mode)) ??
      [])
    : indexes.allRecipeIndexes;
  const eligibleRecipeMaps = request.resource
    ? (indexes.recipeMapsByResource.get(getResourceModeKey(request.resource, request.mode)) ?? [])
    : [...new Set(indexes.recipeMaps.filter(Boolean))];
  const sortedRecipeMaps = [...eligibleRecipeMaps].sort((a, b) => a.localeCompare(b));
  const effectiveMap = request.recipeMap || (request.resource ? sortedRecipeMaps[0] : undefined);
  const scopedCandidates =
    request.resource && effectiveMap
      ? (indexes.recipeIndexesByResourceAndMap.get(
          getResourceModeMapKey(request.resource, request.mode, effectiveMap),
        ) ?? [])
      : candidates;
  const withIcons: Array<{ recipeIndex: number; iconScore: number }> = [];
  const withoutIcons: number[] = [];
  let total = 0;

  for (const recipeIndex of scopedCandidates) {
    if (!recipeMatchesTierIndex(indexes, recipeIndex, request.maxTier)) {
      continue;
    }
    if (!request.resource && query && !indexes.searchText[recipeIndex]?.includes(query)) {
      continue;
    }
    if (effectiveMap && indexes.recipeMaps[recipeIndex] !== effectiveMap) {
      continue;
    }
    total += 1;
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
  ].slice(request.offset, request.offset + request.limit);

  return {
    recipes: recipeIndexes.map((index) => recipeCatalog.recipes?.[index]).filter(Boolean),
    total,
    recipeMaps: sortedRecipeMaps,
    recipeMapIcons: Object.fromEntries(
      sortedRecipeMaps
        .map((recipeMap) => [recipeMap, indexes.recipeMapIcons.get(recipeMap)] as const)
        .filter((entry): entry is readonly [string, DatasetResourceIndexEntry] =>
          Boolean(entry[1]),
        ),
    ),
    offset: request.offset,
    limit: request.limit,
    hasMore: request.offset + request.limit < total,
  };
}

async function queryDatasetRecipesFromLookup(
  catalog: LoadedRecipeIndex,
  request: {
    query: string;
    resource: Pick<ResourceAmount, "kind" | "id">;
    mode: "recipes" | "uses";
    recipeMap?: string;
    maxTier: TierFilter;
    offset: number;
    limit: number;
  },
) {
  const lookup = await loadRecipeLookupIndex(catalog.version);
  const resourceKey = getResourceModeKey(request.resource, request.mode);
  const recipesByMap = lookup.entries.get(resourceKey);
  const sortedRecipeMaps = recipesByMap
    ? [...recipesByMap.keys()]
        .map((recipeMapId) => lookup.recipeMaps[recipeMapId])
        .filter((recipeMap): recipeMap is string => Boolean(recipeMap))
        .sort((a, b) => a.localeCompare(b))
    : [];
  const effectiveMap = request.recipeMap || sortedRecipeMaps[0];
  const effectiveMapId = effectiveMap ? lookup.recipeMapIds.get(effectiveMap) : undefined;
  const scopedCandidates =
    recipesByMap && effectiveMapId !== undefined ? (recipesByMap.get(effectiveMapId) ?? []) : [];
  const matchingRecipeIndexes: number[] = [];

  for (const recipeIndex of scopedCandidates) {
    if (recipeMatchesLookupTier(lookup, recipeIndex, request.maxTier)) {
      matchingRecipeIndexes.push(recipeIndex);
    }
  }

  const pageRecipeIndexes = matchingRecipeIndexes.slice(
    request.offset,
    request.offset + request.limit,
  );
  const recipes = await getRecipeSummariesByIndex(catalog, pageRecipeIndexes);

  return {
    recipes,
    total: matchingRecipeIndexes.length,
    recipeMaps: sortedRecipeMaps,
    recipeMapIcons: Object.fromEntries(
      sortedRecipeMaps
        .map((recipeMap) => [recipeMap, getRecipeMapIcon(catalog, recipeMap)] as const)
        .filter((entry): entry is readonly [string, DatasetResourceIndexEntry] =>
          Boolean(entry[1]),
        ),
    ),
    offset: request.offset,
    limit: request.limit,
    hasMore: request.offset + request.limit < matchingRecipeIndexes.length,
  };
}

export async function prewarmDatasetVersion(versionId: string): Promise<void> {
  const catalog = await loadCatalog(versionId);
  ensureResourceIndexes(catalog);

  if (catalog.version.recipeLookupIndexPath) {
    await loadRecipeLookupIndex(catalog.version);
    return;
  }

  const recipeCatalog = await loadRecipeIndex(versionId);
  ensureIndexes(recipeCatalog);
}

export async function getDatasetRecipe(
  versionId: string,
  recipeId: string,
): Promise<Recipe | undefined> {
  const catalog = await loadCatalog(versionId);
  const recipeIndex = catalog.version.recipeLookupIndexPath
    ? await getRecipeIndexFromLookup(catalog.version, recipeId)
    : ((await loadRecipeIndex(versionId)).recipes?.findIndex((recipe) => recipe.id === recipeId) ??
      -1);
  if (recipeIndex === -1) {
    return undefined;
  }
  const shard = catalog.shards.find(
    (entry) => recipeIndex >= entry.start && recipeIndex < entry.end,
  );
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

  const pending = pendingCatalogLoads.get(versionId);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    const manifest = await loadManifest();
    const version = manifest.versions.find((entry) => entry.id === versionId);
    if (!version?.resourceIndexPath) {
      throw new Error(`Dataset ${versionId} has no server resource index.`);
    }
    const catalog = await readGzipJson<LoadedRecipeIndex>(
      publicPathToFile(version.resourceIndexPath),
    );
    const loaded = {
      ...catalog,
      version,
    };
    loadedCatalogs.set(versionId, loaded);
    return loaded;
  })().finally(() => {
    pendingCatalogLoads.delete(versionId);
  });

  pendingCatalogLoads.set(versionId, promise);
  return promise;
}

async function loadRecipeIndex(versionId: string): Promise<LoadedRecipeIndex> {
  const catalog = await loadCatalog(versionId);
  if (catalog.recipes) {
    return catalog;
  }

  const pending = pendingRecipeIndexLoads.get(versionId);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    if (!catalog.version.recipeIndexPath) {
      throw new Error(`Dataset ${versionId} has no recipe index.`);
    }
    const recipeIndex = await readGzipJson<LoadedRecipeIndex>(
      publicPathToFile(catalog.version.recipeIndexPath),
    );
    catalog.recipes = hydrateSummaries(recipeIndex.recipes ?? [], catalog);
    catalog.shards = recipeIndex.shards;
    catalog.recipeCount = recipeIndex.recipeCount;
    return catalog;
  })().finally(() => {
    pendingRecipeIndexLoads.delete(versionId);
  });

  pendingRecipeIndexLoads.set(versionId, promise);
  return promise;
}

async function loadRecipeLookupIndex(version: DatasetVersion): Promise<LoadedRecipeLookupIndex> {
  const cached = loadedRecipeLookupIndexes.get(version.id);
  if (cached) {
    return cached;
  }

  const pending = pendingRecipeLookupLoads.get(version.id);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    if (!version.recipeLookupIndexPath) {
      throw new Error(`Dataset ${version.id} has no recipe lookup index.`);
    }
    const payload = await readGzipJson<RecipeLookupIndexFile>(
      publicPathToFile(version.recipeLookupIndexPath),
    );
    const loaded: LoadedRecipeLookupIndex = {
      version,
      recipeCount: payload.recipeCount,
      shards: payload.shards,
      recipeMaps: payload.recipeMaps,
      recipeMapIds: new Map(payload.recipeMaps.map((recipeMap, index) => [recipeMap, index])),
      recipeIds: payload.recipeIds ?? [],
      tierIndexes: payload.tierIndexes,
      entries: new Map(payload.entries.map(([key, recipesByMap]) => [key, new Map(recipesByMap)])),
    };
    loadedRecipeLookupIndexes.set(version.id, loaded);
    return loaded;
  })().finally(() => {
    pendingRecipeLookupLoads.delete(version.id);
  });

  pendingRecipeLookupLoads.set(version.id, promise);
  return promise;
}

async function getRecipeIndexFromLookup(
  version: DatasetVersion,
  recipeId: string,
): Promise<number> {
  const lookup = await loadRecipeLookupIndex(version);
  if (!lookup.recipeIndexesById) {
    lookup.recipeIndexesById = new Map(
      lookup.recipeIds.map((entry, index) => [entry, index] as const),
    );
  }
  return lookup.recipeIndexesById.get(recipeId) ?? -1;
}

async function loadShard(version: DatasetVersion, shard: RecipeIndexShard): Promise<Recipe[]> {
  const key = `${version.id}:${shard.id}`;
  const cached = loadedShards.get(key);
  if (cached) {
    return cached;
  }

  const pending = pendingShardLoads.get(key);
  if (pending) {
    return pending;
  }

  const promise = readGzipJson<RecipeShardPayload>(publicPathToFile(shard.path))
    .then((payload) => {
      loadedShards.set(key, payload.recipes);
      return payload.recipes;
    })
    .finally(() => {
      pendingShardLoads.delete(key);
    });

  pendingShardLoads.set(key, promise);
  return promise;
}

async function readGzipJson<T>(filePath: string): Promise<T> {
  const data = await fs.readFile(filePath);
  return JSON.parse(gunzipSync(data).toString("utf8")) as T;
}

function publicPathToFile(publicPath: string): string {
  return path.join(process.cwd(), "public", publicPath.replace(/^\//, ""));
}

function hydrateSummaries(recipes: RecipeSummary[], catalog: LoadedRecipeIndex): RecipeSummary[] {
  const resourcesByKey = getCatalogResourcesByKey(catalog);
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
    dominantColor:
      resource.dominantColor ??
      indexed.dominantColor ??
      resource.iconAtlas?.dominantColor ??
      indexed.iconAtlas?.dominantColor,
  };
}

async function getRecipeSummariesByIndex(
  catalog: LoadedRecipeIndex,
  recipeIndexes: number[],
): Promise<RecipeSummary[]> {
  if (recipeIndexes.length === 0) {
    return [];
  }

  const resourcesByKey = getCatalogResourcesByKey(catalog);
  const summariesByIndex = new Map<number, RecipeSummary>();
  const shardRequests = new Map<RecipeIndexShard, number[]>();

  for (const recipeIndex of recipeIndexes) {
    const shard = catalog.shards.find(
      (entry) => recipeIndex >= entry.start && recipeIndex < entry.end,
    );
    if (!shard) {
      continue;
    }
    const existing = shardRequests.get(shard);
    if (existing) {
      existing.push(recipeIndex);
    } else {
      shardRequests.set(shard, [recipeIndex]);
    }
  }

  await Promise.all(
    [...shardRequests.entries()].map(async ([shard, indexes]) => {
      const recipes = await loadShard(catalog.version, shard);
      for (const recipeIndex of indexes) {
        const recipe = recipes[recipeIndex - shard.start];
        if (recipe) {
          summariesByIndex.set(recipeIndex, toRecipeSummary(recipe, resourcesByKey));
        }
      }
    }),
  );

  return recipeIndexes
    .map((recipeIndex) => summariesByIndex.get(recipeIndex))
    .filter((summary): summary is RecipeSummary => Boolean(summary));
}

function toRecipeSummary(
  recipe: Recipe,
  resourcesByKey: Map<string, DatasetResource | DatasetResourceIndexEntry>,
): RecipeSummary {
  return {
    id: recipe.id,
    name: recipe.name,
    recipeMap: recipe.source?.recipeMap ?? recipe.machineType,
    machineType: recipe.machineType,
    minimumTier: recipe.minimumTier,
    durationTicks: recipe.durationTicks,
    eut: recipe.eut,
    programmedCircuit: recipe.programmedCircuit,
    inputs: recipe.inputs.map((resource) => hydrateResource(resource, resourcesByKey)),
    outputs: recipe.outputs.map((resource) => hydrateResource(resource, resourcesByKey)),
    source: recipe.source?.recipeMap ? { recipeMap: recipe.source.recipeMap } : undefined,
    nei: recipe.nei,
    slots: [],
  };
}

function getCatalogResourcesByKey(
  catalog: LoadedRecipeIndex,
): Map<string, DatasetResource | DatasetResourceIndexEntry> {
  if (catalog.resourcesByKey) {
    return catalog.resourcesByKey;
  }

  catalog.resourcesByKey = new Map(
    [...catalog.resources, ...catalog.resourceIndex].map((resource) => [
      `${resource.kind}:${resource.id}`,
      resource,
    ]),
  );
  return catalog.resourcesByKey;
}

function ensureIndexes(catalog: LoadedRecipeIndex): QueryIndexes {
  if (catalog.indexes) {
    return catalog.indexes;
  }
  const recipeIndexesByResource = new Map<string, number[]>();
  const recipeIndexesByResourceAndMap = new Map<string, number[]>();
  const recipeMapSetsByResource = new Map<string, Set<string>>();
  const recipeMapSet = new Set<string>();
  const recipeMaps: string[] = [];
  const tierIndexes: number[] = [];
  const searchText: string[] = [];
  const iconScores: number[] = [];
  const allRecipeIndexes: number[] = [];

  catalog.recipes?.forEach((recipe, recipeIndex) => {
    allRecipeIndexes.push(recipeIndex);
    recipeMaps[recipeIndex] = recipe.recipeMap;
    recipeMapSet.add(recipe.recipeMap);
    tierIndexes[recipeIndex] = getTierIndex(getRecipeTier(recipe));
    searchText[recipeIndex] = buildRecipeSearchText(recipe);
    iconScores[recipeIndex] = recipeIconScore(recipe);
    for (const output of recipe.outputs) {
      addRecipeIndex(recipeIndexesByResource, getResourceModeKey(output, "recipes"), recipeIndex);
      addRecipeIndex(
        recipeIndexesByResourceAndMap,
        getResourceModeMapKey(output, "recipes", recipe.recipeMap),
        recipeIndex,
      );
      addRecipeMap(
        recipeMapSetsByResource,
        getResourceModeKey(output, "recipes"),
        recipe.recipeMap,
      );
    }
    for (const input of recipe.inputs) {
      addRecipeIndex(recipeIndexesByResource, getResourceModeKey(input, "uses"), recipeIndex);
      addRecipeIndex(
        recipeIndexesByResourceAndMap,
        getResourceModeMapKey(input, "uses", recipe.recipeMap),
        recipeIndex,
      );
      addRecipeMap(recipeMapSetsByResource, getResourceModeKey(input, "uses"), recipe.recipeMap);
    }
  });

  const recipeMapsByResource = new Map(
    [...recipeMapSetsByResource.entries()].map(([key, maps]) => [key, [...maps]]),
  );

  catalog.indexes = {
    recipeIndexesByResource,
    recipeIndexesByResourceAndMap,
    recipeMaps,
    recipeMapsByResource,
    recipeMapIcons: buildRecipeMapIconMap([...recipeMapSet], catalog.resourceIndex),
    tierIndexes,
    searchText,
    iconScores,
    allRecipeIndexes,
  };
  return catalog.indexes;
}

function ensureResourceIndexes(catalog: LoadedRecipeIndex): ResourceQueryIndexes {
  if (catalog.resourceIndexes) {
    return catalog.resourceIndexes;
  }

  const searchText: string[] = [];
  const sortedResourceIndexes = catalog.resourceIndex
    .map((resource, index) => {
      searchText[index] = normalizeResourceSearchText(resource);
      return index;
    })
    .sort((leftIndex, rightIndex) => {
      const left = catalog.resourceIndex[leftIndex];
      const right = catalog.resourceIndex[rightIndex];
      return (
        (right?.recipeCount ?? 0) - (left?.recipeCount ?? 0) ||
        (left?.displayName ?? left?.id ?? "").localeCompare(right?.displayName ?? right?.id ?? "")
      );
    });

  catalog.resourceIndexes = {
    sortedResourceIndexes,
    searchText,
  };
  return catalog.resourceIndexes;
}

function addRecipeIndex(index: Map<string, number[]>, key: string, recipeIndex: number) {
  const existing = index.get(key);
  if (existing) {
    existing.push(recipeIndex);
  } else {
    index.set(key, [recipeIndex]);
  }
}

function addRecipeMap(index: Map<string, Set<string>>, key: string, recipeMap: string) {
  const existing = index.get(key);
  if (existing) {
    existing.add(recipeMap);
  } else {
    index.set(key, new Set([recipeMap]));
  }
}

function getResourceModeKey(
  resource: Pick<ResourceAmount, "kind" | "id">,
  mode: "recipes" | "uses",
) {
  return `${mode}:${resource.kind}:${resource.id}`;
}

function getResourceModeMapKey(
  resource: Pick<ResourceAmount, "kind" | "id">,
  mode: "recipes" | "uses",
  recipeMap: string,
) {
  return `${getResourceModeKey(resource, mode)}:${recipeMap}`;
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

function normalizeResourceSearchText(resource: DatasetResourceIndexEntry): string {
  return normalizeText(
    [resource.displayName, resource.id, resource.kind].filter(Boolean).join(" "),
  );
}

function buildRecipeMapIconMap(
  recipeMaps: string[],
  resources: DatasetResourceIndexEntry[],
): Map<string, DatasetResourceIndexEntry | undefined> {
  const candidates = getRecipeMapIconCandidates(resources);
  return new Map(
    recipeMaps.map((recipeMap) => [recipeMap, findRecipeMapIcon(recipeMap, candidates)]),
  );
}

function getRecipeMapIcon(
  catalog: LoadedRecipeIndex,
  recipeMap: string,
): DatasetResourceIndexEntry | undefined {
  catalog.recipeMapIconCache ??= new Map();
  if (catalog.recipeMapIconCache.has(recipeMap)) {
    return catalog.recipeMapIconCache.get(recipeMap);
  }

  catalog.recipeMapIconCandidates ??= getRecipeMapIconCandidates(catalog.resourceIndex);
  const icon = findRecipeMapIcon(recipeMap, catalog.recipeMapIconCandidates);
  catalog.recipeMapIconCache.set(recipeMap, icon);
  return icon;
}

interface RecipeMapIconCandidate {
  resource: DatasetResourceIndexEntry;
  label: string;
  tokens: Set<string>;
  exactMachineBonus: boolean;
  prefixBonus: boolean;
  penalty: boolean;
}

function getRecipeMapIconCandidates(
  resources: DatasetResourceIndexEntry[],
): RecipeMapIconCandidate[] {
  return resources
    .filter((resource) => resource.kind === "item" && (resource.iconPath || resource.iconAtlas))
    .map((resource) => {
      const label = normalizeText(resource.displayName ?? resource.id);
      return {
        resource,
        label,
        tokens: new Set(label.split(" ").filter(Boolean)),
        exactMachineBonus: resource.id.startsWith("gregtech:gt.blockmachines@"),
        prefixBonus: /^(basic|steam|simple|large) /.test(label),
        penalty: /\b(pipe|cover|upgrade|part|component)\b/.test(label),
      };
    });
}

function findRecipeMapIcon(
  recipeMap: string,
  candidates: RecipeMapIconCandidate[],
): DatasetResourceIndexEntry | undefined {
  const recipeMapTokens = tokenizeRecipeMap(recipeMap);
  const normalizedMap = normalizeText(recipeMap);
  let best: { resource: DatasetResourceIndexEntry; score: number } | undefined;

  for (const candidate of candidates) {
    let score = 0;

    if (candidate.label === normalizedMap) {
      score += 120;
    } else if (candidate.label.includes(normalizedMap)) {
      score += 80;
    }

    for (const token of recipeMapTokens) {
      if (candidate.tokens.has(token) || candidate.label.includes(token)) {
        score += 14;
      }
    }

    if (candidate.exactMachineBonus) {
      score += 35;
    }
    if (candidate.prefixBonus) {
      score += 12;
    }
    if (candidate.penalty) {
      score -= 30;
    }

    if (score > (best?.score ?? 0)) {
      best = { resource: candidate.resource, score };
    }
  }

  return best && best.score >= 35 ? best.resource : undefined;
}

function tokenizeRecipeMap(value: string): string[] {
  const aliases: Record<string, string[]> = {
    washer: ["washing", "wash"],
    wash: ["washing", "washer"],
    extractor: ["extractor", "extract"],
  };

  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2)
    .flatMap((token) => [token, ...(aliases[token] ?? [])]);
}

function recipeMatchesTierIndex(indexes: QueryIndexes, recipeIndex: number, maxTier: TierFilter) {
  if (maxTier === "all") {
    return true;
  }
  return (
    (indexes.tierIndexes[recipeIndex] ?? GT_VOLTAGE_TIERS.length - 1) === getTierIndex(maxTier)
  );
}

function recipeMatchesLookupTier(
  lookup: LoadedRecipeLookupIndex,
  recipeIndex: number,
  maxTier: TierFilter,
) {
  if (maxTier === "all") {
    return true;
  }
  return (lookup.tierIndexes[recipeIndex] ?? GT_VOLTAGE_TIERS.length - 1) === getTierIndex(maxTier);
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
