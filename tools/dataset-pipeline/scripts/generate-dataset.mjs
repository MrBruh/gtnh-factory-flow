import fs from "node:fs/promises";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

const channel = requiredEnv("GTNH_CHANNEL");
const versionId = requiredEnv("GTNH_VERSION_ID");
const versionLabel = requiredEnv("GTNH_VERSION_LABEL");
const sourceKind = requiredEnv("GTNH_SOURCE_KIND");
const sourceRef = requiredEnv("GTNH_SOURCE_REF");
const sourceUrl = process.env.GTNH_SOURCE_URL;
const exportCommand =
  process.env.GTNH_CLIENT_EXPORT_COMMAND ||
  "bash tools/dataset-pipeline/scripts/run-gtnh-recex-export.sh";
const datasetsRoot = process.env.GTNH_DATASETS_ROOT ?? path.join("public", "datasets", "gtnh");
const outDir = path.join(datasetsRoot, versionId);
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
console.log(`Exporter finished for ${versionId}.`);

const recipeDatasetPath = path.join(outDir, "recipes.json");
if (!existsSync(recipeDatasetPath)) {
  throw new Error(
    `Exporter command completed but did not create ${recipeDatasetPath}. The app expects a normalized RecipeDataset JSON file named recipes.json.`,
  );
}

console.log(`Validating dataset for ${versionId}.`);
const datasetStats = await readDatasetStatsAndValidate(recipeDatasetPath);
const postProcessMaxDatasetBytes = positiveIntEnv(
  "GTNH_ICON_POST_PROCESS_MAX_DATASET_BYTES",
  450_000_000,
);
const recipeDatasetSizeBytes = (await fs.stat(recipeDatasetPath)).size;
if (recipeDatasetSizeBytes <= postProcessMaxDatasetBytes) {
  console.log(`Pruning rendered icons for ${versionId}.`);
  await pruneRenderedIcons(recipeDatasetPath, path.join(outDir, "textures", "rendered"));
  console.log(`Finalizing rendered icons for ${versionId}.`);
  await finalizeRenderedIcons(recipeDatasetPath, outDir);
} else {
  console.log(
    `Skipping rendered icon cleanup/finalization for ${versionId}: dataset is ${recipeDatasetSizeBytes} bytes.`,
  );
}
console.log(`Building resource index for ${versionId}.`);
await buildResourceIndex(recipeDatasetPath);
console.log(`Building recipe index for ${versionId}.`);
await buildRecipeIndex(recipeDatasetPath, outDir);

const compressedRecipeDatasetPath = `${recipeDatasetPath}.gz`;
const uncompressedSizeBytes = (await fs.stat(recipeDatasetPath)).size;
console.log(`Compressing dataset for ${versionId}.`);
await gzipFile(recipeDatasetPath, compressedRecipeDatasetPath);
await fs.rm(recipeDatasetPath, { force: true });

console.log(`Writing pipeline record for ${versionId}.`);
await writePipelineRecord({
  ...pipelineRecord,
  status: "generated",
  ...datasetStats,
  recipeDatasetPath: compressedRecipeDatasetPath,
  uncompressedSizeBytes,
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

async function readDatasetStatsAndValidate(datasetPath) {
  const dataset = {};
  const counts = {
    recipeCount: 0,
    resourceCount: 0,
    recipeMapCount: 0,
  };
  const countedArrays = new Map([
    ["recipes", "recipeCount"],
    ["resources", "resourceCount"],
    ["recipeMaps", "recipeMapCount"],
  ]);
  let currentArrayKey;
  let skippingArray = false;
  let skippingObject = false;

  const lines = readline.createInterface({
    input: createReadStream(datasetPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "{" || line === "}") {
      continue;
    }

    if (currentArrayKey || skippingArray) {
      if (line === "]," || line === "]") {
        currentArrayKey = undefined;
        skippingArray = false;
        continue;
      }

      if (currentArrayKey) {
        counts[countedArrays.get(currentArrayKey)] += 1;
      }
      continue;
    }

    if (skippingObject) {
      if (line === "}," || line === "}") {
        skippingObject = false;
      }
      continue;
    }

    const match = /^("(?:(?:\\.)|[^"\\])*"):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const key = JSON.parse(match[1]);
    const value = match[2].replace(/,$/, "");
    if (value === "[") {
      if (countedArrays.has(key)) {
        dataset[key] = [];
        currentArrayKey = key;
      } else {
        skippingArray = true;
      }
      continue;
    }

    if (value === "{") {
      dataset[key] = {};
      skippingObject = true;
      continue;
    }

    dataset[key] = JSON.parse(value);
  }

  validateDataset({
    ...dataset,
    recipes: new Array(counts.recipeCount),
    resources: new Array(counts.resourceCount),
    recipeMaps: new Array(counts.recipeMapCount),
  });

  return counts;
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

async function finalizeRenderedIcons(datasetPath, datasetOutDir) {
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      "node",
      ["tools/dataset-pipeline/scripts/finalize-rendered-icons.mjs", datasetPath, datasetOutDir],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`Standalone icon finalization failed with exit code ${exitCode}.`);
  }
}

async function buildResourceIndex(datasetPath) {
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      "node",
      ["tools/dataset-pipeline/scripts/build-resource-index.mjs", datasetPath],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`Resource index build failed with exit code ${exitCode}.`);
  }
}

async function buildRecipeIndex(datasetPath, datasetOutDir) {
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      "node",
      ["tools/dataset-pipeline/scripts/build-recipe-index.mjs", datasetPath, datasetOutDir],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`Recipe index build failed with exit code ${exitCode}.`);
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function positiveIntEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

async function gzipFile(inputPath, outputPath) {
  await pipeline(
    createReadStream(inputPath),
    createGzip({ level: 9 }),
    createWriteStream(outputPath),
  );
}
