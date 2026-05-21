import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import {
  forEachResource,
  getDominantOpaqueColor,
  publicPathToFile,
  readDataset,
  writeDataset,
} from "./icon-utils.mjs";

const datasetPath = process.argv[2];
const datasetOutDir = process.argv[3];

if (!datasetPath || !datasetOutDir) {
  throw new Error("Usage: explode-icon-atlas.mjs <recipes.json|recipes.json.gz> <dataset-out-dir>");
}

const dataset = await readDataset(datasetPath);
const versionId = dataset.datasetVersionId ?? path.basename(datasetOutDir);
const atlasDir = path.join(datasetOutDir, "textures", "atlas");
const iconsDir = path.join(datasetOutDir, "textures", "icons");
const refsByKey = new Map();
const refsByPage = new Map();

forEachResource(dataset, (resource) => {
  if (!resource.iconAtlas) {
    return;
  }

  const ref = resource.iconAtlas;
  const key = atlasRefKey(ref);
  if (refsByKey.has(key)) {
    return;
  }

  refsByKey.set(key, ref);
  const refs = refsByPage.get(ref.imagePath) ?? [];
  refs.push(ref);
  refsByPage.set(ref.imagePath, refs);
});

if (refsByKey.size === 0) {
  console.log("No atlas icon references found; skipping atlas explosion.");
  process.exit(0);
}

await fs.rm(iconsDir, { recursive: true, force: true });
await fs.mkdir(iconsDir, { recursive: true });

const standaloneRefs = new Map();
let processed = 0;

for (const [imagePath, refs] of [...refsByPage.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  const atlasPath = publicPathToFile(imagePath);
  if (!existsSync(atlasPath)) {
    throw new Error(`Atlas page not found: ${imagePath}`);
  }

  const atlas = PNG.sync.read(await fs.readFile(atlasPath));
  for (const ref of refs) {
    validateAtlasRef(ref, atlas);
    const icon = new PNG({
      width: ref.width,
      height: ref.height,
      colorType: 6,
      inputColorType: 6,
    });
    PNG.bitblt(atlas, icon, ref.x, ref.y, ref.width, ref.height, 0, 0);

    const key = atlasRefKey(ref);
    const fileName = `icon-${createHash("sha1").update(key).digest("hex").slice(0, 16)}.png`;
    await fs.writeFile(path.join(iconsDir, fileName), PNG.sync.write(icon, { colorType: 6 }));
    standaloneRefs.set(key, {
      iconPath: `/datasets/gtnh/${versionId}/textures/icons/${fileName}`,
      dominantColor: ref.dominantColor ?? getDominantOpaqueColor(icon),
    });
    processed += 1;
  }

  console.log(`Exploded ${processed}/${refsByKey.size} atlas icon(s).`);
}

forEachResource(dataset, (resource) => {
  if (!resource.iconAtlas) {
    return;
  }

  const ref = standaloneRefs.get(atlasRefKey(resource.iconAtlas));
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
await fs.rm(atlasDir, { recursive: true, force: true });

console.log(`Replaced ${standaloneRefs.size} atlas icon reference(s) with standalone icons.`);

function atlasRefKey(ref) {
  return [ref.imagePath, ref.x, ref.y, ref.width, ref.height].join(":");
}

function validateAtlasRef(ref, atlas) {
  if (
    ref.x < 0 ||
    ref.y < 0 ||
    ref.width <= 0 ||
    ref.height <= 0 ||
    ref.x + ref.width > atlas.width ||
    ref.y + ref.height > atlas.height
  ) {
    throw new Error(`Invalid atlas rect ${atlasRefKey(ref)} for ${atlas.width}x${atlas.height}.`);
  }
}
