import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { PNG } from "pngjs";
import { writeDatasetJson } from "./dataset-json-writer.mjs";
import { getDominantOpaqueColor } from "./icon-utils.mjs";

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
console.log("Staging rendered icons.");
const renderedIconFiles = await stageRenderedIcons(renderedIconDir, outDir);
console.log(`Indexing rendered icon colors for ${renderedIconFiles.length} files.`);
const renderedIconColors = await indexRenderedIconColors(outDir, renderedIconFiles);
console.log(`Reading RecEx export from ${inputPath}.`);
const raw = JSON.parse(stripBom(await fs.readFile(inputPath, "utf8")));
console.log("Collecting raw item resources.");
const rawItemResources = collectRawItemResources(raw);
console.log("Collecting CropNH seed names.");
const cropNhSeedCatalog = await loadCropNhSeedCatalog(process.env.GTNH_INSTANCE_ROOT);

const resources = new Map();
const recipeMaps = [];
const recipes = [];
const recipeSignatures = new Set();
const oreDictionary = {};
const MACHINE_HANDLER_FAMILY_ALIASES = new Map([
  ["alloy integrator", "Alloy Smelter"],
  ["amplifabricator", "Matter Amplifier"],
  ["amplicreator", "Matter Amplifier"],
  ["assembling machine", "Assembler"],
  ["assembly constructor", "Assembler"],
  ["atom stimulator", "Electric Furnace"],
  ["blaze sweatshop t-6350", "Thermal Centrifuge"],
  ["can operator", "Canner"],
  ["centrifuge", "Centrifuge"],
  ["chemical dunktron", "Chemical Bath"],
  ["chemical perforer", "Chemical Reactor"],
  ["chemical performer", "Chemical Reactor"],
  ["circuit assembling machine", "Circuit Assembler"],
  ["electric oven", "Ore Washer"],
  ["exact photon cannon", "Laser Engraver"],
  ["extractinator", "Extractor"],
  ["fermentation hastener", "Fermenter"],
  ["fire cyclone", "Thermal Centrifuge"],
  ["fluid petrificator", "Fluid Solidifier"],
  ["fraction splitter", "Distillery"],
  ["heat infuser", "Fluid Heater"],
  ["impact modulator", "Forge Hammer"],
  ["ionizer", "Electrolyzer"],
  ["liquid can actuator", "Fluid Canner"],
  ["liquefying sucker", "Fluid Extractor"],
  ["magnetar separator", "Electromagnetic Separator"],
  ["magnetism inducer", "Electromagnetic Polarizer"],
  ["matter constrictor", "Compressor"],
  ["matter organizer", "Mixer"],
  ["molecular cyclone", "Centrifuge"],
  ["molecular disintegrator e-4908", "Electrolyzer"],
  ["molecular separator", "Centrifuge"],
  ["molecular tornado", "Centrifuge"],
  ["object divider", "Cutting Machine"],
  ["oblitterator", "Recycler"],
  ["ore washing machine", "Ore Washer"],
  ["ore washing plant", "Ore Washer"],
  ["polarizer", "Electromagnetic Polarizer"],
  ["precision laser engraver", "Laser Engraver"],
  ["pressure cooker", "Autoclave"],
  ["pulsation filter", "Sifter"],
  ["pulverizer", "Macerator"],
  ["repurposed laundry-washer i-360", "Ore Washer"],
  ["scrap-o-matic", "Recycler"],
  ["shape driver", "Extruder"],
  ["shape eliminator", "Macerator"],
  ["short circuit heater", "Arc Furnace"],
  ["sifting machine", "Sifter"],
  ["singularity compressor", "Compressor"],
  ["surface shifter", "Forming Press"],
  ["the oblitterator", "Recycler"],
  ["turn-o-matic", "Lathe"],
  ["ufo engine", "Microwave"],
  ["unboxinator", "Unpackager"],
  ["vacuum extractor", "Extractor"],
  ["wire transfigurator", "Wiremill"],
]);

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

const treeGrowthSimulatorToolSlots = [
  { id: "tgsToolSlot1", label: "Log Tool", category: "log", x: 36, y: 36 },
  { id: "tgsToolSlot2", label: "Sapling Tool", category: "sapling", x: 54, y: 36 },
  { id: "tgsToolSlot3", label: "Leaves Tool", category: "leaves", x: 36, y: 54 },
  { id: "tgsToolSlot4", label: "Fruit Tool", category: "fruit", x: 54, y: 54 },
];

const sources = Array.isArray(raw.sources) ? raw.sources : [];
const gregtechSource = sources.find((source) => source.type === "gregtech");

