import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const channel = requiredEnv("GTNH_CHANNEL");
const versionId = requiredEnv("GTNH_VERSION_ID");
const versionLabel = requiredEnv("GTNH_VERSION_LABEL");
const sourceKind = requiredEnv("GTNH_SOURCE_KIND");
const sourceRef = requiredEnv("GTNH_SOURCE_REF");
const sourceUrl = process.env.GTNH_SOURCE_URL;
const exportCommand =
  process.env.GTNH_CLIENT_EXPORT_COMMAND ||
  "bash tools/dataset-pipeline/scripts/run-gtnh-recex-export.sh";
const outDir = path.join("public", "datasets", "gtnh", versionId);
const pipelineDir = ".pipeline";
const instanceDir = path.join(pipelineDir, "client-instance", versionId);
const rawExportDir = path.join(pipelineDir, "raw-export", versionId);

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(pipelineDir, { recursive: true });
await fs.mkdir(instanceDir, { recursive: true });
await fs.mkdir(rawExportDir, { recursive: true });

const pipelineRecord = {
  schemaVersion: 1,
  status: "started",
  channel,
  versionId,
  versionLabel,
  sourceKind,
  sourceRef,
  sourceUrl,
  generatedAt: new Date().toISOString(),
};

console.log(`Running configured exporter for ${versionId}.`);
const { spawn } = await import("node:child_process");
const exitCode = await new Promise((resolve) => {
  const child = spawn(exportCommand, {
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      GTNH_DATASET_OUT_DIR: outDir,
      GTNH_DATASET_VERSION_ID: versionId,
      GTNH_DATASET_CHANNEL: channel,
      GTNH_DATASET_VERSION_LABEL: versionLabel,
      GTNH_INSTANCE_DIR: instanceDir,
      GTNH_RAW_EXPORT_DIR: rawExportDir,
      GTNH_SOURCE_KIND: sourceKind,
      GTNH_SOURCE_REF: sourceRef,
      ...(sourceUrl ? { GTNH_SOURCE_URL: sourceUrl } : {}),
    },
  });
  child.on("exit", (code) => resolve(code ?? 1));
});

if (exitCode !== 0) {
  throw new Error(`Exporter command failed with exit code ${exitCode}.`);
}

const recipeDatasetPath = path.join(outDir, "recipes.json");
if (!existsSync(recipeDatasetPath)) {
  throw new Error(
    `Exporter command completed but did not create ${recipeDatasetPath}. The app expects a normalized RecipeDataset JSON file named recipes.json.`,
  );
}

let dataset = JSON.parse(await fs.readFile(recipeDatasetPath, "utf8"));
validateDataset(dataset);
await pruneRenderedIcons(recipeDatasetPath, path.join(outDir, "textures", "rendered"));
await buildIconAtlas(recipeDatasetPath, outDir);
dataset = JSON.parse(await fs.readFile(recipeDatasetPath, "utf8"));
validateDataset(dataset);

const compactDatasetJson = JSON.stringify(dataset);
const compressedRecipeDatasetPath = `${recipeDatasetPath}.gz`;
await fs.writeFile(compressedRecipeDatasetPath, gzipSync(compactDatasetJson, { level: 9 }));
await fs.rm(recipeDatasetPath, { force: true });

await writePipelineRecord({
  ...pipelineRecord,
  status: "generated",
  recipeCount: dataset.recipes.length,
  resourceCount: dataset.resources.length,
  recipeMapCount: dataset.recipeMaps.length,
  recipeDatasetPath: compressedRecipeDatasetPath,
  uncompressedSizeBytes: Buffer.byteLength(compactDatasetJson),
  compressedSizeBytes: (await fs.stat(compressedRecipeDatasetPath)).size,
});

function validateDataset(dataset) {
  if (dataset.schemaVersion !== 1) {
    throw new Error("recipes.json must be a RecipeDataset with schemaVersion 1.");
  }
  if (dataset.datasetVersionId !== versionId) {
    throw new Error(
      `recipes.json datasetVersionId must be ${versionId}, got ${dataset.datasetVersionId}.`,
    );
  }
  if (dataset.gtnhVersion !== versionLabel) {
    throw new Error(
      `recipes.json gtnhVersion must be ${versionLabel}, got ${dataset.gtnhVersion}.`,
    );
  }
  if (!dataset.sourceInfo || dataset.sourceInfo.sourceId === "unknown") {
    throw new Error("recipes.json sourceInfo.sourceId must identify nesql, recex, or nerd.");
  }
  if (!Array.isArray(dataset.resources)) {
    throw new Error("recipes.json resources must be an array.");
  }
  if (!Array.isArray(dataset.recipes) || dataset.recipes.length === 0) {
    throw new Error("recipes.json recipes must be a non-empty array from the client export.");
  }
  if (!Array.isArray(dataset.recipeMaps)) {
    throw new Error("recipes.json recipeMaps must be an array.");
  }
  if (!dataset.oreDictionary || typeof dataset.oreDictionary !== "object") {
    throw new Error("recipes.json oreDictionary must be an object.");
  }
}

async function writePipelineRecord(record) {
  await fs.writeFile(
    path.join(pipelineDir, `${versionId}.pipeline.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

async function pruneRenderedIcons(datasetPath, renderedDir) {
  if (!existsSync(renderedDir)) {
    return;
  }

  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      "node",
      ["tools/dataset-pipeline/scripts/prune-blank-rendered-icons.mjs", datasetPath, renderedDir],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          PRUNE_ATLAS_LIKE_ICONS: "true",
        },
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`Rendered icon pruning failed with exit code ${exitCode}.`);
  }
}

async function buildIconAtlas(datasetPath, datasetOutDir) {
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      "node",
      ["tools/dataset-pipeline/scripts/build-icon-atlas.mjs", datasetPath, datasetOutDir],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          GTNH_ATLAS_ICON_SIZE: process.env.GTNH_ATLAS_ICON_SIZE ?? "1024",
          GTNH_ATLAS_MAX_SIZE: process.env.GTNH_ATLAS_MAX_SIZE ?? "8192",
        },
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`Icon atlas build failed with exit code ${exitCode}.`);
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}
