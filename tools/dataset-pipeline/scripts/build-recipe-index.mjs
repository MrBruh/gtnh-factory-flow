import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const datasetPath = process.argv[2];
const datasetOutDir = process.argv[3];

if (!datasetPath || !datasetOutDir) {
  throw new Error("Usage: build-recipe-index.mjs <recipes.json> <dataset-out-dir>");
}

const shardSize = positiveIntEnv("GTNH_RECIPE_SHARD_SIZE", 5000);
const dataset = await readDataset(datasetPath);
const versionId = dataset.datasetVersionId;
const shardDir = path.join(datasetOutDir, "recipes-shards");

if (!versionId) {
  throw new Error("Dataset must include datasetVersionId.");
}

await fs.rm(shardDir, { recursive: true, force: true });
await fs.mkdir(shardDir, { recursive: true });

const shards = [];
for (let start = 0, shardIndex = 0; start < dataset.recipes.length; start += shardSize, shardIndex += 1) {
  const end = Math.min(dataset.recipes.length, start + shardSize);
  const fileName = `shard-${String(shardIndex).padStart(4, "0")}.json.gz`;
  const publicPath = `/datasets/gtnh/${versionId}/recipes-shards/${fileName}`;
  const shard = {
    schemaVersion: 1,
    datasetVersionId: versionId,
    shardIndex,
    start,
    end,
    recipes: dataset.recipes.slice(start, end),
  };

  await fs.writeFile(path.join(shardDir, fileName), gzipSync(JSON.stringify(shard), { level: 9 }));
  shards.push({ id: String(shardIndex), path: publicPath, start, end });
}

const recipeIndex = {
  schemaVersion: 1,
  datasetVersionId: versionId,
  gtnhVersion: dataset.gtnhVersion,
  sourceInfo: dataset.sourceInfo,
  resources: dataset.resources ?? [],
  resourceIndex: dataset.resourceIndex ?? [],
  recipeMaps: dataset.recipeMaps ?? [],
  generatedAt: dataset.generatedAt,
  recipeCount: dataset.recipes.length,
  shardSize,
  shards,
  recipes: dataset.recipes.map(toRecipeSummary),
};

const resourceCatalog = {
  schemaVersion: 1,
  datasetVersionId: versionId,
  gtnhVersion: dataset.gtnhVersion,
  sourceInfo: dataset.sourceInfo,
  resources: dataset.resources ?? [],
  resourceIndex: dataset.resourceIndex ?? [],
  recipeMaps: dataset.recipeMaps ?? [],
  generatedAt: dataset.generatedAt,
  recipeCount: dataset.recipes.length,
  shardSize,
  shards,
};

const resourceIndexPath = path.join(datasetOutDir, "resource-index.json.gz");
const indexPath = path.join(datasetOutDir, "recipe-index.json.gz");
await fs.writeFile(resourceIndexPath, gzipSync(JSON.stringify(resourceCatalog), { level: 9 }));
await fs.writeFile(indexPath, gzipSync(JSON.stringify(recipeIndex), { level: 9 }));

console.log(
  `Wrote resource catalog, recipe index with ${recipeIndex.recipes.length} summaries, and ${shards.length} shard(s).`,
);

function toRecipeSummary(recipe, index) {
  return {
    id: recipe.id,
    name: recipe.name,
    recipeMap: recipe.source?.recipeMap ?? recipe.machineType,
    machineType: recipe.machineType,
    minimumTier: recipe.minimumTier,
    durationTicks: recipe.durationTicks,
    eut: recipe.eut,
    programmedCircuit: recipe.programmedCircuit,
    inputs: (recipe.inputs ?? []).map(toCompactResource),
    outputs: (recipe.outputs ?? []).map(toCompactResource),
    source: recipe.source?.recipeMap ? { recipeMap: recipe.source.recipeMap } : undefined,
    nei: compactNei(recipe.nei),
    shardIndex: Math.floor(index / shardSize),
  };
}

function compactNei(nei) {
  if (!nei) {
    return undefined;
  }

  return removeUndefined({
    itemInputGrid: nei.itemInputGrid,
    itemOutputGrid: nei.itemOutputGrid,
    fluidInputGrid: nei.fluidInputGrid,
    fluidOutputGrid: nei.fluidOutputGrid,
    slotCapacity: nei.slotCapacity,
    requiresCleanroom: nei.requiresCleanroom,
    requiresLowGravity: nei.requiresLowGravity,
  });
}

async function readDataset(filePath) {
  const data = await fs.readFile(filePath);
  const source = filePath.endsWith(".gz")
    ? gunzipSync(data).toString("utf8")
    : data.toString("utf8");
  return JSON.parse(source);
}

function toCompactResource(resource) {
  return removeUndefined({
    kind: resource.kind,
    id: resource.id,
    amount: resource.amount,
    optional: resource.optional,
    consumed: resource.consumed,
    chance: resource.chance,
    byproduct: resource.byproduct,
    neiSlot: resource.neiSlot,
  });
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function positiveIntEnv(name, fallback) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}