if (gregtechSource?.machines?.length) {
  console.log(`Normalizing ${gregtechSource.machines.length} GregTech recipe maps.`);
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
normalizePassiveNeiSource(findSource("neiPassive"));
synthesizePassiveProductionRecipes();
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
console.log("Writing normalized dataset JSON.");
await writeDatasetJson(outputPath, dataset);
console.log(`Wrote ${dataset.recipes.length} recipes to ${outputPath}.`);

function normalizeGregtechRecipes(source) {
  for (const machine of source.machines) {
    const machineType = text(machine.n, "unknown-machine");
    const machineHandlers = machineHandlersFromCatalysts(machine.cat, {
      baseMachineType: machineType,
      minimumTierWhenUnknown: "UNKNOWN",
    });
    const machineConfigControls = machineConfigControlsFromRawItems(
      baseMachineCatalysts(machine.cat, machineType),
      {
        scope: "recipe",
        baseMachineType: machineType,
      },
    );
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
        machineConfigControls: machineConfigControlsForRecipe(
          machineType,
          rawRecipe.sp,
          machineConfigControls,
        ),
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

function normalizePassiveNeiSource(source) {
  const handlers = passiveNeiHandlers(source);
  if (handlers.length === 0) {
    return;
  }

  console.log(`Normalizing ${handlers.length} passive NEI recipe handler(s).`);

  for (const handler of handlers) {
    const machineType = passiveNeiMachineType(handler);
    if (!machineType) {
      continue;
    }

    recipeMaps.push(machineType);

    for (const [index, rawRecipe] of passiveNeiRecipes(handler).entries()) {
      const inputs = passiveNeiItems(rawRecipe, ["iI", "inputs", "ingredients"])
        .map((item, itemIndex) =>
          itemAmount(item, {
            consumed: false,
            defaultAmount: 1,
            neiSlot: passiveNeiSlot(rawRecipe, "input", item, itemIndex),
          }),
        )
        .filter(Boolean);
      const outputs = passiveNeiItems(rawRecipe, ["iO", "outputs", "results"])
        .map((item, itemIndex) =>
          itemAmount(item, {
            chance: outputChance(item),
            neiSlot: passiveNeiSlot(rawRecipe, "output", item, itemIndex),
          }),
        )
        .filter(Boolean);

      if (outputs.length === 0) {
        continue;
      }

      const primaryOutput = outputs[0];
      addRecipe({
        id: `recex:${datasetVersionId}:${slug(machineType)}:${hashRecipe("neiPassive", index, {
          handler: passiveNeiHandlerName(handler),
          rawRecipe,
        })}`,
        name: `${machineType}: ${primaryOutput.displayName ?? primaryOutput.id}`,
        machineType,
        minimumTier: machineType === "Bee Production" ? "NONE" : "LV",
        durationTicks: passiveNeiDurationTicks(rawRecipe, machineType),
        eut: machineType === "Bee Production" ? 0 : 8,
        inputs,
        outputs,
        notes: "Generated from a GTNH RecEx NEI passive-production export.",
        source: {
          datasetVersionId,
          recipeMap: machineType,
          exporter: "recex",
          rawRecipeId: `neiPassive:${passiveNeiHandlerName(handler)}:${index}`,
        },
        nei: {
          slots: passiveNeiSlots(rawRecipe),
          slotCapacity: passiveNeiSlotCapacity(rawRecipe, inputs.length, outputs.length),
        },
      });
    }
  }
}

function synthesizePassiveProductionRecipes() {
  const generated = [
    ...synthesizeIc2CropRecipes(),
    ...synthesizeCropNhRecipes(),
    ...synthesizeBeeProductionRecipes(),
  ];

  if (generated.length > 0) {
    console.log(`Synthesized ${generated.length} passive production recipe(s).`);
  }
}

function synthesizeIc2CropRecipes() {
  if (hasRecipeMap("IC2 Crop")) {
    return [];
  }

  const seedVisual = passiveInputVisualFallback([
    "IC2:itemCropSeed",
    "IC2:itemCropSeed@32767",
    "cropsnh:genericSeed",
    "minecraft:wheat_seeds",
  ]);
  const stickreedSeed = virtualPassiveInput(
    "factoryflow:ic2_crop_seed:stickreed",
    "Stickreed Seeds (#4269)",
    seedVisual,
    { tooltip: ["IC2:itemCropSeed"] },
  );
  const recipes = [];
  const stickyResin = resourceForPassiveRecipe("item", "IC2:itemHarz", {
    displayName: "Sticky Resin",
  });

  if (stickyResin) {
    recipes.push(
      addSyntheticPassiveRecipe({
        machineType: "IC2 Crop",
        input: stickreedSeed,
        output: stickyResin,
        index: 0,
        durationTicks: 1200,
        eut: 0,
        minimumTier: "NONE",
        note: "Synthesized from exported GTNH resources because RecEx does not expose IC2 crop NEI recipes.",
      }),
    );
  }

  if (!usesLegacyIc2Crops()) {
    return recipes;
  }

  const outputs = passiveResourceValues()
    .filter(isLegacyIc2CropPassiveOutputResource)
    .sort(compareById)
    .slice(0, 500);

  outputs.forEach((output, index) => {
    recipes.push(
      addSyntheticPassiveRecipe({
        machineType: "IC2 Crop",
        input: legacyIc2SeedInputForOutput(output, seedVisual),
        output: passiveOutputAmount(output),
        index: index + 1,
        durationTicks: 1200,
        eut: 0,
        minimumTier: "NONE",
        note: "Synthesized from exported GTNH resources because RecEx does not expose IC2 crop NEI recipes.",
      }),
    );
  });

  return recipes;
}

function synthesizeCropNhRecipes() {
  if (hasRecipeMap("CropNH") || usesLegacyIc2Crops()) {
    return [];
  }

  const seedVisual =
    passiveInputVisualFallback([
      "cropsnh:genericSeed",
      "cropsnh:genericSeed@32767",
      "minecraft:wheat_seeds",
    ]) ?? resourceForPassiveRecipe("item", "cropsnh:genericSeed");
  const outputs = passiveResourceValues()
    .filter(
      (resource) =>
        isCropNhPassiveOutputResource(resource) || isCropNhQuestPassiveOutputResource(resource),
    )
    .sort(compareById)
    .slice(0, 500);

  return outputs.map((output, index) =>
    addSyntheticPassiveRecipe({
      machineType: "CropNH",
      input: cropNhSeedInputForOutput(output, seedVisual),
      output: passiveOutputAmount(output),
      index,
      durationTicks: 1200,
      eut: 0,
      minimumTier: "NONE",
      note: "Synthesized from exported CropNH resources because RecEx does not expose CropNH passive NEI recipes.",
    }),
  );
}

function legacyIc2SeedInputForOutput(output, visual) {
  const bonsai = legacyBonsaiTreeInfo(output);
  const displayName = `${bonsai?.cropName ?? cropNhSeedNameFromOutput(output)} Seeds (#4269)`;
  const idSource = bonsai?.key ?? `${output.kind}:${output.id}`;
  return virtualPassiveInput(`factoryflow:ic2_crop_seed:${slug(idSource)}`, displayName, visual, {
    tooltip: ["IC2:itemCropSeed"],
  });
}

function usesLegacyIc2Crops() {
  return cropNhSeedCatalog.length === 0;
}

function isLegacyIc2CropPassiveOutputResource(resource) {
  return isCropNhPassiveOutputResource(resource) || Boolean(legacyBonsaiTreeInfo(resource));
}

function legacyBonsaiTreeInfo(resource) {
  if (!cropNhBonsaiOutputLike(resource)) {
    return undefined;
  }

  const normalizedName = normalizeLabel(resource.displayName ?? "");
  const candidates = [
    { token: "dark oak", key: "bonsai-dark-oak", cropName: "Dark Oak Bonsai" },
    { token: "acacia", key: "bonsai-acacia", cropName: "Acacia Bonsai" },
    { token: "birch", key: "bonsai-birch", cropName: "Birch Bonsai" },
    { token: "jungle", key: "bonsai-jungle", cropName: "Jungle Bonsai" },
    { token: "rubber", key: "bonsai-rubber", cropName: "Rubber Bonsai" },
    { token: "slimy", key: "bonsai-slimy", cropName: "Slimy Bonsai" },
    { token: "spruce", key: "bonsai-spruce", cropName: "Spruce Bonsai" },
    { token: "oak", key: "bonsai-oak", cropName: "Oak Bonsai" },
  ];
  return candidates.find(({ token }) =>
    new RegExp(`\\b${escapeRegExp(token)}\\b`).test(normalizedName),
  );
}

function synthesizeBeeProductionRecipes() {
  if (hasRecipeMap("Bee Production")) {
    return [];
  }

  const bee =
    resourceForPassiveRecipe("item", "Forestry:beePrincessGE") ??
    virtualPassiveInput(
      "factoryflow:bee_species",
      "Bee Species",
      passiveInputVisualFallback(["Forestry:beePrincessGE@32767", "Forestry:beePrincessGE"]),
    );
  const outputs = passiveResourceValues()
    .filter(isBeePassiveOutputResource)
    .sort(compareById)
    .slice(0, 800);

  return outputs.map((output, index) =>
    addSyntheticPassiveRecipe({
      machineType: "Bee Production",
      input: bee,
      output: passiveOutputAmount(output),
      index,
      durationTicks: 550,
      eut: 0,
      minimumTier: "NONE",
      note: "Synthesized from exported bee resources because RecEx does not expose bee passive NEI recipes.",
    }),
  );
}

function addSyntheticPassiveRecipe({
  machineType,
  input,
  output,
  index,
  durationTicks,
  eut,
  minimumTier,
  note,
}) {
  if (!recipeMaps.includes(machineType)) {
    recipeMaps.push(machineType);
  }

  const recipe = {
    id: `recex:${datasetVersionId}:${slug(machineType)}:synthetic:${hashRecipe(machineType, index, {
      output: `${output.kind}:${output.id}`,
    })}`,
    name: `${machineType}: ${output.displayName ?? output.id}`,
    machineType,
    minimumTier,
    durationTicks,
    eut,
    inputs: [{ ...input, amount: 1, consumed: false, neiSlot: { x: 34, y: 35 } }],
    outputs: [{ ...output, neiSlot: { x: 124, y: 35 } }],
    notes: note,
    source: {
      datasetVersionId,
      recipeMap: machineType,
      exporter: "recex",
      rawRecipeId: `syntheticPassive:${machineType}:${index}:${output.kind}:${output.id}`,
    },
    nei: {
      slots: [
        { side: "input", kind: "item", slotIndex: 0, x: 34, y: 35 },
        { side: "output", kind: output.kind, slotIndex: 0, x: 124, y: 35 },
      ],
      slotCapacity:
        output.kind === "fluid"
          ? { maxItemInputs: 1, maxFluidOutputs: 1 }
          : { maxItemInputs: 1, maxItemOutputs: 1 },
    },
  };
  addRecipe(recipe);
  return recipe;
}

function hasRecipeMap(recipeMap) {
  return recipes.some(
    (recipe) => recipe.source?.recipeMap === recipeMap || recipe.machineType === recipeMap,
  );
}

function resourceForPassiveRecipe(kind, id, fallback = {}) {
  const resource =
    resources.get(`${kind}:${id}`) ??
    rawItemResources.find((entry) => entry.kind === kind && entry.id === id);
  if (!resource) {
    return fallback.displayName
      ? { kind, id, amount: kind === "fluid" ? 1000 : 1, ...fallback }
      : undefined;
  }

  return passiveOutputAmount(resource);
}

function passiveResourceValues() {
  return [
    ...new Map(
      [...resources.values(), ...rawItemResources].map((resource) => [
        `${resource.kind}:${resource.id}`,
        resource,
      ]),
    ).values(),
  ];
}

function passiveInputVisualFallback(ids) {
  for (const id of ids) {
    const resource =
      resources.get(`item:${id}`) ??
      rawItemResources.find((entry) => entry.kind === "item" && entry.id === id);
    if (resource?.iconPath || resource?.iconAtlas) {
      return passiveOutputAmount(resource);
    }
  }

  return undefined;
}

function virtualPassiveInput(id, displayName, visual, options = {}) {
  const input = {
    kind: "item",
    id,
    amount: 1,
    displayName,
    iconPath: visual?.iconPath,
    iconAtlas: visual?.iconAtlas,
    dominantColor: visual?.dominantColor,
  };
  if (options.tooltip) {
    input.tooltip = options.tooltip;
  }
  return input;
}

function passiveOutputAmount(resource) {
  return {
    kind: resource.kind,
    id: resource.id,
    amount: resource.kind === "fluid" ? 1000 : 1,
    displayName: resource.displayName,
    iconPath: resource.iconPath,
    iconAtlas: resource.iconAtlas,
    dominantColor: resource.dominantColor,
    tooltip: resource.tooltip,
    oreDictionary: resource.oreDictionary,
  };
}

function cropNhSeedInputForOutput(output, visual) {
  const seedInfo = cropNhBonsaiOutputLike(output)
    ? cropNhSeedInfoForOutput(output, { requireBonsai: true })
    : undefined;
  const seedInfoForOutput = seedInfo ?? cropNhSeedInfoForOutput(output);
  const fallbackName = cropNhSeedNameFromOutput(output);
  const displayName = `${seedInfoForOutput?.cropName ?? fallbackName} Seeds (#4269)`;
  const idSource = seedInfoForOutput?.cropId ?? `${output.kind}:${output.id}`;
  return virtualPassiveInput(`factoryflow:cropnh_seed:${slug(idSource)}`, displayName, visual);
}

function cropNhSeedInfoForOutput(resource, options = {}) {
  if (cropNhSeedCatalog.length === 0) {
    return undefined;
  }

  const outputTokens = meaningfulCropTokens(
    `${resource.displayName ?? ""} ${resource.id.replace(/[@:_-]/g, " ")}`,
  );
  if (outputTokens.length === 0) {
    return undefined;
  }

  let best;
  const seedCatalog = options.requireBonsai
    ? cropNhSeedCatalog.filter((seed) => seed.tokens.includes("bonsai"))
    : cropNhSeedCatalog;
  for (const seed of seedCatalog) {
    const sharedTokens = seed.tokens.filter((token) => outputTokens.includes(token));
    if (sharedTokens.length === 0) {
      continue;
    }

    const score = sharedTokens.length / Math.max(1, seed.tokens.length);
    if (
      !best ||
      score > best.score ||
      (score === best.score && seed.cropName.length < best.seed.cropName.length)
    ) {
      best = { seed, score };
    }
  }

  return best?.seed;
}

function cropNhSeedNameFromOutput(resource) {
  const displayName = resource.displayName ?? resource.id.split(":").pop() ?? resource.id;
  const cleaned = displayName
    .replace(
      /\b(?:leaf|leaves|flower|flowers|berry|berries|stem|root|wart|fiber|hurd|residue)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || displayName;
}

function isCropNhPassiveOutputResource(resource) {
  if (resource.kind !== "item" || !resource.id.startsWith("cropsnh:")) {
    return false;
  }

  return (
    resource.id === "cropsnh:berry" ||
    resource.id.startsWith("cropsnh:berry@") ||
    resource.id === "cropsnh:materialLeaf" ||
    resource.id.startsWith("cropsnh:materialLeaf@") ||
    resource.id === "cropsnh:gaiaWart" ||
    resource.id === "cropsnh:goldfish" ||
    resource.id.startsWith("cropsnh:goldfish@") ||
    resource.id === "cropsnh:hempHurd" ||
    resource.id === "cropsnh:poisonPowder" ||
    resource.id === "cropsnh:sulfurDopedGalvaniaResidue" ||
    resource.id === "cropsnh:sulfurDopedPlumbiliaResidue"
  );
}

function isCropNhQuestPassiveOutputResource(resource) {
  if (resource.kind !== "item") {
    return false;
  }

  if (!cropNhBonsaiOutputLike(resource)) {
    return false;
  }

  return Boolean(cropNhSeedInfoForOutput(resource, { requireBonsai: true }));
}

function cropNhBonsaiOutputLike(resource) {
  const idPath = resource.id.replace(/@.*$/, "").replace(/^[^:]+:/, "");
  const idWords = titleWords(idPath).join(" ").toLowerCase();
  if (
    /\b(?:plank|planks|label|slab|stairs|fence|gate|door|sign|button|plate|stripped)\b/.test(
      idWords,
    )
  ) {
    return false;
  }
  return /\b(?:log|logs|leaf|leaves|sapling|saplings)\b/.test(idWords);
}

function isBeePassiveOutputResource(resource) {
  if (resource.kind !== "item") {
    return false;
  }

  const id = resource.id;
  return (
    id === "Forestry:beeCombs" ||
    id.startsWith("Forestry:beeCombs@") ||
    id === "Forestry:honeyDrop" ||
    id.startsWith("Forestry:honeyDrop@") ||
    id === "Forestry:propolis" ||
    id.startsWith("Forestry:propolis@") ||
    id === "Forestry:beeswax" ||
    id === "Forestry:royalJelly" ||
    id === "ExtraBees:honeyComb" ||
    id.startsWith("ExtraBees:honeyComb@") ||
    id === "ExtraBees:honeyDrop" ||
    id.startsWith("ExtraBees:honeyDrop@") ||
    id === "ExtraBees:propolis" ||
    id.startsWith("ExtraBees:propolis@") ||
    id === "gendustry:HoneyComb" ||
    id.startsWith("gendustry:HoneyComb@") ||
    id === "gendustry:HoneyDrop" ||
    id.startsWith("gendustry:HoneyDrop@") ||
    id === "gregtech:gt.comb" ||
    id.startsWith("gregtech:gt.comb@")
  );
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

function machineConfigControlsForRecipe(machineType, specialValue, machineConfigControls = []) {
  const controls = [...machineConfigControls];
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

  if (isTreeGrowthSimulatorRecipeMap(normalized)) {
    controls.push(...treeGrowthSimulatorToolSlots.map(treeGrowthSimulatorToolSlotControl));
  }

  return mergeMachineConfigControls(controls);
}

function machineConfigControlsForMachineHandler(label, rawItem) {
  return mergeMachineConfigControls(
    machineConfigControlsFromRawItems([rawItem], { scope: "handler", baseMachineType: label }),
  );
}

function baseMachineCatalysts(catalysts, baseMachineType) {
  const normalizedBase = normalizeLabel(baseMachineType);
  return (catalysts ?? []).filter((catalyst) => {
    const label = text(catalyst?.lN, catalyst?.id ?? "");
    return normalizeLabel(machineHandlerFamilyLabel(label)) === normalizedBase;
  });
}

function machineConfigControlsFromRawItems(items, { scope, baseMachineType }) {
  const multiblockItems = (items ?? []).filter((item) =>
    isMultiblockMachineConfigItem(item, baseMachineType),
  );
  const maxParallel = multiblockItems.reduce((maximum, item) => {
    const value = Number.isFinite(item?.mp) ? item.mp : 0;
    return value > maximum ? value : maximum;
  }, 0);
  const lines = multiblockItems
    .flatMap((item) => (Array.isArray(item?.tt) ? item.tt : []))
    .map((line) => text(line, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (lines.length === 0 && maxParallel <= 1) {
    return [];
  }

  const controls = [];
  const directParallelTiers = new Map();

  for (const line of lines) {
    const multiplicativePerTier =
      /(?:^|\b)(\d+(?:[.,]\d+)?)x\s+Parallels?\s+per\s+(.+?)\s+Tier\b/i.exec(line);
    if (multiplicativePerTier) {
      const factor = parseTooltipNumber(multiplicativePerTier[1]);
      const tierSubject = multiplicativePerTier[2];
      const tierControl = tieredEffectControlFromSubject(tierSubject, line, {
        effectLabel: "Parallels",
        effect: (tier, index) => ({
          parallelMultiplier: Math.pow(factor, tierOrdinal(tier, index)),
        }),
        keep: (effect) => effect.parallelMultiplier > 1,
      });
      if (tierControl) {
        controls.push(tierControl);
      }
      continue;
    }

    const perTier = /(?:^|\b)(\d+)\s+Parallels?\s+per\s+(.+?)\s+Tier\b/i.exec(line);
    if (perTier) {
      const factor = Number.parseInt(perTier[1], 10);
      const tierSubject = perTier[2];
      const tierControl = tieredParallelControlFromSubject(tierSubject, factor, line);
      if (tierControl) {
        controls.push(tierControl);
      }
      continue;
    }

    const baseAndSlice =
      /(?:^|\b)(\d+)\s+base\s+and\s+\+(\d+)\s+Parallels?\s+per\s+extra\s+slice\s+with\s+(.+)$/i.exec(
        line,
      );
    if (baseAndSlice) {
      const parallels = Number.parseInt(baseAndSlice[1], 10);
      addDirectParallelTier(directParallelTiers, baseAndSlice[3], parallels, line, scope);
      continue;
    }

    const absoluteSpeed = /(?:^|\b)Speed\s+is\s+(\d+(?:[.,]\d+)?%?)\s+times\s+(.+?)\s+Tier\b/i.exec(
      line,
    );
    if (absoluteSpeed) {
      const factor = parseTooltipFactor(absoluteSpeed[1]);
      const tierSubject = absoluteSpeed[2];
      const tierControl = tieredEffectControlFromSubject(tierSubject, line, {
        effectLabel: "Speed",
        effect: (tier, index) => ({
          durationMultiplier: reciprocal(factor * tierOrdinal(tier, index)),
        }),
        keep: (effect) => effect.durationMultiplier > 0,
      });
      if (tierControl) {
        controls.push(tierControl);
      }
      continue;
    }

    const speedPerTier = /(?:^|\b)\+?(\d+(?:[.,]\d+)?%)\s+Speed\s+per\s+(.+?)\s+Tier\b/i.exec(line);
    if (speedPerTier) {
      const factor = parseTooltipFactor(speedPerTier[1]);
      const tierSubject = speedPerTier[2];
      const tierControl = tieredEffectControlFromSubject(tierSubject, line, {
        effectLabel: "Speed",
        effect: (tier, index) => ({
          durationMultiplier: reciprocal(1 + factor * tierOrdinal(tier, index)),
        }),
        keep: (effect) => effect.durationMultiplier > 0 && effect.durationMultiplier < 1,
      });
      if (tierControl) {
        controls.push(tierControl);
      }
      continue;
    }

    const euUsagePerTier =
      /(?:^|\b)([+-]?\d+(?:[.,]\d+)?%)\s+EU\s+Usage\s+per\s+(.+?)\s+Tier\b/i.exec(line);
    if (euUsagePerTier) {
      const factor = parseTooltipFactor(euUsagePerTier[1]);
      const tierSubject = euUsagePerTier[2];
      const tierControl = tieredEffectControlFromSubject(tierSubject, line, {
        effectLabel: "EU usage",
        effect: (tier, index) => ({
          eutMultiplier: Math.max(0.01, 1 + factor * tierOrdinal(tier, index)),
        }),
        keep: (effect) => effect.eutMultiplier > 0 && effect.eutMultiplier !== 1,
      });
      if (tierControl) {
        controls.push(tierControl);
      }
      continue;
    }

    const staticParallel = /(?:^|\b)(\d+)\s+Parallels?\s*$/i.exec(line);
    if (staticParallel) {
      const parallels = Number.parseInt(staticParallel[1], 10);
      if (parallels > 1) {
        controls.push(fixedParallelControl(parallels, scope, line));
      }
      continue;
    }

    const direct = /(?:^|\b)(\d+)\s+Parallels?\s+with\s+(.+)$/i.exec(line);
    if (direct) {
      const parallels = Number.parseInt(direct[1], 10);
      addDirectParallelTier(directParallelTiers, direct[2], parallels, line, scope);
    }
  }

  for (const tiers of directParallelTiers.values()) {
    if (tiers.length === 0) {
      continue;
    }
    controls.push({
      id: scope === "recipe" ? "machineParallel" : `machineParallel${capitalize(scope)}`,
      label: directParallelControlLabel(tiers),
      minimumKey: tiers[0].key,
      defaultKey: tiers[0].key,
      tiers,
    });
  }

  if (maxParallel > 1 && !controls.some(controlHasParallelMultiplier)) {
    controls.push(fixedParallelControl(maxParallel, scope));
  }

  return controls;
}

function isMultiblockMachineConfigItem(item, fallbackLabel) {
  if (!item) {
    return false;
  }
  if (item.mb === true) {
    return true;
  }
  if (typeof item.mb === "string" && item.mb.toLowerCase() === "true") {
    return true;
  }

  const label = text(item.lN, fallbackLabel ?? item.id ?? "");
  if (inferCatalystKind(label, "UNKNOWN") === "multiblock") {
    return true;
  }

  return hasMultiblockStructureTooltip(item);
}

function hasMultiblockStructureTooltip(item) {
  const lines = Array.isArray(item?.tt) ? item.tt.map((line) => normalizeLabel(line)) : [];
  if (lines.length === 0) {
    return false;
  }
  return lines.some(
    (line) =>
      line.includes("multiblock") ||
      line.includes("multi-block") ||
      line.includes("structure") ||
      line.includes("controller") ||
      line.includes("maintenance hatch") ||
      line.includes("energy hatch") ||
      line.includes("input hatch") ||
      line.includes("output hatch") ||
      line.includes("input bus") ||
      line.includes("output bus"),
  );
}

function controlHasParallelMultiplier(control) {
  return (control?.tiers ?? []).some((tier) => Number.isFinite(tier.parallelMultiplier));
}

function fixedParallelControl(parallels, scope, sourceLine) {
  const key = `fixed-${parallels}`;
  const label = `${parallels} Parallels`;
  return {
    id: scope === "recipe" ? "machineParallel" : `machineParallel${capitalize(scope)}`,
    label: "Parallel",
    minimumKey: key,
    defaultKey: key,
    tiers: [
      {
        key,
        label,
        parallelMultiplier: parallels,
        resource: {
          ...virtualMachineConfigResource(key, label),
          tooltip: [
            sourceLine ? "Imported from machine tooltip" : "Imported from machine controller",
            sourceLine ?? "Source: getMaxParallelRecipes()",
            `Parallels: ${parallels}`,
          ],
        },
      },
    ],
  };
}

function addDirectParallelTier(tiersByControl, subject, parallels, line, scope) {
  if (!Number.isFinite(parallels) || parallels <= 1) {
    return;
  }
  const label = directParallelTierLabel(subject);
  const key = slug(label);
  const controlKey = directParallelControlSubject(subject);
  const resource = findRawItemResourceByLabel(label) ?? virtualMachineConfigResource(key, label);
  const tiers = tiersByControl.get(controlKey) ?? [];
  if (!tiers.some((tier) => tier.key === key)) {
    tiers.push({
      key,
      label,
      parallelMultiplier: parallels,
      resource: {
        ...resource,
        displayName: resource.displayName ?? label,
        tooltip: ["Imported from machine tooltip", line, `Parallels: ${parallels}`],
      },
    });
  }
  tiersByControl.set(controlKey, tiers);
}

function tieredParallelControlFromSubject(subject, factor, line) {
  if (!Number.isFinite(factor) || factor <= 0) {
    return undefined;
  }

  return tieredEffectControlFromSubject(subject, line, {
    effectLabel: "Parallels",
    effect: (tier, index) => ({ parallelMultiplier: factor * tierOrdinal(tier, index) }),
    keep: (effect) => effect.parallelMultiplier > 1,
  });
}

function tieredEffectControlFromSubject(subject, line, { effectLabel, effect, keep }) {
  const definition = machineConfigTierDefinitionForSubject(subject);
  if (!definition) {
    return undefined;
  }

  return buildTieredEffectControl({
    ...definition,
    line,
    effectLabel,
    effect,
    keep,
  });
}

function machineConfigTierDefinitionForSubject(subject) {
  const normalized = normalizeLabel(subject);
  if (normalized.includes("coil")) {
    return {
      id: "heatingCoil",
      label: "Heating Coil",
      tiers: tierResources(heatingCoilTiers, "Coil Block", (tier) => [
        "Heating coil tier",
        `Heat capacity: ${tier.heat} K`,
      ]),
      tooltipPrefix: "Heating coil tier",
    };
  }

  if (normalized.includes("pipe casing")) {
    return {
      id: "pipeCasing",
      label: "Pipe Casing",
      tiers: tierResources(pipeCasingTiers, "Pipe Casing"),
      tooltipPrefix: "Pipe casing tier",
    };
  }

  if (normalized.includes("solenoid")) {
    return {
      id: "solenoidCoil",
      label: "Solenoid",
      tiers: tierResources(solenoidTiers, "Solenoid Superconductor Coil"),
      tooltipPrefix: "Solenoid tier",
    };
  }

  return undefined;
}

function buildTieredEffectControl({
  id,
  label,
  tiers,
  line,
  tooltipPrefix,
  effectLabel,
  effect,
  keep,
}) {
  const options = tiers
    .map((tier, index) => {
      const effectFields = effect(tier, index);
      if (!isValidMachineConfigEffect(effectFields) || (keep && !keep(effectFields))) {
        return undefined;
      }
      const resource = tier.resource ?? virtualMachineConfigResource(tier.key, tier.displayName);
      return {
        key: tier.key,
        label: tier.label,
        ...effectFields,
        resource: {
          ...resource,
          displayName: resource.displayName ?? tier.displayName,
          tooltip: uniqueStrings([
            tooltipPrefix,
            line,
            ...effectTooltipLines(effectLabel, effectFields),
            ...(resource.tooltip ?? []),
          ]),
        },
      };
    })
    .filter(Boolean);

  if (options.length === 0) {
    return undefined;
  }

  return {
    id,
    label,
    minimumKey: options[0].key,
    defaultKey: options[0].key,
    tiers: options,
  };
}

function isValidMachineConfigEffect(effect) {
  return (
    Number.isFinite(effect?.parallelMultiplier) ||
    Number.isFinite(effect?.durationMultiplier) ||
    Number.isFinite(effect?.eutMultiplier) ||
    Number.isFinite(effect?.outputMultiplier) ||
    Number.isFinite(effect?.heat)
  );
}

function effectTooltipLines(effectLabel, effect) {
  const lines = [];
  if (Number.isFinite(effect.parallelMultiplier)) {
    lines.push(`${effectLabel}: ${formatTooltipMultiplier(effect.parallelMultiplier)}x`);
  }
  if (Number.isFinite(effect.durationMultiplier)) {
    lines.push(
      `${effectLabel}: ${formatTooltipMultiplier(reciprocal(effect.durationMultiplier))}x`,
    );
  }
  if (Number.isFinite(effect.eutMultiplier)) {
    lines.push(`${effectLabel}: ${formatTooltipPercent(effect.eutMultiplier)}`);
  }
  if (Number.isFinite(effect.outputMultiplier)) {
    lines.push(`${effectLabel}: ${formatTooltipMultiplier(effect.outputMultiplier)}x`);
  }
  return lines;
}

function parseTooltipFactor(value) {
  const number = parseTooltipNumber(value);
  return String(value).trim().endsWith("%") ? number / 100 : number;
}

function parseTooltipNumber(value) {
  return Number.parseFloat(String(value).replace(",", ".").replace("%", ""));
}

function reciprocal(value) {
  return Number.isFinite(value) && value !== 0 ? 1 / value : Number.NaN;
}

function tierOrdinal(tier, index) {
  return Number.isFinite(tier.voltageTier) ? tier.voltageTier : index + 1;
}

function formatTooltipMultiplier(value) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatTooltipPercent(value) {
  return `${formatTooltipMultiplier(value * 100)}%`;
}

function tierResources(knownTiers, suffix, tooltip = () => []) {
  return knownTiers.map((tier) => {
    const displayName = `${tier.label} ${suffix}`;
    return {
      ...tier,
      displayName,
      resource:
        findRawItemResourceByLabel(displayName) ??
        machineConfigResource(tier.blockId, displayName, tooltip(tier)),
    };
  });
}

function directParallelControlSubject(subject) {
  const normalized = normalizeLabel(subject);
  if (normalized.includes("casing")) {
    return "casing";
  }
  return normalized || "parallel";
}

function directParallelControlLabel(tiers) {
  return tiers.every((tier) => normalizeLabel(tier.label).includes("casing"))
    ? "Casing"
    : "Parallel";
}

function directParallelTierLabel(subject) {
  return text(subject, "")
    .replace(/\bwith\b/gi, "")
    .replace(/\bcasings\b/gi, "Casing")
    .replace(/\bcasing\b/gi, "Casing")
    .replace(/\s+/g, " ")
    .trim();
}

function findRawItemResourceByLabel(label) {
  const wanted = labelTokens(label);
  if (wanted.length === 0) {
    return undefined;
  }

  return rawItemResources.find((resource) => {
    const candidate = labelTokens(resource.displayName ?? resource.id);
    return wanted.every((token) => candidate.includes(token));
  });
}

function labelTokens(label) {
  return normalizeLabel(label)
    .replace(/\bcasings\b/g, "casing")
    .split(" ")
    .filter((token) => token && token !== "any");
}

function virtualMachineConfigResource(key, displayName) {
  return machineConfigResource(`factoryflow:machine_config/${key}`, displayName);
}

function mergeMachineConfigControls(controls) {
  const byId = new Map();
  for (const control of controls.filter(Boolean)) {
    const existing = byId.get(control.id);
    if (!existing) {
      byId.set(control.id, control);
      continue;
    }
    const tiersByKey = new Map(existing.tiers.map((tier) => [tier.key, tier]));
    for (const tier of control.tiers) {
      const current = tiersByKey.get(tier.key);
      tiersByKey.set(tier.key, current ? mergeMachineConfigTierOption(current, tier) : tier);
    }
    byId.set(control.id, {
      ...existing,
      minimumKey: existing.minimumKey ?? control.minimumKey,
      defaultKey: existing.defaultKey ?? control.defaultKey,
      tiers: [...tiersByKey.values()],
    });
  }
  const merged = [...byId.values()];
  return merged.length > 0 ? merged : undefined;
}

function mergeMachineConfigTierOption(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    label: existing.label ?? incoming.label,
    resource: mergeMachineConfigTierResource(existing.resource, incoming.resource),
  };
}

function mergeMachineConfigTierResource(existing, incoming) {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }
  return {
    ...existing,
    ...incoming,
    id: existing.id ?? incoming.id,
    displayName: existing.displayName ?? incoming.displayName,
    tooltip: uniqueStrings([...(existing.tooltip ?? []), ...(incoming.tooltip ?? [])]),
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function treeGrowthSimulatorToolSlotControl(slot) {
  const tools = treeGrowthSimulatorTools[slot.category].map((tool) => ({
    ...tool,
    category: slot.category,
    categoryLabel: capitalize(slot.category),
  }));
  return {
    id: slot.id,
    label: slot.label,
    minimumKey: "none",
    defaultKey: "none",
    tiers: [
      {
        key: "none",
        label: "-",
        resource: machineConfigResource("factoryflow:tgs_tool_empty", "-", ["No tool selected"]),
      },
      ...tools.map((tool) => ({
        key: `${tool.category}:${tool.key}`,
        label: tool.label,
        outputMultiplier: tool.multiplier,
        resource: machineConfigResource(tool.id, tool.label, [
          `${tool.categoryLabel} tool`,
          `Output multiplier: ${tool.multiplier}x`,
        ]),
      })),
    ],
  };
}

function machineOptionalInputsForRecipe(machineType) {
  if (!isTreeGrowthSimulatorRecipeMap(normalizeLabel(machineType))) {
    return [];
  }

  return [
    ...treeGrowthSimulatorToolSlots.map((slot) =>
      machineToolInput(
        { id: "factoryflow:tgs_tool_empty", label: "Tool Slot", multiplier: 1 },
        { x: slot.x, y: slot.y },
      ),
    ),
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

function capitalize(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function coilTierForHeat(heat) {
  return heatingCoilTiers.find((tier) => tier.heat >= heat) ?? heatingCoilTiers.at(-1);
}

function isBlastFurnaceRecipeMap(normalizedMachineType) {
  return (
    normalizedMachineType === "blast furnace" || normalizedMachineType === "electric blast furnace"
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
  const entries = [
    ...(catalysts ?? []).map((catalyst) => ({
      resource: itemAmount(catalyst, { defaultAmount: 1 }),
      rawItem: catalyst,
    })),
    ...additionalResources.map((resource) => ({ resource, rawItem: undefined })),
  ];

  for (const { resource, rawItem } of entries) {
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
      machineConfigControls: machineConfigControlsForMachineHandler(label, rawItem),
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
  const tierlessLabel = text(label, "")
    .replace(/\s+\((?:ULV|LV|MV|HV|EV|IV|LuV|ZPM|UV|UHV|UEV|UIV|UXV|OpV|MAX)\)$/i, "")
    .replace(/\s+(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/i, "")
    .trim();
  const directAlias = MACHINE_HANDLER_FAMILY_ALIASES.get(normalizeLabel(tierlessLabel));
  if (directAlias) {
    return directAlias;
  }

  const familyLabel = tierlessLabel
    .replace(/^(?:Basic|Advanced|Elite|Ultimate|Epic|MAX|Turbo|Quick|Instant|Universal)\s+/i, "")
    .trim();
  return MACHINE_HANDLER_FAMILY_ALIASES.get(normalizeLabel(familyLabel)) ?? familyLabel;
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
    if (!existingResource.dominantColor && resource.dominantColor) {
      existingResource.dominantColor = resource.dominantColor;
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
    dominantColor: resource.dominantColor,
    tooltip: resource.tooltip,
    oreDictionary: resource.oreDictionary,
    alternatives: resource.alternatives,
  });
}

async function loadCropNhSeedCatalog(instanceRoot) {
  if (!instanceRoot) {
    return [];
  }

  const questsDir = path.join(instanceRoot, "config", "betterquesting", "DefaultQuests", "Quests");
  const cropsById = new Map();

  try {
    for await (const questPath of walkJsonFiles(questsDir)) {
      const quest = JSON.parse(stripBom(await fs.readFile(questPath, "utf8")));
      const questName = betterQuestingQuestName(quest);
      const cropIds = findCropNhSeedCropIds(quest);
      for (const cropId of cropIds) {
        const cropName = questName || cropNameFromCropId(cropId);
        if (!cropName) {
          continue;
        }

        const existing = cropsById.get(cropId);
        if (!existing || cropName.length < existing.cropName.length) {
          cropsById.set(cropId, {
            cropId,
            cropName,
            tokens: meaningfulCropTokens(`${cropName} ${cropId.replace(/^cropsnh:/, "")}`),
          });
        }
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`Could not read CropNH quest seed names from ${questsDir}: ${error.message}`);
    }
  }

  const catalog = [...cropsById.values()].filter((entry) => entry.tokens.length > 0);
  if (catalog.length > 0) {
    console.log(`Collected ${catalog.length} CropNH seed name(s).`);
  }
  return catalog;
}

async function* walkJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonFiles(entryPath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      yield entryPath;
    }
  }
}

function betterQuestingQuestName(quest) {
  const properties = typedValue(quest, "properties");
  const betterQuesting = typedValue(properties, "betterquesting");
  return stripMinecraftFormatting(text(typedValue(betterQuesting, "name"), ""));
}

function findCropNhSeedCropIds(value) {
  const cropIds = new Set();
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

    if (typedValue(current, "id") === "cropsnh:genericSeed") {
      const cropId = typedValue(typedValue(current, "tag"), "crop");
      if (typeof cropId === "string" && cropId.startsWith("cropsnh:")) {
        cropIds.add(cropId);
      }
    }

    for (const child of Object.values(current)) {
      if (child && typeof child === "object") {
        stack.push(child);
      }
    }
  }

  return [...cropIds];
}

function typedValue(value, key) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(value, key)) {
    return value[key];
  }

  const typedPrefix = `${key}:`;
  const entry = Object.entries(value).find(([entryKey]) => entryKey.startsWith(typedPrefix));
  return entry?.[1];
}

function stripMinecraftFormatting(value) {
  return text(value, "")
    .replace(/\u00a7./g, "")
    .trim();
}

function cropNameFromCropId(cropId) {
  const localId = cropId.replace(/^cropsnh:/, "");
  const words = titleWords(localId);
  if (words[0]?.toLowerCase() === "bonsai" && words.length > 1) {
    return [...words.slice(1), "Bonsai"].join(" ");
  }
  return words.join(" ");
}

function meaningfulCropTokens(value) {
  const stopWords = new Set([
    "crop",
    "crops",
    "generic",
    "item",
    "material",
    "scanned",
    "seed",
    "seeds",
  ]);
  return [
    ...new Set(
      titleWords(value)
        .map((word) => word.toLowerCase())
        .filter((word) => word.length > 1 && !stopWords.has(word)),
    ),
  ];
}

function titleWords(value) {
  return text(value, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
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

function passiveNeiHandlers(source) {
  if (!source) {
    return [];
  }

  if (Array.isArray(source.handlers)) {
    return source.handlers;
  }

  if (Array.isArray(source.recipeHandlers)) {
    return source.recipeHandlers;
  }

  return [];
}

function passiveNeiRecipes(handler) {
  if (Array.isArray(handler?.recipes)) {
    return handler.recipes;
  }

  if (Array.isArray(handler?.recs)) {
    return handler.recs;
  }

  return [];
}

function passiveNeiItems(rawRecipe, keys) {
  for (const key of keys) {
    const value = rawRecipe?.[key];
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === "object") {
      return [value];
    }
  }

  return [];
}

function passiveNeiHandlerName(handler) {
  return text(handler?.n, text(handler?.name, text(handler?.recipeMap, "NEI Passive")));
}

function passiveNeiMachineType(handler) {
  const label = normalizeLabel(passiveNeiHandlerName(handler));
  if (!isPassiveNeiHandlerLabel(label)) {
    return undefined;
  }

  if (label.includes("bee") || label.includes("apiary") || label.includes("alveary")) {
    return "Bee Production";
  }

  if (label.includes("cropnh")) {
    return "CropNH";
  }

  return "IC2 Crop";
}

function isPassiveNeiHandlerLabel(label) {
  return (
    label.includes("ic2 crop") ||
    label.includes("cropnh") ||
    label.includes("crop production") ||
    label.includes("bee product") ||
    label.includes("bee production") ||
    label.includes("apiary") ||
    label.includes("alveary")
  );
}

function passiveNeiDurationTicks(rawRecipe, machineType) {
  const duration = Number(rawRecipe?.dur ?? rawRecipe?.durationTicks ?? rawRecipe?.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return duration;
  }

  return machineType === "Bee Production" ? 550 : 1200;
}

function passiveNeiSlots(rawRecipe) {
  const slots = Array.isArray(rawRecipe?.sl) ? rawRecipe.sl : [];
  return slots
    .map((slot) => {
      const side = slot?.s ?? slot?.side;
      const kind = slot?.k ?? slot?.kind ?? "item";
      const slotIndex = Number(slot?.i ?? slot?.slotIndex ?? slot?.slot ?? 0);
      const x = Number(slot?.x);
      const y = Number(slot?.y);
      if (
        (side !== "input" && side !== "output") ||
        kind !== "item" ||
        !Number.isFinite(slotIndex) ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) {
        return undefined;
      }

      return { side, kind, slotIndex, x, y };
    })
    .filter(Boolean);
}

function passiveNeiSlot(rawRecipe, side, item, fallbackIndex) {
  const slotIndex = Number.isFinite(item?.sl) ? item.sl : fallbackIndex;
  return passiveNeiSlots(rawRecipe).find(
    (slot) => slot.side === side && slot.kind === "item" && slot.slotIndex === slotIndex,
  );
}

function passiveNeiSlotCapacity(rawRecipe, inputCount, outputCount) {
  const slots = passiveNeiSlots(rawRecipe);
  if (slots.length > 0) {
    return slotCapacityFromFrames(slots);
  }

  return {
    maxItemInputs: Math.max(1, inputCount),
    maxItemOutputs: Math.max(1, outputCount),
  };
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
    dominantColor: renderedIconDominantColor(item.ic),
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
    dominantColor: primaryAlternative?.dominantColor,
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
    dominantColor: resource.dominantColor,
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
    dominantColor: renderedIconDominantColor(fluid.ic),
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

function renderedIconDominantColor(fileName) {
  if (!fileName) {
    return undefined;
  }

  return renderedIconColors.get(path.basename(String(fileName)));
}

async function indexRenderedIconColors(datasetOutDir, files) {
  const colors = new Map();
  const renderedDir = path.join(datasetOutDir, "textures", "rendered");

  for (const fileName of files) {
    const filePath = path.join(renderedDir, fileName);
    try {
      const icon = PNG.sync.read(await fs.readFile(filePath));
      colors.set(fileName, getDominantOpaqueColor(icon));
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return colors;
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
