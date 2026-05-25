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
const rawItemResources = collectRawItemResources(raw);

const resources = new Map();
const recipeMaps = [];
const recipes = [];
const recipeSignatures = new Set();
const oreDictionary = {};

const heatingCoilTiers = [
  { heat: 1801, key: "cupronickel", label: "Cupronickel", blockId: "gregtech:gt.blockcasings5" },
  { heat: 2701, key: "kanthal", label: "Kanthal", blockId: "gregtech:gt.blockcasings5@1" },
  { heat: 3601, key: "nichrome", label: "Nichrome", blockId: "gregtech:gt.blockcasings5@2" },
  { heat: 4501, key: "tpv", label: "TPV-Alloy", blockId: "gregtech:gt.blockcasings5@3" },
  { heat: 5401, key: "hss_g", label: "HSS-G", blockId: "gregtech:gt.blockcasings5@4" },
  { heat: 6301, key: "hss_s", label: "HSS-S", blockId: "gregtech:gt.blockcasings5@9" },
  { heat: 7201, key: "naquadah", label: "Naquadah", blockId: "gregtech:gt.blockcasings5@5" },
  {
    heat: 8101,
    key: "naquadah_alloy",
    label: "Naquadah Alloy",
    blockId: "gregtech:gt.blockcasings5@6",
  },
  { heat: 9001, key: "trinium", label: "Trinium", blockId: "gregtech:gt.blockcasings5@10" },
  {
    heat: 9901,
    key: "electrum_flux",
    label: "Electrum Flux",
    blockId: "gregtech:gt.blockcasings5@7",
  },
  {
    heat: 10801,
    key: "awakened_draconium",
    label: "Awakened Draconium",
    blockId: "gregtech:gt.blockcasings5@8",
  },
  { heat: 11701, key: "infinity", label: "Infinity", blockId: "gregtech:gt.blockcasings5@11" },
  { heat: 12601, key: "hypogen", label: "Hypogen", blockId: "gregtech:gt.blockcasings5@12" },
  { heat: 13501, key: "eternal", label: "Eternal", blockId: "gregtech:gt.blockcasings5@13" },
];

const pipeCasingTiers = [
  { key: "bronze", label: "Bronze", blockId: "gregtech:gt.blockcasings2@12" },
  { key: "steel", label: "Steel", blockId: "gregtech:gt.blockcasings2@13" },
  { key: "titanium", label: "Titanium", blockId: "gregtech:gt.blockcasings2@14" },
  { key: "tungstensteel", label: "Tungstensteel", blockId: "gregtech:gt.blockcasings2@15" },
  { key: "ptfe", label: "PTFE", blockId: "gregtech:gt.blockcasings8@1" },
  { key: "pbi", label: "PBI", blockId: "gregtech:gt.blockcasings9" },
];

const solenoidTiers = [
  { key: "mv", label: "MV", blockId: "gregtech:gt.blockcasings.cyclotron_coils", voltageTier: 2 },
  { key: "hv", label: "HV", blockId: "gregtech:gt.blockcasings.cyclotron_coils@1", voltageTier: 3 },
  { key: "ev", label: "EV", blockId: "gregtech:gt.blockcasings.cyclotron_coils@2", voltageTier: 4 },
  { key: "iv", label: "IV", blockId: "gregtech:gt.blockcasings.cyclotron_coils@3", voltageTier: 5 },
  {
    key: "luv",
    label: "LuV",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@4",
    voltageTier: 6,
  },
  {
    key: "zpm",
    label: "ZPM",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@5",
    voltageTier: 7,
  },
  { key: "uv", label: "UV", blockId: "gregtech:gt.blockcasings.cyclotron_coils@6", voltageTier: 8 },
  {
    key: "uhv",
    label: "UHV",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@7",
    voltageTier: 9,
  },
  {
    key: "uev",
    label: "UEV",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@8",
    voltageTier: 10,
  },
  {
    key: "uiv",
    label: "UIV",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@9",
    voltageTier: 11,
  },
  {
    key: "umv",
    label: "UMV",
    blockId: "gregtech:gt.blockcasings.cyclotron_coils@10",
    voltageTier: 12,
  },
];

