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
      resources.set(`${resource.kind}:${resource.id}`, {
        id: resource.id,
        kind: resource.kind,
        displayName: resource.displayName ?? resource.id,
      });
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

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Wrote ${dataset.recipes.length} recipes to ${outputPath}.`);

function itemAmount(item) {
  if (!item?.id || !Number.isFinite(item.a) || item.a <= 0) {
    return undefined;
  }

  const id = item.m === undefined || item.m === 0 ? item.id : `${item.id}@${item.m}`;
  return {
    kind: "item",
    id,
    amount: item.a,
    displayName: text(item.lN, id),
    tooltip: item.nbt ? [`NBT: ${item.nbt}`] : undefined,
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
