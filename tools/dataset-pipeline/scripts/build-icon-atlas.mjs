import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { writeDatasetJson } from "./dataset-json-writer.mjs";

const datasetPath = process.argv[2];
const datasetOutDir = process.argv[3];

if (!datasetPath || !datasetOutDir) {
  throw new Error("Usage: build-icon-atlas.mjs <recipes.json> <dataset-out-dir>");
}

const datasetVersionId = path.basename(datasetOutDir);
const renderedDir = path.join(datasetOutDir, "textures", "rendered");
const atlasDir = path.join(datasetOutDir, "textures", "atlas");
const cellSize = positiveIntEnv("GTNH_ATLAS_ICON_SIZE", 256);
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
  const dominantColor = getDominantOpaqueColor(icon);

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
    dominantColor,
  });

  slotIndex += 1;
}

if (slotIndex > 0) {
  await writeAtlasPage(atlas, pageIndex);
  writtenPages += 1;
}

applyAtlasRefs(dataset, refsByIconPath);
await writeDatasetJson(datasetPath, dataset);

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

function getDominantOpaqueColor(icon) {
  const buckets = new Map();

  for (let y = 0; y < icon.height; y += 1) {
    for (let x = 0; x < icon.width; x += 1) {
      const index = (y * icon.width + x) * 4;
      const alpha = icon.data[index + 3];
      if (alpha < 24) {
        continue;
      }

      const red = icon.data[index];
      const green = icon.data[index + 1];
      const blue = icon.data[index + 2];
      const { hue, saturation, lightness } = rgbToHsl(red, green, blue);
      if (lightness < 0.05 || lightness > 0.96) {
        continue;
      }

      const bucket = Math.round(hue / 12) * 12;
      const weight = (alpha / 255) * (0.35 + saturation * 1.65);
      const current = buckets.get(bucket) ?? { weight: 0, red: 0, green: 0, blue: 0 };
      current.weight += weight;
      current.red += red * weight;
      current.green += green * weight;
      current.blue += blue * weight;
      buckets.set(bucket, current);
    }
  }

  const dominant = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!dominant || dominant.weight <= 0) {
    return "#6b7280";
  }

  return rgbToHex(
    Math.round(dominant.red / dominant.weight),
    Math.round(dominant.green / dominant.weight),
    Math.round(dominant.blue / dominant.weight),
  );
}

function rgbToHsl(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness };
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  return { hue: hue * 60, saturation, lightness };
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;
}

async function writeAtlasPage(atlas, pageIndex) {
  const outputPath = path.join(atlasDir, `atlas-${String(pageIndex).padStart(4, "0")}.png`);
  await fs.writeFile(outputPath, PNG.sync.write(atlas, { colorType: 6 }));
}

function positiveIntEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${rawValue}.`);
  }
  return value;
}
