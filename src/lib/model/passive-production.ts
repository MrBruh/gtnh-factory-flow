import type {
  MachineConfigControl,
  MachineConfigTierOption,
  MachineHandler,
  Recipe,
  ResourceAmount,
} from "./types";

export const CROP_STATS_CONTROL_ID = "cropStats";
export const CROP_HYDRATION_CONTROL_ID = "cropHydration";
export const CROP_NUTRIENTS_CONTROL_ID = "cropNutrients";
export const CROP_WEED_CONTROL_ID = "cropWeedControl";
export const CROP_SOIL_CONTROL_ID = "cropSoil";
export const CROP_SOIL_DEPTH_CONTROL_ID = "cropSoilDepth";
export const CROP_AIR_QUALITY_CONTROL_ID = "cropAirQuality";

export const BEE_FRAME_CONTROL_ID = "beeFrames";
export const BEE_ENVIRONMENT_CONTROL_ID = "beeEnvironment";
export const BEE_PRODUCTIVITY_CONTROL_ID = "beeProductivity";

const CROP_CONTROL_IDS = new Set([
  CROP_STATS_CONTROL_ID,
  CROP_HYDRATION_CONTROL_ID,
  CROP_NUTRIENTS_CONTROL_ID,
  CROP_WEED_CONTROL_ID,
  CROP_SOIL_CONTROL_ID,
  CROP_SOIL_DEPTH_CONTROL_ID,
  CROP_AIR_QUALITY_CONTROL_ID,
]);

const BEE_CONTROL_IDS = new Set([
  BEE_FRAME_CONTROL_ID,
  BEE_ENVIRONMENT_CONTROL_ID,
  BEE_PRODUCTIVITY_CONTROL_ID,
]);

export interface CropStatsPreset {
  growth: number;
  gain: number;
  resistance: number;
}

type PassiveProductionRecipeLabel = Pick<Recipe, "machineType" | "name" | "source"> & {
  recipeMap?: string;
};

export function enrichPassiveProductionRecipe(recipe: Recipe): Recipe {
  if (isCropProductionRecipe(recipe)) {
    return enrichCropProductionRecipe(recipe);
  }

  if (isBeeProductionRecipe(recipe)) {
    return enrichBeeProductionRecipe(recipe);
  }

  return recipe;
}

export function isCropProductionRecipe(recipe: PassiveProductionRecipeLabel) {
  const label = passiveProductionLabel(recipe);
  if (label === "tree growth simulator") {
    return false;
  }

  return (
    /\bic2 crops?\b/.test(label) || /\bcropnh\b/.test(label) || /\bcrop production\b/.test(label)
  );
}

export function isIc2LegacyCropRecipe(recipe: PassiveProductionRecipeLabel) {
  const label = passiveProductionLabel(recipe);
  return /\bic2 crops?\b/.test(label) && !/\bcropnh\b/.test(label);
}

export function isCropNhRecipe(recipe: PassiveProductionRecipeLabel) {
  return /\bcropnh\b/.test(passiveProductionLabel(recipe));
}

export function isBeeProductionRecipe(recipe: PassiveProductionRecipeLabel) {
  const label = passiveProductionLabel(recipe);
  return (
    /\bbee production\b/.test(label) ||
    /\bbee products?\b/.test(label) ||
    /\bapiary\b/.test(label) ||
    /\balveary\b/.test(label)
  );
}

export function isCropProductionConfigControl(controlId: string) {
  return CROP_CONTROL_IDS.has(controlId);
}

export function isBeeProductionConfigControl(controlId: string) {
  return BEE_CONTROL_IDS.has(controlId);
}

export function getCropStatsPreset(value: string | undefined): CropStatsPreset | undefined {
  const match = /^(\d+)-(\d+)-(\d+)$/.exec(value ?? "");
  if (!match) {
    return undefined;
  }

  return {
    growth: Number.parseInt(match[1] ?? "0", 10),
    gain: Number.parseInt(match[2] ?? "0", 10),
    resistance: Number.parseInt(match[3] ?? "0", 10),
  };
}

