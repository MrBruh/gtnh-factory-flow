import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { writeDatasetJson } from "./dataset-json-writer.mjs";

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
const raw = JSON.parse(stripBom(await fs.readFile(inputPath, "utf8")));

const resources = new Map();
const recipeMaps = [];
const recipes = [];
const recipeSignatures = new Set();
const oreDictionary = {};

const sources = Array.isArray(raw.sources) ? raw.sources : [];
const gregtechSource = sources.find((source) => source.type === "gregtech");

if (gregtechSource?.machines?.length) {
  normalizeGregtechRecipes(gregtechSource);
}

normalizeCraftingSource(findSource("shaped"), {
  machineType: "Shaped Crafting",
  sourceType: "shaped",
});
normalizeCraftingSource(findSource("shapeless"), {
  machineType: "Shapeless Crafting",
  sourceType: "shapeless",
});
normalizeCraftingSource(findSource("shapedOreDict"), {
  machineType: "Shaped Crafting",
  sourceType: "shapedOreDict",
});
normalizeSmeltingSource(findSource("smelting"));

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
  oreDictionary: sortOreDictionary(oreDictionary),
  recipeMaps: [...new Set(recipeMaps)].sort(),
  generatedAt,
};

if (dataset.recipes.length === 0) {
  throw new Error("RecEx normalization produced zero recipes.");
}

await pruneUnusedRenderedIcons(dataset, outDir);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await writeDatasetJson(outputPath, dataset);
console.log(`Wrote ${dataset.recipes.length} recipes to ${outputPath}.`);

