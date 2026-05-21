import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const datasetPath = process.argv[2];
const datasetOutDir = process.argv[3];

if (!datasetPath || !datasetOutDir) {
  throw new Error("Usage: build-icon-atlas.mjs <recipes.json> <dataset-out-dir>");
}

const datasetVersionId = path.basename(datasetOutDir);
const renderedDir = path.join(datasetOutDir, "textures", "rendered");
const atlasDir = path.join(datasetOutDir, "textures", "atlas");
const cellSize = positiveIntEnv("GTNH_ATLAS_ICON_SIZE", 1024);
const maxAtlasSize = positiveIntEnv("GTNH_ATLAS_MAX_SIZE", 8192);
const removeRenderedIcons = process.env.GTNH_ATLAS_KEEP_RENDERED !== "true";

if (maxAtlasSize < cellSize) {
  throw new Error(
    `GTNH_ATLAS_MAX_SIZE (${maxAtlasSize}) must be >= GTNH_ATLAS_ICON_SIZE (${cellSize}).`,
  );
}

if (!existsSync(renderedDir)) {
  console.log("No rendered icon directory found; skipping atlas build.");
  process.exit(0);
}

const dataset = JSON.parse(await fs.readFile(datasetPath, "utf8"));
const iconEntries = collectRenderedIconEntries(dataset);
if (iconEntries.size === 0) {
  console.log("No rendered icons referenced by dataset; skipping atlas build.");
  process.exit(0);
}

await fs.rm(atlasDir, { recursive: true, force: true });
await fs.mkdir(atlasDir, { recursive: true });

const iconsPerRow = Math.floor(maxAtlasSize / cellSize);
const iconsPerPage = iconsPerRow * iconsPerRow;
const refsByIconPath = new Map();
const files = [...iconEntries.keys()].sort();

console.log(
  `Building icon atlas for ${files.length} rendered icons: ${cellSize}px cells, ${maxAtlasSize}px pages, ${iconsPerPage} icons/page.`,
);

let pageIndex = 0;
let slotIndex = 0;
let atlas = createAtlas(maxAtlasSize);
let writtenPages = 0;

for (const iconPath of files) {
  const fileName = path.basename(iconPath);
  const absoluteIconPath = path.join(renderedDir, fileName);
  if (!existsSync(absoluteIconPath)) {
    continue;
  }

  const icon = PNG.sync.read(await fs.readFile(absoluteIconPath));
  if (icon.width > cellSize || icon.height > cellSize) {
    throw new Error(
      `${absoluteIconPath} is ${icon.width}x${icon.height}, larger than atlas cell ${cellSize}x${cellSize}.`,
    );
  }

  if (slotIndex >= iconsPerPage) {
    await writeAtlasPage(atlas, pageIndex);
    writtenPages += 1;
    pageIndex += 1;
    slotIndex = 0;
    atlas = createAtlas(maxAtlasSize);
  }

  const column = slotIndex % iconsPerRow;
  const row = Math.floor(slotIndex / iconsPerRow);
  const x = column * cellSize;
  const y = row * cellSize;
  blitCentered(icon, atlas, x, y, cellSize);

  refsByIconPath.set(iconPath, {
    imagePath: `/datasets/gtnh/${datasetVersionId}/textures/atlas/atlas-${String(pageIndex).padStart(4, "0")}.png`,
    atlasWidth: maxAtlasSize,
    atlasHeight: maxAtlasSize,
    x,
    y,
    width: cellSize,
    height: cellSize,
  });

  slotIndex += 1;
}

if (slotIndex > 0) {
  await writeAtlasPage(atlas, pageIndex);
  writtenPages += 1;
}

applyAtlasRefs(dataset, refsByIconPath);
await fs.writeFile(datasetPath, `${JSON.stringify(dataset)}\n`);

if (removeRenderedIcons) {
  await fs.rm(renderedDir, { recursive: true, force: true });
}

console.log(
  `Wrote ${writtenPages} atlas page(s) and replaced ${refsByIconPath.size} rendered icon references.`,
);

function collectRenderedIconEntries(dataset) {
  const entries = new Map();
  forEachResource(dataset, (resource) => {
    if (!isRenderedIconPath(resource.iconPath)) {
      return;
    }
    const list = entries.get(resource.iconPath) ?? [];
    list.push(resource);
    entries.set(resource.iconPath, list);
  });
  return entries;
}

function applyAtlasRefs(dataset, refsByPath) {
  forEachResource(dataset, (resource) => {
    const ref = refsByPath.get(resource.iconPath);
    if (!ref) {
      return;
    }
    resource.iconAtlas = ref;
    delete resource.iconPath;
  });
}

function forEachResource(dataset, callback) {
  for (const resource of dataset.resources ?? []) {
    callback(resource);
  }
  for (const resource of dataset.resourceIndex ?? []) {
    callback(resource);
  }
  for (const recipe of dataset.recipes ?? []) {
    for (const resource of recipe.inputs ?? []) {
      callback(resource);
    }
    for (const resource of recipe.outputs ?? []) {
      callback(resource);
    }
  }
}

function isRenderedIconPath(iconPath) {
  return typeof iconPath === "string" && iconPath.includes("/textures/rendered/");
}

function createAtlas(size) {
  return new PNG({
    width: size,
    height: size,
    colorType: 6,
    inputColorType: 6,
  });
}

function blitCentered(source, target, targetX, targetY, cellSize) {
  const offsetX = Math.floor((cellSize - source.width) / 2);
  const offsetY = Math.floor((cellSize - source.height) / 2);
  PNG.bitblt(
    source,
    target,
    0,
    0,
    source.width,
    source.height,
    targetX + offsetX,
    targetY + offsetY,
  );
}

async function writeAtlasPage(atlas, pageIndex) {
  const outputPath = path.join(atlasDir, `atlas-${String(pageIndex).padStart(4, "0")}.png`);
  await fs.writeFile(outputPath, PNG.sync.write(atlas, { colorType: 6 }));
}

function positiveIntEnv(name, fallback) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${rawValue}.`);
  }
  return value;
}