function enrichCropProductionRecipe(recipe: Recipe): Recipe {
  const controls = cropProductionControls(recipe);
  const machineConfigControls = mergeMachineConfigControls(recipe.machineConfigControls, controls);
  const baseMachine = "Crop Manager";

  return {
    ...recipe,
    machineType: isPassiveBaseMachine(recipe.machineType) ? baseMachine : recipe.machineType,
    minimumTier:
      recipe.minimumTier === "NONE" || recipe.minimumTier === "UNKNOWN" ? "LV" : recipe.minimumTier,
    eut: recipe.eut > 0 ? recipe.eut : 8,
    machineHandlers: mergeMachineHandlers(recipe.machineHandlers, cropMachineHandlers()),
    machineConfigControls,
    notes: withPassiveProductionNote(
      recipe.notes,
      "Crop production controls are best-effort averages.",
    ),
  };
}

function enrichBeeProductionRecipe(recipe: Recipe): Recipe {
  const controls = beeProductionControls();

  return {
    ...recipe,
    machineType: isPassiveBaseMachine(recipe.machineType) ? "Apiary" : recipe.machineType,
    minimumTier: recipe.minimumTier === "UNKNOWN" ? "NONE" : recipe.minimumTier,
    eut: recipe.eut > 0 ? recipe.eut : 0,
    machineHandlers: mergeMachineHandlers(recipe.machineHandlers, beeMachineHandlers()),
    machineConfigControls: mergeMachineConfigControls(recipe.machineConfigControls, controls),
    notes: withPassiveProductionNote(
      recipe.notes,
      "Bee production controls are best-effort averages.",
    ),
  };
}

function cropProductionControls(recipe: PassiveProductionRecipeLabel) {
  return [
    cropStatsControl(recipe),
    selectControl({
      id: CROP_HYDRATION_CONTROL_ID,
      label: "Hydration",
      defaultKey: "normal",
      tiers: [
        option("dry", "Dry", "crop_hydration_dry", "Dry", { durationMultiplier: 1.25 }),
        option("normal", "Normal", "crop_hydration_normal", "Normal"),
        option("hydrated", "Hydrated", "crop_hydration_hydrated", "Hydrated", {
          durationMultiplier: 0.92,
        }),
        option("constant", "Constant Water", "crop_hydration_constant", "Constant Water", {
          durationMultiplier: 0.85,
        }),
      ],
    }),
    selectControl({
      id: CROP_NUTRIENTS_CONTROL_ID,
      label: "Nutrients",
      defaultKey: "none",
      tiers: [
        option("none", "None", "crop_nutrients_none", "No Fertilizer"),
        option("fertilized", "Fertilized", "crop_nutrients_fertilized", "Fertilized", {
          durationMultiplier: 0.9,
        }),
        option(
          "constant",
          "Constant Fertilizer",
          "crop_nutrients_constant",
          "Constant Fertilizer",
          {
            durationMultiplier: 0.82,
          },
        ),
      ],
    }),
    selectControl({
      id: CROP_WEED_CONTROL_ID,
      label: "Weed Control",
      defaultKey: "managed",
      tiers: [
        option("none", "None", "crop_weed_none", "No Weed Control"),
        option("weed-ex", "Weed-EX", "crop_weed_ex", "Weed-EX"),
        option("managed", "Managed", "crop_weed_managed", "Managed Weed Control"),
      ],
    }),
    selectControl({
      id: CROP_SOIL_CONTROL_ID,
      label: "Soil",
      defaultKey: "farmland",
      tiers: [
        option("dirt", "Dirt", "minecraft:dirt", "Dirt", { durationMultiplier: 1.15 }),
        option("farmland", "Farmland", "minecraft:farmland", "Farmland"),
        option(
          "hydrated-farmland",
          "Hydrated Farmland",
          "minecraft:farmland@7",
          "Hydrated Farmland",
          {
            durationMultiplier: 0.95,
          },
        ),
        option("cropmatron", "Crop-Matron", "ic2:blockCropmatron", "Crop-Matron Managed Soil", {
          durationMultiplier: 0.9,
        }),
      ],
    }),
    selectControl({
      id: CROP_SOIL_DEPTH_CONTROL_ID,
      label: "Soil Depth",
      defaultKey: "1",
      tiers: [
        option("0", "0", "crop_depth_0", "Depth 0", { durationMultiplier: 1.12 }),
        option("1", "1", "crop_depth_1", "Depth 1"),
        option("2", "2", "crop_depth_2", "Depth 2", { durationMultiplier: 0.96 }),
        option("3-plus", "3+", "crop_depth_3_plus", "Depth 3+", { durationMultiplier: 0.92 }),
      ],
    }),
    selectControl({
      id: CROP_AIR_QUALITY_CONTROL_ID,
      label: "Air Quality",
      defaultKey: "normal",
      tiers: [
        option("poor", "Poor", "crop_air_poor", "Poor Air", { durationMultiplier: 1.2 }),
        option("normal", "Normal", "crop_air_normal", "Normal Air"),
        option("good", "Good", "crop_air_good", "Good Air", { durationMultiplier: 0.96 }),
        option("optimal", "Optimal", "crop_air_optimal", "Optimal Air", {
          durationMultiplier: 0.9,
        }),
      ],
    }),
  ];
}

