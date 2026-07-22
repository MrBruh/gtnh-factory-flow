import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  forEachResource,
  forEachResourceInFile,
  readDataset,
  writeDataset,
} from "./icon-utils.mjs";

const currentDatasetPath = process.argv[2];
const previousDatasetDir = process.argv[3];
const currentDatasetDir = process.argv[4];

if (!currentDatasetPath || !previousDatasetDir || !currentDatasetDir) {
  throw new Error(
    "Usage: reuse-previous-icons.mjs <current-recipes.json> <previous-dataset-dir> <current-dataset-dir>",
  );
}

const previousDatasetPath = path.join(previousDatasetDir, "recipes.json.gz");
if (!existsSync(previousDatasetPath)) {
  console.log(`No previous recipes.json.gz at ${previousDatasetPath}; skipping icon reuse.`);
  process.exit(0);
}

const current = await readDataset(currentDatasetPath);
const currentVersionId = current.datasetVersionId ?? path.basename(currentDatasetDir);
const previousIcons = new Map();

// Both datasets are ~930 MB raw, well past Node's max string length. Stream the previous one
// so only its icon-bearing resources are retained, instead of holding two fully parsed
// datasets in memory at once.
const previousMeta = await forEachResourceInFile(previousDatasetPath, (resource) => {
  if (!resource?.iconPath && !resource?.iconAtlas) {
    return;
  }

  // The same resource appears in resources, resourceIndex and every recipe slot that uses
  // it, and the recipe-slot copies often omit dominantColor. Prefer whichever copy carries
  // the most icon detail so the result does not depend on the order keys appear in the file.
  const key = `${resource.kind}:${resource.id}`;
  const existing = previousIcons.get(key);
  if (existing && (existing.dominantColor || !resource.dominantColor)) {
    return;
  }
  previousIcons.set(key, resource);
});
const previousVersionId = previousMeta.datasetVersionId ?? path.basename(previousDatasetDir);

// datasetVersionId is only known once the whole file has been read, so rewrite the collected
// references here rather than inside the stream.
for (const [key, resource] of previousIcons) {
  const icon = reusableIcon(resource, previousVersionId, currentVersionId);
  if (icon) {
    previousIcons.set(key, icon);
  } else {
    previousIcons.delete(key);
  }
}

await copyTextureDir("icons");
await copyTextureDir("atlas");

let reused = 0;
forEachResource(current, (resource) => {
  if (resource.iconPath || resource.iconAtlas) {
    return;
  }
  const icon = previousIcons.get(`${resource.kind}:${resource.id}`);
  if (!icon) {
    return;
  }
  if (icon.iconPath) {
    resource.iconPath = icon.iconPath;
  }
  if (icon.iconAtlas) {
    resource.iconAtlas = icon.iconAtlas;
  }
  if (icon.dominantColor) {
    resource.dominantColor = icon.dominantColor;
  }
  reused += 1;
});

if (reused > 0) {
  await writeDataset(currentDatasetPath, current);
}
console.log(`Reused ${reused} icon reference(s) from ${previousVersionId}.`);

function reusableIcon(resource, previousVersionId, currentVersionId) {
  const iconPath = rewriteDatasetPath(resource.iconPath, previousVersionId, currentVersionId);
  const iconAtlas = resource.iconAtlas
    ? {
        ...resource.iconAtlas,
        imagePath: rewriteDatasetPath(
          resource.iconAtlas.imagePath,
          previousVersionId,
          currentVersionId,
        ),
      }
    : undefined;
  if (!iconPath && !iconAtlas) {
    return undefined;
  }
  return {
    iconPath,
    iconAtlas,
    dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
  };
}

function rewriteDatasetPath(value, previousVersionId, currentVersionId) {
  if (typeof value !== "string" || !value.includes(`/datasets/gtnh/${previousVersionId}/`)) {
    return undefined;
  }
  return value.replace(
    `/datasets/gtnh/${previousVersionId}/`,
    `/datasets/gtnh/${currentVersionId}/`,
  );
}

async function copyTextureDir(name) {
  const source = path.join(previousDatasetDir, "textures", name);
  const target = path.join(currentDatasetDir, "textures", name);
  if (!existsSync(source)) {
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, force: true });
}
