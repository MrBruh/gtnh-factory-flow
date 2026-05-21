import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import {
  forEachResource,
  getDominantOpaqueColor,
  isRenderedIconPath,
  readDataset,
  writeDataset,
} from "./icon-utils.mjs";

const datasetPath = process.argv[2];
const datasetOutDir = process.argv[3];

if (!datasetPath || !datasetOutDir) {
  throw new Error(
    "Usage: finalize-rendered-icons.mjs <recipes.json|recipes.json.gz> <dataset-out-dir>",
  );
}

const dataset = await readDataset(datasetPath);
const versionId = dataset.datasetVersionId ?? path.basename(datasetOutDir);
const renderedDir = path.join(datasetOutDir, "textures", "rendered");
const iconsDir = path.join(datasetOutDir, "textures", "icons");

if (!existsSync(renderedDir)) {
  console.log("No rendered icon directory found; skipping standalone icon finalization.");
  process.exit(0);
}

const renderedIconPaths = new Set();
forEachResource(dataset, (resource) => {
  if (isRenderedIconPath(resource.iconPath)) {
    renderedIconPaths.add(resource.iconPath);
  }
});

if (renderedIconPaths.size === 0) {
  await fs.rm(renderedDir, { recursive: true, force: true });
  console.log("No rendered icon references found; removed unused rendered directory.");
  process.exit(0);
}

await fs.rm(iconsDir, { recursive: true, force: true });
await fs.mkdir(iconsDir, { recursive: true });

const refsByPath = new Map();
const missingPaths = new Set();

for (const iconPath of [...renderedIconPaths].sort()) {
  const sourcePath = path.join(renderedDir, path.basename(iconPath));
  if (!existsSync(sourcePath)) {
    missingPaths.add(iconPath);
    continue;
  }

  const buffer = await fs.readFile(sourcePath);
  const icon = PNG.sync.read(buffer);
  const fileName = `icon-${createHash("sha1").update(iconPath).digest("hex").slice(0, 16)}.png`;
  await fs.writeFile(path.join(iconsDir, fileName), buffer);
  refsByPath.set(iconPath, {
    iconPath: `/datasets/gtnh/${versionId}/textures/icons/${fileName}`,
    dominantColor: getDominantOpaqueColor(icon),
  });
}

forEachResource(dataset, (resource) => {
  if (!isRenderedIconPath(resource.iconPath)) {
    if (resource.iconAtlas?.dominantColor && !resource.dominantColor) {
      resource.dominantColor = resource.iconAtlas.dominantColor;
    }
    delete resource.iconAtlas;
    return;
  }

  const ref = refsByPath.get(resource.iconPath);
  if (!ref) {
    delete resource.iconPath;
    delete resource.iconAtlas;
    delete resource.dominantColor;
    return;
  }

  resource.iconPath = ref.iconPath;
  resource.dominantColor = ref.dominantColor;
  delete resource.iconAtlas;
});

await writeDataset(datasetPath, dataset);
await fs.rm(renderedDir, { recursive: true, force: true });

console.log(
  `Finalized ${refsByPath.size} standalone icon(s) in textures/icons; cleared ${missingPaths.size} missing icon reference(s).`,
);