function cropStatsControl(recipe: PassiveProductionRecipeLabel): MachineConfigControl {
  const tiers = isCropNhRecipe(recipe)
    ? [
        cropStatsOption(
          { growth: 1, gain: 1, resistance: 1 },
          { durationMultiplier: 31, outputMultiplier: 1 / 31 },
        ),
        cropStatsOption({ growth: 23, gain: 31, resistance: 0 }, { durationMultiplier: 31 / 23 }),
        cropStatsOption({ growth: 31, gain: 31, resistance: 31 }),
      ]
    : [
        cropStatsOption(
          { growth: 1, gain: 1, resistance: 1 },
          { durationMultiplier: 23, outputMultiplier: 1 / 31 },
        ),
        cropStatsOption({ growth: 23, gain: 31, resistance: 0 }),
      ];

  return {
    id: CROP_STATS_CONTROL_ID,
    label: "Crop Stats",
    minimumKey: tiers[0]?.key ?? "1-1-1",
    defaultKey: isCropNhRecipe(recipe) ? "31-31-31" : "23-31-0",
    tiers,
  };
}

function beeProductionControls(): MachineConfigControl[] {
  return [
    selectControl({
      id: BEE_FRAME_CONTROL_ID,
      label: "Frames",
      defaultKey: "none",
      tiers: [
        option("none", "None", "bee_frames_none", "No Frames"),
        option("impregnated", "Impregnated", "Forestry:frameImpregnated", "Impregnated Frames", {
          outputMultiplier: 1.5,
          durationMultiplier: 0.8,
        }),
        option("proven", "Proven", "Forestry:frameProven", "Proven Frames", {
          outputMultiplier: 2,
          durationMultiplier: 0.75,
        }),
        option("soul", "Soul", "MagicBees:frameSoul", "Soul Frames", {
          outputMultiplier: 2.5,
          durationMultiplier: 0.7,
        }),
      ],
    }),
    selectControl({
      id: BEE_ENVIRONMENT_CONTROL_ID,
      label: "Environment",
      defaultKey: "matched",
      tiers: [
        option("mismatched", "Mismatched", "bee_environment_mismatched", "Mismatched Climate", {
          durationMultiplier: 1.5,
          outputMultiplier: 0.5,
        }),
        option("matched", "Matched", "bee_environment_matched", "Matched Climate"),
        option("controlled", "Controlled", "bee_environment_controlled", "Controlled Climate", {
          durationMultiplier: 0.9,
        }),
      ],
    }),
    selectControl({
      id: BEE_PRODUCTIVITY_CONTROL_ID,
      label: "Productivity",
      defaultKey: "species",
      tiers: [
        option("species", "Species Default", "bee_productivity_species", "Species Default"),
        option(
          "optimized",
          "Production Optimized",
          "bee_productivity_optimized",
          "Production Optimized",
          {
            outputMultiplier: 1.5,
          },
        ),
        option(
          "industrial",
          "Industrial Boost",
          "bee_productivity_industrial",
          "Industrial Boost",
          {
            outputMultiplier: 2.5,
            durationMultiplier: 0.8,
          },
        ),
      ],
    }),
  ];
}

function cropMachineHandlers(): MachineHandler[] {
  return [
    {
      id: "ic2-crop-harvester",
      label: "IC2 Crop Harvester",
      machineType: "IC2 Crop Harvester",
      minimumTier: "LV",
      eut: 4,
      kind: "automation",
    },
    {
      id: "forestry-multifarm",
      label: "Forestry Multifarm",
      machineType: "Forestry Multifarm",
      minimumTier: "MV",
      eut: 16,
      kind: "multiblock",
    },
    {
      id: "extreme-industrial-greenhouse",
      label: "Extreme Industrial Greenhouse",
      machineType: "Extreme Industrial Greenhouse",
      minimumTier: "HV",
      eut: 120,
      kind: "multiblock",
    },
  ];
}