const treeGrowthSimulatorTools = {
  log: [
    { key: "saw", label: "Saw", multiplier: 1, id: "gregtech:gt.metatool.01@10" },
    { key: "buzzsaw", label: "Buzzsaw", multiplier: 2, id: "gregtech:gt.metatool.01@140" },
    { key: "chainsaw", label: "Chainsaw", multiplier: 4, id: "gregtech:gt.metatool.01@110" },
  ],
  sapling: [
    {
      key: "branch_cutter",
      label: "Branch Cutter",
      multiplier: 1,
      id: "gregtech:gt.metatool.01@30",
    },
    { key: "grafter", label: "Grafter", multiplier: 4, id: "Forestry:grafter" },
  ],
  leaves: [
    { key: "shears", label: "Shears", multiplier: 1, id: "minecraft:shears" },
    { key: "wire_cutter", label: "Wire Cutter", multiplier: 2, id: "gregtech:gt.metatool.01@26" },
    {
      key: "automatic_snips",
      label: "Automatic Snips",
      multiplier: 4,
      id: "miscutils:gt.plusplus.metatool.01@7934",
    },
  ],
  fruit: [{ key: "knife", label: "Knife", multiplier: 1, id: "gregtech:gt.metatool.01@34" }],
};

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
applyOreDictionaryMemberships();

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
    const machineHandlers = machineHandlersFromCatalysts(machine.cat, {
      baseMachineType: machineType,
      minimumTierWhenUnknown: "UNKNOWN",
    });
    recipeMaps.push(machineType);

    for (const [index, rawRecipe] of (machine.recs ?? []).entries()) {
      if (!rawRecipe?.en || rawRecipe.dur <= 0) {
        continue;
      }

      const slotFrames = normalizeNeiSlotFrames(rawRecipe.sl);
      const progressBars = normalizeNeiProgressBars(rawRecipe.pb);
      const inputs = [
        ...(rawRecipe.iI ?? []).map((item, itemIndex) => {
          const nonConsumedInput =
            isNonConsumedInput(item) || isCircuitItem(item) || isReusableToolInput(item);
          return itemAmount(item, {
            consumed: !nonConsumedInput,
            defaultAmount: nonConsumedInput ? 1 : undefined,
            neiSlot: findNeiSlot(slotFrames, "input", "item", item.sl ?? itemIndex),
          });
        }),
        ...(rawRecipe.iNC ?? []).map((item) =>
          itemAmount(item, {
            consumed: false,
            defaultAmount: 1,
            neiSlot: findNeiSlot(slotFrames, "input", "item", item.sl),
          }),
        ),
        ...(rawRecipe.nCI ?? []).map((item) =>
          itemAmount(item, { consumed: false, defaultAmount: 1 }),
        ),
        ...(rawRecipe.ncI ?? []).map((item) =>
          itemAmount(item, { consumed: false, defaultAmount: 1 }),
        ),
        ...(rawRecipe.fI ?? []).map((fluid, fluidIndex) =>
          fluidAmount(fluid, {
            neiSlot: findNeiSlot(slotFrames, "input", "fluid", fluid.sl ?? fluidIndex),
          }),
        ),
        ...machineOptionalInputsForRecipe(machineType),
      ].filter(Boolean);
      const outputs = [
        ...(rawRecipe.iO ?? []).map((item, itemIndex) =>
          itemAmount(item, {
            chance: outputChance(item),
            neiSlot: findNeiSlot(slotFrames, "output", "item", item.sl ?? itemIndex),
          }),
        ),
        ...(rawRecipe.fO ?? []).map((fluid, fluidIndex) =>
          fluidAmount(fluid, {
            neiSlot: findNeiSlot(slotFrames, "output", "fluid", fluid.sl ?? fluidIndex),
          }),
        ),
      ].filter(Boolean);

      if (outputs.length === 0) {
        continue;
      }

      addRecipe({
        id: `recex:${datasetVersionId}:${slug(machineType)}:${hashRecipe(machineType, index, rawRecipe)}`,
        name: `${machineType}: ${outputs[0].displayName ?? outputs[0].id}`,
        machineType,
        minimumTier: "UNKNOWN",
        machineHandlers: machineHandlers.length > 0 ? machineHandlers : undefined,
        machineConfigControls: machineConfigControlsForRecipe(machineType, rawRecipe.sp),
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
          slots: slotFrames.length > 0 ? slotFrames : undefined,
          progressBars: progressBars.length > 0 ? progressBars : undefined,
          slotCapacity: slotCapacityFromFrames(slotFrames),
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

  const machineHandlers = machineHandlersFromCatalysts(source.catalysts, {
    baseMachineType: machineType,
    minimumTierWhenUnknown: "NONE",
    catalystScope: "crafting",
    additionalResources: craftingMachineHandlerResources(),
  });
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
      machineHandlers: machineHandlers.length > 0 ? machineHandlers : undefined,
      durationTicks: 1,
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

  for (const resource of [
    ...recipe.inputs,
    ...recipe.outputs,
    ...machineConfigResources(recipe.machineConfigControls),
    ...machineHandlerConfigResources(recipe.machineHandlers),
  ]) {
    addResource(resource);
  }
  recipes.push(recipe);
}

function machineConfigControlsForRecipe(machineType, specialValue) {
  const controls = [];
  const normalized = normalizeLabel(machineType);

  if (isBlastFurnaceRecipeMap(normalized) && Number.isFinite(specialValue) && specialValue > 0) {
    const minimum = coilTierForHeat(specialValue);
    if (minimum) {
      controls.push({
        id: "heatingCoil",
        label: "Heating Coil",
        minimumKey: minimum.key,
        defaultKey: minimum.key,
        tiers: heatingCoilTiers.map((tier) => ({
          key: tier.key,
          label: tier.label,
          heat: tier.heat,
          resource: machineConfigResource(tier.blockId, `${tier.label} Coil Block`, [
            "Heating coil tier",
            `Heat capacity: ${tier.heat} K`,
          ]),
        })),
      });
    }
  }

  if (isChemicalPlantRecipeMap(normalized)) {
    controls.push({
      id: "heatingCoil",
      label: "Heating Coil",
      minimumKey: heatingCoilTiers[0].key,
      defaultKey: heatingCoilTiers[0].key,
      tiers: heatingCoilTiers.map((tier, index) => ({
        key: tier.key,
        label: tier.label,
        heat: tier.heat,
        durationMultiplier: 2 / (index + 2),
        resource: machineConfigResource(tier.blockId, `${tier.label} Coil Block`, [
          "Heating coil tier",
          `Heat capacity: ${tier.heat} K`,
          `Duration multiplier: ${formatMultiplier(2 / (index + 2))}`,
        ]),
      })),
    });
    controls.push({
      id: "pipeCasing",
      label: "Pipe Casing",
      minimumKey: pipeCasingTiers[0].key,
      defaultKey: pipeCasingTiers[0].key,
      tiers: pipeCasingTiers.map((tier, index) => ({
        key: tier.key,
        label: tier.label,
        parallelMultiplier: 2 * (index + 1),
        resource: machineConfigResource(tier.blockId, `${tier.label} Pipe Casing`, [
          "Pipe casing tier",
          `Parallels: ${2 * (index + 1)}`,
          `${tier.label} pipe casing`,
        ]),
      })),
    });
  }

  if (isTreeGrowthSimulatorRecipeMap(normalized)) {
    controls.push(
      treeGrowthSimulatorToolControl("tgsLogTool", "Log Tool", treeGrowthSimulatorTools.log),
    );
    controls.push(
      treeGrowthSimulatorToolControl(
        "tgsSaplingTool",
        "Sapling Tool",
        treeGrowthSimulatorTools.sapling,
      ),
    );
    controls.push(
      treeGrowthSimulatorToolControl(
        "tgsLeavesTool",
        "Leaves Tool",
        treeGrowthSimulatorTools.leaves,
      ),
    );
    controls.push(
      treeGrowthSimulatorToolControl("tgsFruitTool", "Fruit Tool", treeGrowthSimulatorTools.fruit),
    );
  }

  return controls.length > 0 ? controls : undefined;
}

function machineConfigControlsForMachineHandler(label) {
  if (normalizeLabel(label) !== "large fluid extractor") {
    return undefined;
  }

  return [
    {
      id: "heatingCoil",
      label: "Heating Coil",
      minimumKey: heatingCoilTiers[0].key,
      defaultKey: heatingCoilTiers[0].key,
      tiers: heatingCoilTiers.map((tier, index) => ({
        key: tier.key,
        label: tier.label,
        heat: tier.heat,
        durationMultiplier: 1 / (1.5 + 0.1 * index),
        eutMultiplier: 0.8 * 0.9 ** index,
        resource: machineConfigResource(tier.blockId, `${tier.label} Coil Block`, [
          "Heating coil tier",
          `Heat capacity: ${tier.heat} K`,
          `Duration multiplier: ${formatMultiplier(1 / (1.5 + 0.1 * index))}`,
          `EU/t multiplier: ${formatMultiplier(0.8 * 0.9 ** index)}`,
        ]),
      })),
    },
    {
      id: "solenoidCoil",
      label: "Solenoid",
      minimumKey: solenoidTiers[0].key,
      defaultKey: solenoidTiers[0].key,
      tiers: solenoidTiers.map((tier) => ({
        key: tier.key,
        label: tier.label,
        parallelMultiplier: 8 * tier.voltageTier,
        resource: machineConfigResource(
          tier.blockId,
          `${tier.label} Solenoid Superconductor Coil`,
          ["Solenoid tier", `Parallels: ${8 * tier.voltageTier}`],
        ),
      })),
    },
  ];
}

function treeGrowthSimulatorToolControl(id, label, tools) {
  return {
    id,
    label,
    minimumKey: tools[0].key,
    defaultKey: tools[0].key,
    tiers: tools.map((tool) => ({
      key: tool.key,
      label: tool.label,
      outputMultiplier: tool.multiplier,
      resource: machineConfigResource(tool.id, tool.label, [
        `${label}`,
        `Output multiplier: ${tool.multiplier}x`,
      ]),
    })),
  };
}

function machineOptionalInputsForRecipe(machineType) {
  if (!isTreeGrowthSimulatorRecipeMap(normalizeLabel(machineType))) {
    return [];
  }

  return [
    machineToolInput(treeGrowthSimulatorTools.log[0], { x: 36, y: 36 }),
    machineToolInput(treeGrowthSimulatorTools.sapling[0], { x: 54, y: 36 }),
    machineToolInput(treeGrowthSimulatorTools.leaves[0], { x: 36, y: 54 }),
    machineToolInput(treeGrowthSimulatorTools.fruit[0], { x: 54, y: 54 }),
  ];
}

function machineToolInput(tool, neiSlot) {
  return {
    kind: "item",
    id: tool.id,
    amount: 1,
    displayName: tool.label,
    tooltip: [`Optional ${tool.label}`, `Output multiplier: ${tool.multiplier}x`],
    optional: true,
    consumed: false,
    neiSlot,
  };
}

function machineConfigResources(controls) {
  return (controls ?? []).flatMap((control) =>
    (control.tiers ?? []).map((tier) => tier.resource).filter(Boolean),
  );
}

function machineHandlerConfigResources(handlers) {
  return (handlers ?? []).flatMap((handler) =>
    machineConfigResources(handler.machineConfigControls),
  );
}

function machineConfigResource(id, displayName, tooltip) {
  return {
    kind: "item",
    id,
    amount: 1,
    displayName,
    tooltip,
    consumed: false,
  };
}

function formatMultiplier(value) {
  return Number.isInteger(value)
    ? `${value}x`
    : `${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}x`;
}

function coilTierForHeat(heat) {
  return heatingCoilTiers.find((tier) => tier.heat >= heat) ?? heatingCoilTiers.at(-1);
}

function isBlastFurnaceRecipeMap(normalizedMachineType) {
  return (
    normalizedMachineType === "blast furnace" || normalizedMachineType === "electric blast furnace"
  );
}

function isChemicalPlantRecipeMap(normalizedMachineType) {
  return (
    normalizedMachineType === "chemical plant" ||
    normalizedMachineType === "exxonmobil chemical plant"
  );
}

function isTreeGrowthSimulatorRecipeMap(normalizedMachineType) {
  return normalizedMachineType === "tree growth simulator";
}

function machineHandlersFromCatalysts(
  catalysts,
  { baseMachineType, minimumTierWhenUnknown, catalystScope, additionalResources = [] },
) {
  const handlersByFamily = new Map();
  const seen = new Set([slug(baseMachineType)]);

  for (const resource of [
    ...(catalysts ?? []).map((catalyst) => itemAmount(catalyst, { defaultAmount: 1 })),
    ...additionalResources,
  ]) {
    if (!resource) {
      continue;
    }

    const label = resource.displayName ?? resource.id;
    if (catalystScope === "crafting" && !isTimedAutomatedCraftingCatalyst(label)) {
      continue;
    }

    const familyLabel = machineHandlerFamilyLabel(label);
    if (normalizeLabel(familyLabel) === normalizeLabel(baseMachineType)) {
      continue;
    }

    const id = `nei-catalyst-${slug(resource.id)}`;
    if (seen.has(id) || normalizeLabel(label) === normalizeLabel(baseMachineType)) {
      continue;
    }
    seen.add(id);

    addMachineHandlerFamily(handlersByFamily, {
      id,
      label,
      machineType: label,
      minimumTier: inferCatalystMinimumTier(label, minimumTierWhenUnknown),
      kind: inferCatalystKind(label, minimumTierWhenUnknown),
      machineConfigControls: machineConfigControlsForMachineHandler(label),
    });
  }

  const handlers = [...handlersByFamily.values()];
  if (handlers.length > 1) {
    return handlers;
  }
  return handlers.filter(shouldExposeSingleMachineHandler);
}

function craftingMachineHandlerResources() {
  return rawItemResources.filter((resource) => {
    const label = resource.displayName ?? resource.id;
    return (
      isTimedAutomatedCraftingCatalyst(label) && inferCatalystMinimumTier(label, "NONE") !== "NONE"
    );
  });
}

function addMachineHandlerFamily(handlersByFamily, handler) {
  const familyLabel = machineHandlerFamilyLabel(handler.label);
  const familyId = `nei-catalyst-${slug(familyLabel)}`;
  const existing = handlersByFamily.get(familyId);
  const next = {
    ...handler,
    id: familyId,
    label: familyLabel,
    machineType: machineHandlerFamilyLabel(handler.machineType),
  };

  if (!existing) {
    handlersByFamily.set(familyId, next);
    return;
  }

  handlersByFamily.set(familyId, {
    ...existing,
    minimumTier: mergeMachineHandlerTier(existing.minimumTier, next.minimumTier),
    kind: existing.kind === next.kind ? existing.kind : (existing.kind ?? next.kind),
    machineConfigControls: existing.machineConfigControls ?? next.machineConfigControls,
  });
}

function shouldExposeSingleMachineHandler(handler) {
  return handler.kind === "multiblock" || Boolean(handler.machineConfigControls?.length);
}

function machineHandlerFamilyLabel(label) {
  return text(label, "")
    .replace(/^(?:Basic|Advanced|Elite)\s+/i, "")
    .replace(/^(?:Ultimate|Epic)\s+/i, "")
    .replace(/\s+\((?:ULV|LV|MV|HV|EV|IV|LuV|ZPM|UV|UHV|UEV|UIV|UXV|OpV|MAX)\)$/i, "")
    .replace(/\s+(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/i, "")
    .trim();
}

function lowerKnownTier(left, right) {
  if (left === "UNKNOWN") {
    return "UNKNOWN";
  }
  if (right === "UNKNOWN") {
    return "UNKNOWN";
  }

  const tiers = [
    "NONE",
    "ULV",
    "LV",
    "MV",
    "HV",
    "EV",
    "IV",
    "LuV",
    "ZPM",
    "UV",
    "UHV",
    "UEV",
    "UIV",
    "UXV",
    "OpV",
    "MAX",
  ];
  const leftIndex = tiers.indexOf(left);
  const rightIndex = tiers.indexOf(right);
  if (leftIndex === -1) {
    return right;
  }
  if (rightIndex === -1) {
    return left;
  }
  return leftIndex <= rightIndex ? left : right;
}

function mergeMachineHandlerTier(left, right) {
  if (left === "NONE" && isVoltageTier(right)) {
    return right;
  }
  if (right === "NONE" && isVoltageTier(left)) {
    return left;
  }
  return lowerKnownTier(left, right);
}

function isVoltageTier(tier) {
  return tier && tier !== "NONE" && tier !== "UNKNOWN";
}

function isTimedAutomatedCraftingCatalyst(label) {
  const normalized = normalizeLabel(label);
  return [/^auto/, /\bautocrafting\b/, /\bcrafter\b/, /\bcrafty crate\b/].some((pattern) =>
    pattern.test(normalized),
  );
}

function machineHandlersFromNames(names, { baseMachineType, minimumTierWhenUnknown }) {
  const handlers = [];
  const seen = new Set([slug(baseMachineType)]);

  for (const name of names ?? []) {
    const label = text(name, "").trim();
    const id = slug(label);
    if (!label || seen.has(id)) {
      continue;
    }
    seen.add(id);

    handlers.push({
      id,
      label,
      machineType: inferHandlerMachineType(label, baseMachineType),
      minimumTier: inferCatalystMinimumTier(label, minimumTierWhenUnknown),
      kind: inferCatalystKind(label, minimumTierWhenUnknown),
    });
  }

  return handlers;
}

function inferHandlerMachineType(label, baseMachineType) {
  return normalizeLabel(label) === normalizeLabel("Crafting Table") ? baseMachineType : label;
}

function inferCatalystMinimumTier(label, minimumTierWhenUnknown) {
  const normalized = normalizeLabel(label);
  if (normalized === "crafting table") {
    return "NONE";
  }

  const tier = [
    "ULV",
    "LV",
    "MV",
    "HV",
    "EV",
    "IV",
    "LuV",
    "ZPM",
    "UV",
    "UHV",
    "UEV",
    "UIV",
    "UXV",
    "OpV",
    "MAX",
  ].find((entry) => new RegExp(`(^|\\b)${escapeRegExp(entry)}(\\b|$)`, "i").test(label));
  return tier ?? minimumTierWhenUnknown;
}

function inferCatalystKind(label, minimumTierWhenUnknown) {
  const normalized = normalizeLabel(label);
  if (normalized === "crafting table") {
    return "crafting";
  }
  if (normalized.includes("workbench") || normalized.includes("assembler machine")) {
    return "automation";
  }
  if (
    normalized.includes("multiblock") ||
    normalized.includes("controller") ||
    normalized.startsWith("large ") ||
    normalized.startsWith("industrial ")
  ) {
    return "multiblock";
  }
  if (minimumTierWhenUnknown === "NONE") {
    return "crafting";
  }
  return "single";
}

function normalizeLabel(value) {
  return text(value, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function recipeSignature(recipe) {
  return JSON.stringify({
    machineType: recipe.machineType,
    minimumTier: recipe.minimumTier,
    durationTicks: recipe.durationTicks,
    eut: recipe.eut,
    programmedCircuit: recipe.programmedCircuit,
    machineConfigControls: recipe.machineConfigControls,
    inputs: recipe.inputs?.map(resourceSignature) ?? [],
    outputs: recipe.outputs?.map(resourceSignature) ?? [],
  });
}

function resourceSignature(resource) {
  return JSON.stringify({
    kind: resource.kind,
    id: resource.id,
    amount: resource.amount,
    consumed: resource.consumed === false ? false : undefined,
    chance: resource.chance,
  });
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

function collectRawItemResources(value) {
  const itemsById = new Map();
  const stack = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    if (typeof current.id === "string" && typeof current.lN === "string") {
      const resource = itemAmount(current, { defaultAmount: 1 });
      if (resource) {
        itemsById.set(`${resource.kind}:${resource.id}`, resource);
      }
    }

    for (const child of Object.values(current)) {
      if (child && typeof child === "object") {
        stack.push(child);
      }
    }
  }

  return [...itemsById.values()];
}

function applyOreDictionaryMemberships() {
  const namesByItemId = new Map();
  for (const [name, itemIds] of Object.entries(oreDictionary)) {
    for (const itemId of itemIds ?? []) {
      for (const concreteItemId of expandOreDictionaryItemId(itemId)) {
        namesByItemId.set(concreteItemId, [...(namesByItemId.get(concreteItemId) ?? []), name]);
      }
    }
  }

  for (const [itemId, names] of namesByItemId.entries()) {
    const resource = resources.get(`item:${itemId}`);
    if (!resource) {
      continue;
    }
    resource.oreDictionary = [...new Set([...(resource.oreDictionary ?? []), ...names])].sort();
  }
}

function expandOreDictionaryItemId(itemId) {
  if (!itemId.endsWith("@32767")) {
    return [itemId];
  }

  const baseId = itemId.slice(0, -"@32767".length);
  const matches = [...resources.values()]
    .filter(
      (resource) =>
        resource.kind === "item" &&
        (resource.id === baseId || resource.id.startsWith(`${baseId}@`)),
    )
    .map((resource) => resource.id);
  return matches.length > 0 ? matches : [itemId];
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
  if (options.neiSlot) {
    resource.neiSlot = options.neiSlot;
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

function fluidAmount(fluid, options = {}) {
  if (!fluid?.id || !Number.isFinite(fluid.a) || fluid.a <= 0) {
    return undefined;
  }

  const resource = {
    kind: "fluid",
    id: fluid.id,
    amount: fluid.a,
    displayName: text(fluid.lN, fluid.id),
    iconPath: renderedIconPath(fluid.ic),
  };
  if (options.neiSlot) {
    resource.neiSlot = options.neiSlot;
  }
  return resource;
}

function normalizeNeiSlotFrames(slots) {
  return (slots ?? [])
    .map((slot) => {
      const side = slot?.s === "output" ? "output" : slot?.s === "input" ? "input" : undefined;
      const kind = slot?.k === "fluid" ? "fluid" : slot?.k === "item" ? "item" : undefined;
      if (
        !side ||
        !kind ||
        !Number.isInteger(slot?.i) ||
        !Number.isInteger(slot?.x) ||
        !Number.isInteger(slot?.y)
      ) {
        return undefined;
      }
      return {
        side,
        kind,
        slotIndex: slot.i,
        x: slot.x,
        y: slot.y,
      };
    })
    .filter(Boolean);
}

function normalizeNeiProgressBars(progressBars) {
  return (progressBars ?? [])
    .map((bar) => {
      if (
        !Number.isInteger(bar?.x) ||
        !Number.isInteger(bar?.y) ||
        !Number.isInteger(bar?.w) ||
        !Number.isInteger(bar?.h)
      ) {
        return undefined;
      }
      return {
        x: bar.x,
        y: bar.y,
        width: bar.w,
        height: bar.h,
        direction: normalizeProgressDirection(bar.d),
      };
    })
    .filter(Boolean);
}

function normalizeProgressDirection(direction) {
  const normalized = text(direction, "").toLowerCase();
  if (normalized.includes("up")) {
    return "up";
  }
  if (normalized.includes("circular")) {
    return "circular";
  }
  return "right";
}

function findNeiSlot(slots, side, kind, slotIndex) {
  const slot = slots.find(
    (candidate) =>
      candidate.side === side && candidate.kind === kind && candidate.slotIndex === slotIndex,
  );
  return slot ? { x: slot.x, y: slot.y } : undefined;
}

function slotCapacityFromFrames(slots) {
  if (slots.length === 0) {
    return undefined;
  }

  return removeUndefined({
    maxItemInputs: countSlots(slots, "input", "item"),
    maxItemOutputs: countSlots(slots, "output", "item"),
    maxFluidInputs: countSlots(slots, "input", "fluid"),
    maxFluidOutputs: countSlots(slots, "output", "fluid"),
  });
}

function countSlots(slots, side, kind) {
  return slots.filter((slot) => slot.side === side && slot.kind === kind).length;
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
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

function text(value, defaultText) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : defaultText;
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
