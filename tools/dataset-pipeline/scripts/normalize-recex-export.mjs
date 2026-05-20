import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  throw new Error("Usage: normalize-recex-export.mjs <recex.json> <recipes.json>");
}

const datasetVersionId = requiredEnv("GTNH_DATASET_VERSION_ID");
const gtnhVersion = requiredEnv("GTNH_DATASET_VERSION_LABEL");
const generatedAt = new Date().toISOString();
const outDir = path.dirname(outputPath);
const renderedIconDir = process.env.GTNH_RENDERED_ICON_DIR;
const renderedIconFiles = await stageRenderedIcons(renderedIconDir, outDir);
const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
const gregtechSource = raw.sources?.find((source) => source.type === "gregtech");

if (!gregtechSource?.machines?.length) {
  throw new Error("RecEx export does not contain gregtech machines.");
}

const resources = new Map();
const recipeMaps = [];
const recipes = [];

for (const machine of gregtechSource.machines) {
  const machineType = text(machine.n, "unknown-machine");
  recipeMaps.push(machineType);

  for (const [index, rawRecipe] of (machine.recs ?? []).entries()) {
    if (!rawRecipe?.en || rawRecipe.dur <= 0) {
      continue;
    }

    const inputs = [
      ...(rawRecipe.iI ?? []).map(itemAmount),
      ...(rawRecipe.fI ?? []).map(fluidAmount),
    ].filter(Boolean);
    const outputs = [
      ...(rawRecipe.iO ?? []).map(itemAmount),
      ...(rawRecipe.fO ?? []).map(fluidAmount),
    ].filter(Boolean);

    if (outputs.length === 0) {
      continue;
    }

    for (const resource of [...inputs, ...outputs]) {
      const key = `${resource.kind}:${resource.id}`;
      const existingResource = resources.get(key);
      if (existingResource) {
        if (!existingResource.iconPath && resource.iconPath) {
          existingResource.iconPath = resource.iconPath;
        }
      } else {
        resources.set(key, {
          id: resource.id,
          kind: resource.kind,
          displayName: resource.displayName ?? resource.id,
          iconPath: resource.iconPath,
        });
      }
    }

    const primaryOutput = outputs[0];
    recipes.push({
      id: `recex:${datasetVersionId}:${slug(machineType)}:${hashRecipe(machineType, index, rawRecipe)}`,
      name: `${machineType}: ${primaryOutput.displayName ?? primaryOutput.id}`,
      machineType,
      minimumTier: "UNKNOWN",
      durationTicks: rawRecipe.dur,
      eut: rawRecipe.eut ?? 0,
      inputs,
      outputs,
      notes:
        "Generated from a real GTNH RecEx runtime export. Tier, circuit, and chance metadata are best-effort until a richer exporter normalizer is added.",
      source: {
        datasetVersionId,
        recipeMap: machineType,
        exporter: "recex",
        rawRecipeId: `${machineType}:${index}`,
      },
      nei: {
        additionalInfo: [`Special value: ${rawRecipe.sp ?? 0}`],
      },
    });
  }
}

const dataset = {
  schemaVersion: 1,
  datasetVersionId,
  gtnhVersion,
  sourceInfo: {
    sourceId: "recex",
    generatedAt,
    notes:
      "Generated automatically by GTNH Factory Flow CI from a GTNH pack runtime export. Not a public dump.",
  },
  resources: [...resources.values()].sort(compareById),
  recipes,
  oreDictionary: {},
  recipeMaps: [...new Set(recipeMaps)].sort(),
  generatedAt,
};

if (dataset.recipes.length === 0) {
  throw new Error("RecEx normalization produced zero recipes.");
}

await pruneUnusedRenderedIcons(dataset, outDir);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Wrote ${dataset.recipes.length} recipes to ${outputPath}.`);

function itemAmount(item) {
  if (!item?.id || !Number.isFinite(item.a) || item.a <= 0) {
    return undefined;
  }

  const id = item.m === undefined || item.m === 0 ? item.id : `${item.id}@${item.m}`;
  const iconPath = renderedIconPath(item.ic);
  return {
    kind: "item",
    id,
    amount: item.a,
    displayName: text(item.lN, id),
    tooltip: item.nbt ? [`NBT: ${item.nbt}`] : undefined,
    iconPath,
  };
}

function fluidAmount(fluid) {
  if (!fluid?.id || !Number.isFinite(fluid.a) || fluid.a <= 0) {
    return undefined;
  }

  return {
    kind: "fluid",
    id: fluid.id,
    amount: fluid.a,
    displayName: text(fluid.lN, fluid.id),
  };
}

function hashRecipe(machineType, index, recipe) {
  return crypto
    .createHash("sha1")
    .update(`${machineType}:${index}:${JSON.stringify(recipe)}`)
    .digest("hex")
    .slice(0, 12);
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function text(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function compareById(a, b) {
  return a.id.localeCompare(b.id);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

async function stageRenderedIcons(sourceDir, datasetOutDir) {
  const files = new Set();
  if (!sourceDir) {
    return files;
  }

  try {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    const outputDir = path.join(datasetOutDir, "textures", "rendered");
    await fs.mkdir(outputDir, { recursive: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".png")) {
        continue;
      }

      const fileName = path.basename(entry.name);
      await fs.copyFile(path.join(sourceDir, fileName), path.join(outputDir, fileName));
      files.add(fileName);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return files;
}

function renderedIconPath(fileName) {
  if (!fileName) {
    return undefined;
  }

  const safeFileName = path.basename(String(fileName));
  if (!renderedIconFiles.has(safeFileName)) {
    return undefined;
  }

  return `/datasets/gtnh/${datasetVersionId}/textures/rendered/${safeFileName}`;
}

async function pruneUnusedRenderedIcons(dataset, datasetOutDir) {
  const renderedDir = path.join(datasetOutDir, "textures", "rendered");
  const usedFiles = new Set();

  for (const resource of dataset.resources ?? []) {
    addRenderedFile(resource.iconPath, usedFiles);
  }
  for (const recipe of dataset.recipes ?? []) {
    for (const resource of [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])]) {
      addRenderedFile(resource.iconPath, usedFiles);
    }
  }

  let entries;
  try {
    entries = await fs.readdir(renderedDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".png")) {
      continue;
    }
    if (usedFiles.has(entry.name)) {
      continue;
    }
    await fs.rm(path.join(renderedDir, entry.name), { force: true });
    removed += 1;
  }

  if (removed > 0) {
    console.log(`Removed ${removed} unreferenced rendered icons.`);
  }
}

function addRenderedFile(iconPath, usedFiles) {
  if (!iconPath || !String(iconPath).includes("/textures/rendered/")) {
    return;
  }
  usedFiles.add(path.basename(String(iconPath)));
}