function beeMachineHandlers(): MachineHandler[] {
  return [
    {
      id: "alveary",
      label: "Alveary",
      machineType: "Alveary",
      minimumTier: "NONE",
      eut: 0,
      kind: "multiblock",
    },
    {
      id: "industrial-apiary",
      label: "Industrial Apiary",
      machineType: "Industrial Apiary",
      minimumTier: "MV",
      eut: 32,
      kind: "automation",
    },
    {
      id: "mega-apiary",
      label: "Mega Apiary",
      machineType: "Mega Apiary",
      minimumTier: "HV",
      eut: 120,
      kind: "multiblock",
    },
  ];
}

function cropStatsOption(
  stats: CropStatsPreset,
  effect: Pick<MachineConfigTierOption, "durationMultiplier" | "outputMultiplier"> = {},
): MachineConfigTierOption {
  const label = `${stats.growth}/${stats.gain}/${stats.resistance}`;
  return {
    key: `${stats.growth}-${stats.gain}-${stats.resistance}`,
    label,
    ...effect,
    resource: configResource(
      `crop_stats_${stats.growth}_${stats.gain}_${stats.resistance}`,
      label,
      [
        "Crop stat preset",
        `Growth: ${stats.growth}`,
        `Gain: ${stats.gain}`,
        `Resistance: ${stats.resistance}`,
      ],
    ),
  };
}

function selectControl({
  id,
  label,
  defaultKey,
  tiers,
}: {
  id: string;
  label: string;
  defaultKey: string;
  tiers: MachineConfigTierOption[];
}): MachineConfigControl {
  return {
    id,
    label,
    minimumKey: tiers[0]?.key ?? defaultKey,
    defaultKey,
    tiers,
  };
}

function option(
  key: string,
  label: string,
  resourceId: string,
  resourceLabel: string,
  effect: Pick<
    MachineConfigTierOption,
    "durationMultiplier" | "eutMultiplier" | "outputMultiplier" | "parallelMultiplier"
  > = {},
): MachineConfigTierOption {
  return {
    key,
    label,
    ...effect,
    resource: configResource(resourceId, resourceLabel, [label]),
  };
}

function configResource(id: string, displayName: string, tooltip: string[] = []): ResourceAmount {
  return {
    kind: "item",
    id: id.includes(":") ? id : `factoryflow:${id}`,
    amount: 1,
    displayName,
    tooltip,
  };
}

function mergeMachineHandlers(
  existing: Recipe["machineHandlers"],
  incoming: MachineHandler[],
): MachineHandler[] {
  const handlersById = new Map<string, MachineHandler>();
  for (const handler of [...(existing ?? []), ...incoming]) {
    if (isManualHandler(handler)) {
      continue;
    }
    handlersById.set(handler.id, handler);
  }
  return [...handlersById.values()];
}

function mergeMachineConfigControls(
  existing: Recipe["machineConfigControls"],
  incoming: MachineConfigControl[],
): MachineConfigControl[] {
  const controlsById = new Map<string, MachineConfigControl>();
  for (const control of [...incoming, ...(existing ?? [])]) {
    controlsById.set(control.id, control);
  }
  return [...controlsById.values()];
}

function isManualHandler(handler: Pick<MachineHandler, "id" | "label" | "machineType">) {
  const label = normalizeLabel(`${handler.id} ${handler.label} ${handler.machineType}`);
  return /\bmanual\b/.test(label);
}

function isPassiveBaseMachine(machineType: string) {
  const label = normalizeLabel(machineType);
  return (
    label === "ic2 crop" ||
    label === "ic2 crops" ||
    label === "cropnh" ||
    label === "crop production" ||
    label === "bee production" ||
    label === "bee products"
  );
}

function withPassiveProductionNote(notes: string | undefined, note: string) {
  if (!notes) {
    return note;
  }
  return notes.includes(note) ? notes : `${notes}\n${note}`;
}

function passiveProductionLabel(recipe: PassiveProductionRecipeLabel) {
  return normalizeLabel(
    `${recipe.source?.recipeMap ?? recipe.recipeMap ?? ""} ${recipe.machineType} ${recipe.name}`,
  );
}

function normalizeLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b(recipes?|recipe map|map)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