function normalizeGregtechRecipes(source) {
  for (const machine of source.machines) {
    const machineType = text(machine.n, "unknown-machine");
    recipeMaps.push(machineType);

    for (const [index, rawRecipe] of (machine.recs ?? []).entries()) {
      if (!rawRecipe?.en || rawRecipe.dur <= 0) {
        continue;
      }

      const inputs = [
        ...(rawRecipe.iI ?? []).map((item) => {
          const nonConsumedInput =
            isNonConsumedInput(item) || isCircuitItem(item) || isReusableToolInput(item);
          return itemAmount(item, {
            consumed: !nonConsumedInput,
            defaultAmount: nonConsumedInput ? 1 : undefined,
          });
        }),
        ...(rawRecipe.iNC ?? []).map((item) =>
          itemAmount(item, { consumed: false, defaultAmount: 1 }),
        ),
        ...(rawRecipe.nCI ?? []).map((item) =>
          itemAmount(item, { consumed: false, defaultAmount: 1 }),
        ),
        ...(rawRecipe.ncI ?? []).map((item) =>
          itemAmount(item, { consumed: false, defaultAmount: 1 }),
        ),
        ...(rawRecipe.fI ?? []).map(fluidAmount),
      ].filter(Boolean);
      const outputs = [
        ...(rawRecipe.iO ?? []).map((item) => itemAmount(item, { chance: outputChance(item) })),
        ...(rawRecipe.fO ?? []).map(fluidAmount),
      ].filter(Boolean);

      if (outputs.length === 0) {
        continue;
      }

      addRecipe({
        id: `recex:${datasetVersionId}:${slug(machineType)}:${hashRecipe(machineType, index, rawRecipe)}`,
        name: `${machineType}: ${outputs[0].displayName ?? outputs[0].id}`,
        machineType,
        minimumTier: "UNKNOWN",
        durationTicks: rawRecipe.dur,
        eut: rawRecipe.eut ?? 0,
        inputs,
        outputs,
        programmedCircuit: detectProgrammedCircuit(inputs),
        notes:
          "Generated from a real GTNH RecEx runtime export. Tier metadata is best-effort until a richer exporter normalizer is added.",
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
}

function normalizeCraftingSource(source, { machineType, sourceType }) {
  if (!source?.recipes?.length) {
    return;
  }

  recipeMaps.push(machineType);

  for (const [index, rawRecipe] of source.recipes.entries()) {
    const inputs = (rawRecipe.iI ?? [])
      .map((item) => itemOrOreDictionaryAmount(item))
      .filter(Boolean);
    const output = itemAmount(rawRecipe.o);

    if (!output) {
      continue;
    }

    addRecipe({
      id: `recex:${datasetVersionId}:${slug(machineType)}:${hashRecipe(sourceType, index, rawRecipe)}`,
      name: `${machineType}: ${output.displayName ?? output.id}`,
      machineType,
      minimumTier: "NONE",
      durationTicks: 20,
      eut: 0,
      inputs,
      outputs: [output],
      notes: "Generated from a real GTNH RecEx runtime export.",
      source: {
        datasetVersionId,
        recipeMap: machineType,
        exporter: "recex",
        rawRecipeId: `${sourceType}:${index}`,
      },
      nei: {
        itemInputGrid: { width: 3, height: 3 },
        itemOutputGrid: { width: 1, height: 1 },
      },
    });
  }
}

function normalizeSmeltingSource(source) {
  if (!source?.recipes?.length) {
    return;
  }

  const machineType = "Furnace";
  recipeMaps.push(machineType);

  for (const [index, rawRecipe] of source.recipes.entries()) {
    const input = itemAmount(rawRecipe.input);
    const output = itemAmount(rawRecipe.output);

    if (!input || !output) {
      continue;
    }

    addRecipe({
      id: `recex:${datasetVersionId}:${slug(machineType)}:${hashRecipe("smelting", index, rawRecipe)}`,
      name: `${machineType}: ${output.displayName ?? output.id}`,
      machineType,
      minimumTier: "NONE",
      durationTicks: 200,
      eut: 0,
      inputs: [input],
      outputs: [output],
      notes: "Generated from a real GTNH RecEx runtime export.",
      source: {
        datasetVersionId,
        recipeMap: machineType,
        exporter: "recex",
        rawRecipeId: `smelting:${index}`,
      },
      nei: {
        itemInputGrid: { width: 1, height: 1 },
        itemOutputGrid: { width: 1, height: 1 },
      },
    });
  }
}

function addRecipe(recipe) {
  const signature = recipeSignature(recipe);
  if (recipeSignatures.has(signature)) {
    return;
  }
  recipeSignatures.add(signature);

  for (const resource of [...recipe.inputs, ...recipe.outputs]) {
    addResource(resource);
  }
  recipes.push(recipe);
}

function recipeSignature(recipe) {
  return JSON.stringify({
    machineType: recipe.machineType,
    minimumTier: recipe.minimumTier,
    durationTicks: recipe.durationTicks,
    eut: recipe.eut,
    programmedCircuit: recipe.programmedCircuit,
    inputs: recipe.inputs?.map(resourceSignature) ?? [],
    outputs: recipe.outputs?.map(resourceSignature) ?? [],
  });
}

function resourceSignature(resource) {
  return [
    resource.kind,
    resource.id,
    resource.amount,
    resource.consumed === false ? "nc" : "",
    resource.chance ?? "",
  ];
}

function addResource(resource) {
  const key = `${resource.kind}:${resource.id}`;
  const existingResource = resources.get(key);
  if (existingResource) {
    if (!existingResource.iconPath && resource.iconPath) {
      existingResource.iconPath = resource.iconPath;
    }
    if (!existingResource.tooltip && resource.tooltip) {
      existingResource.tooltip = resource.tooltip;
    }
    if (!existingResource.oreDictionary && resource.oreDictionary) {
      existingResource.oreDictionary = resource.oreDictionary;
    }
    if (!existingResource.alternatives && resource.alternatives) {
      existingResource.alternatives = resource.alternatives;
    }
    return;
  }

  resources.set(key, {
    id: resource.id,
    kind: resource.kind,
    displayName: resource.displayName ?? resource.id,
    iconPath: resource.iconPath,
    tooltip: resource.tooltip,
    oreDictionary: resource.oreDictionary,
    alternatives: resource.alternatives,
  });
}

function findSource(type) {
  return sources.find((source) => source.type === type);
}

function itemAmount(item, options = {}) {
  const amount = Number.isFinite(item?.a) && item.a > 0 ? item.a : options.defaultAmount;
  if (!item?.id || !Number.isFinite(amount) || amount <= 0) {
    return undefined;
  }

  const id = item.m === undefined || item.m === 0 ? item.id : `${item.id}@${item.m}`;
  const iconPath = renderedIconPath(item.ic);
  const resource = {
    kind: "item",
    id,
    amount,
    displayName: text(item.lN, id),
    tooltip: itemTooltip(item, id, options),
    iconPath,
    consumed: options.consumed === false ? false : undefined,
  };
  if (options.chance !== undefined) {
    resource.chance = options.chance;
  }
  return resource;
}

function itemOrOreDictionaryAmount(item) {
  if (item?.dns || item?.ims) {
    return oreDictionaryAmount(item);
  }

  return itemAmount(item);
}

function oreDictionaryAmount(item) {
  const names = (item.dns ?? []).map((name) => text(name, "")).filter(Boolean);
  const alternatives = (item.ims ?? []).map((entry) => itemAmount(entry)).filter(Boolean);

  if (names.length === 0 && alternatives.length === 0) {
    return undefined;
  }

  const primaryName = names[0] ?? alternatives[0].id;
  const primaryAlternative = alternatives.find((entry) => entry.iconPath) ?? alternatives[0];
  const id = `oredict:${primaryName}`;
  const alternativeIds = alternatives.map((entry) => entry.id);
  for (const name of names) {
    oreDictionary[name] = [...new Set([...(oreDictionary[name] ?? []), ...alternativeIds])].sort();
  }

  return {
    kind: "item",
    id,
    amount: 1,
    displayName: primaryAlternative?.displayName ?? primaryName,
    iconPath: primaryAlternative?.iconPath,
    alternatives: alternatives.map(resourceAlternative),
    tooltip: [
      names.length > 0 ? `Ore dictionary: ${names.join(", ")}` : undefined,
      alternatives.length > 0
        ? `Accepts: ${alternatives
            .slice(0, 12)
            .map((entry) => entry.displayName ?? entry.id)
            .join(", ")}${alternatives.length > 12 ? `, +${alternatives.length - 12} more` : ""}`
        : undefined,
    ].filter(Boolean),
    oreDictionary: names.length > 0 ? names : undefined,
  };
}

function resourceAlternative(resource) {
  return {
    kind: resource.kind,
    id: resource.id,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    tooltip: resource.tooltip,
  };
}

function outputChance(item) {
  if (!Number.isFinite(item?.ch)) {
    return undefined;
  }

  if (item.ch <= 0) {
    return undefined;
  }

  const chance = item.ch / 10000;
  if (chance >= 1) {
    return undefined;
  }

  return Math.max(0, Math.min(1, chance));
}

function detectProgrammedCircuit(inputs) {
  const circuit = inputs.find(isCircuitResource);

  if (!circuit) {
    return undefined;
  }

  const configuration = circuitConfiguration(circuit);
  const label = circuit.displayName ?? circuit.id;
  return configuration ? `${label} (configuration ${configuration})` : label;
}

function isNonConsumedInput(item) {
  return Boolean(
    item?.nc || item?.nC || item?.notConsumed || item?.nonConsumed || item?.consumed === false,
  );
}

function isCircuitItem(item) {
  if (!item?.id) {
    return false;
  }

  const label = `${item.id} ${text(item.lN, "")}`.toLowerCase();
  return (
    label.includes("programmed circuit") ||
    label.includes("integrated circuit") ||
    label.includes("circuit configuration")
  );
}

function isReusableToolInput(item) {
  const label = text(item?.lN, "").toLowerCase();
  const id = text(item?.id, "").toLowerCase();
  return (
    /^mold \(/.test(label) ||
    /^extruder shape \(/.test(label) ||
    /^shape mold \(/.test(label) ||
    /^slicer shape \(/.test(label) ||
    id.includes("shape_mold_") ||
    id.includes("shape_extruder_") ||
    id.includes("shape_slicer_")
  );
}

function itemTooltip(item, id, options) {
  const configuration = circuitConfiguration({
    kind: "item",
    id,
    displayName: text(item.lN, id),
  });
  const tooltip = [
    item.nbt ? `NBT: ${item.nbt}` : undefined,
    configuration ? `Configuration: ${configuration}` : undefined,
    options.consumed === false ? "Does not get consumed in the process" : undefined,
  ].filter(Boolean);

  return tooltip.length > 0 ? tooltip : undefined;
}

function isCircuitResource(resource) {
  if (resource.kind !== "item") {
    return false;
  }

  const label = `${resource.displayName ?? ""} ${resource.id}`.toLowerCase();
  return (
    label.includes("programmed circuit") ||
    label.includes("integrated circuit") ||
    label.includes("circuit configuration") ||
    label.includes("gt.integrated_circuit")
  );
}

function circuitConfiguration(resource) {
  if (!isCircuitResource(resource)) {
    return undefined;
  }

  const meta = /@(\d+)$/.exec(resource.id)?.[1];
  if (meta) {
    return meta;
  }

  return /configuration\s*[:=]\s*(\d+)/i.exec(resource.displayName ?? "")?.[1];
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
    iconPath: renderedIconPath(fluid.ic),
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

function sortOreDictionary(value) {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entries]) => [key, [...new Set(entries)].sort()]),
  );
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
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
