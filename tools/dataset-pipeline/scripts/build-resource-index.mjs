import fs from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";

const datasetPath = process.argv[2];

if (!datasetPath) {
  throw new Error("Usage: build-resource-index.mjs <recipes.json|recipes.json.gz>");
}

const dataset = await readDataset(datasetPath);
dataset.resourceIndex = buildResourceIndex(dataset);
await writeDataset(datasetPath, dataset);

console.log(`Wrote resourceIndex with ${dataset.resourceIndex.length} resources.`);

async function readDataset(filePath) {
  const data = await fs.readFile(filePath);
  const source = filePath.endsWith(".gz")
    ? gunzipSync(data).toString("utf8")
    : data.toString("utf8");
  return JSON.parse(source);
}

async function writeDataset(filePath, dataset) {
  const json = `${JSON.stringify(dataset)}\n`;
  if (filePath.endsWith(".gz")) {
    await fs.writeFile(filePath, gzipSync(json, { level: 9 }));
    return;
  }

  await fs.writeFile(filePath, json);
}

function buildResourceIndex(dataset) {
  const resourcesByKey = new Map(
    (dataset.resources ?? []).map((resource) => [resourceKey(resource), resource]),
  );
  const index = new Map();

  for (const recipe of dataset.recipes ?? []) {
    for (const resource of [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])]) {
      const key = resourceKey(resource);
      const existing = index.get(key);
      if (existing) {
        existing.recipeCount += 1;
        mergeResourceIcon(existing, resource, resourcesByKey.get(key));
        continue;
      }

      const indexed = resourcesByKey.get(key);
      index.set(key, {
        kind: resource.kind,
        id: resource.id,
        displayName: resource.displayName ?? indexed?.displayName,
        iconPath: currentIconPath(resource.iconPath, indexed?.iconPath),
        iconAtlas: indexed?.iconAtlas ?? resource.iconAtlas,
        dominantColor:
          indexed?.dominantColor ??
          resource.dominantColor ??
          indexed?.iconAtlas?.dominantColor ??
          resource.iconAtlas?.dominantColor,
        recipeCount: 1,
      });
    }
  }

  return [...index.values()].sort((left, right) => right.recipeCount - left.recipeCount);
}

function mergeResourceIcon(target, resource, indexed) {
  if (!target.displayName) {
    target.displayName = resource.displayName ?? indexed?.displayName;
  }
  if (!target.iconPath) {
    target.iconPath = currentIconPath(resource.iconPath, indexed?.iconPath);
  }
  if (!target.iconAtlas) {
    target.iconAtlas = indexed?.iconAtlas ?? resource.iconAtlas;
  }
  if (!target.dominantColor) {
    target.dominantColor =
      indexed?.dominantColor ??
      resource.dominantColor ??
      indexed?.iconAtlas?.dominantColor ??
      resource.iconAtlas?.dominantColor;
  }
}

function currentIconPath(resourceIconPath, indexedIconPath) {
  if (isLegacyRenderedIconPath(resourceIconPath)) {
    return indexedIconPath;
  }

  return indexedIconPath ?? resourceIconPath;
}

function isLegacyRenderedIconPath(iconPath) {
  return typeof iconPath === "string" && iconPath.includes("/textures/rendered/");
}

function resourceKey(resource) {
  return `${resource.kind}:${resource.id}`;
}
