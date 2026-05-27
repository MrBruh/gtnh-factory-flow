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

interface Ic2CropSimulationProfile {
  tier: number;
  environmentScore: number;
  baselineStats: CropStatsPreset;
}

type PassiveProductionRecipeLabel = Pick<Recipe, "machineType" | "name" | "source"> & {
  recipeMap?: string;
};

const IC2_STICKREED_PROFILE: Ic2CropSimulationProfile = {
  tier: 4,
  environmentScore: 120,
  baselineStats: { growth: 23, gain: 31, resistance: 0 },
};

const CROPNH_GENERIC_PROFILE: Ic2CropSimulationProfile = {
  tier: 1,
  environmentScore: 120,
  baselineStats: { growth: 31, gain: 31, resistance: 31 },
};

const SQRT_2_PI = Math.sqrt(2 * Math.PI);
const ic2DropMultiplierCache = new Map<string, number>();
const ic2GrowthCycleCache = new Map<string, number>();

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
    minimumTier: "NONE",
    eut: 0,
    machineHandlers: [],
    machineConfigControls,
    notes: withPassiveProductionNote(
      recipe.notes,
      "Crop production controls are best-effort passive averages. Seed count multiplies output without adding power draw.",
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
        cropStatsOption({ growth: 1, gain: 1, resistance: 1 }, CROPNH_GENERIC_PROFILE),
        cropStatsOption({ growth: 23, gain: 31, resistance: 0 }, CROPNH_GENERIC_PROFILE),
        cropStatsOption({ growth: 31, gain: 31, resistance: 31 }, CROPNH_GENERIC_PROFILE),
      ]
    : [
        cropStatsOption({ growth: 1, gain: 1, resistance: 1 }, IC2_STICKREED_PROFILE),
        cropStatsOption({ growth: 23, gain: 31, resistance: 0 }, IC2_STICKREED_PROFILE),
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
  profile: Ic2CropSimulationProfile,
): MachineConfigTierOption {
  const label = `${stats.growth}/${stats.gain}/${stats.resistance}`;
  const effect = ic2CropStatsEffect(stats, profile);
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

function ic2CropStatsEffect(
  stats: CropStatsPreset,
  profile: Ic2CropSimulationProfile,
): Pick<MachineConfigTierOption, "durationMultiplier" | "outputMultiplier"> {
  // Mirrors GTNH EIG's IC2 crop approximation: gain changes drop rounds, growth changes tick cycles.
  const baselineCycles = ic2AverageGrowthCycles(profile.baselineStats, profile);
  const cycles = ic2AverageGrowthCycles(stats, profile);
  const durationMultiplier = cycles > 0 && baselineCycles > 0 ? cycles / baselineCycles : 1;

  return {
    durationMultiplier: roundMultiplier(durationMultiplier),
    outputMultiplier: roundMultiplier(ic2ExpectedHarvestOutput(stats.gain, profile.tier)),
  };
}

function ic2ExpectedHarvestOutput(gain: number, tier: number) {
  const cacheKey = `${tier}:${gain}`;
  const cached = ic2DropMultiplierCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const baseDropGainChance = 0.95 ** tier;
  const dropRounds = ic2AverageDropRounds(baseDropGainChance * 1.03 ** gain);
  const stackIncrease = (gain + 1) / 100;
  const multiplier = dropRounds * (1 + stackIncrease);
  ic2DropMultiplierCache.set(cacheKey, multiplier);
  return multiplier;
}

function ic2AverageDropRounds(chance: number) {
  const min = -10;
  const max = 10;
  const steps = 10_000;
  const stepSize = (max - min) / steps;
  let sum = 0;

  for (let step = 1; step <= steps - 1; step += 1) {
    sum += weightedDropChance(min + step * stepSize, chance);
  }

  return stepSize * ((weightedDropChance(min, chance) + weightedDropChance(max, chance)) / 2 + sum);
}

function weightedDropChance(x: number, chance: number) {
  return Math.max(0, Math.round(x * chance * 0.6827 + chance)) * standardNormalDistribution(x);
}

function standardNormalDistribution(x: number) {
  return Math.exp(-0.5 * x * x) / SQRT_2_PI;
}

function ic2AverageGrowthCycles(stats: CropStatsPreset, profile: Ic2CropSimulationProfile) {
  const cacheKey = `${profile.tier}:${profile.environmentScore}:${stats.growth}:${stats.gain}:${stats.resistance}`;
  const cached = ic2GrowthCycleCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const growthSpeeds = Array.from({ length: 7 }, (_unused, roll) =>
    ic2AverageGrowthRate(stats, profile, roll),
  );
  if (growthSpeeds.some((speed) => speed < 0)) {
    ic2GrowthCycleCache.set(cacheKey, -1);
    return -1;
  }

  const nonZeroSpeeds = growthSpeeds.filter((speed) => speed > 0);
  const zeroRolls = growthSpeeds.length - nonZeroSpeeds.length;
  if (zeroRolls >= growthSpeeds.length) {
    ic2GrowthCycleCache.set(cacheKey, -1);
    return -1;
  }

  const stageGoal = profile.tier * 200;
  const stageGoals = [0, stageGoal, stageGoal, stageGoal];
  const startStageFrequency = new Map([
    [1, 1],
    [2, 1],
    [3, 1],
  ]);
  const frequencySum = [...startStageFrequency.values()].reduce((sum, value) => sum + value, 0);
  const averageCyclesByStage = stageGoals.map((goal) => averageCyclesToGoal(nonZeroSpeeds, goal));
  const normalizedStageFrequencies = stageGoals.map(
    (_goal, stage) => ((startStageFrequency.get(stage) ?? 0) * stageGoals.length) / frequencySum,
  );
  const frequencyMultipliers = new Array(averageCyclesByStage.length).fill(1);

  convolveSignalInPlace(
    frequencyMultipliers,
    normalizedStageFrequencies,
    new Array(averageCyclesByStage.length).fill(0),
    0,
    frequencyMultipliers.length,
    0,
  );

  const average =
    averageCyclesByStage.reduce(
      (sum, value, index) => sum + value * (frequencyMultipliers[index] ?? 1),
      0,
    ) / averageCyclesByStage.length;
  const zeroRollAdjustedAverage =
    zeroRolls > 0 ? (average / nonZeroSpeeds.length) * growthSpeeds.length : average;

  ic2GrowthCycleCache.set(cacheKey, zeroRollAdjustedAverage);
  return zeroRollAdjustedAverage;
}

function ic2AverageGrowthRate(
  stats: CropStatsPreset,
  profile: Ic2CropSimulationProfile,
  rngRoll: number,
) {
  const base = 3 + rngRoll + stats.growth;
  const need = Math.max(0, (profile.tier - 1) * 4 + stats.growth + stats.gain + stats.resistance);
  const have = profile.environmentScore;

  if (have >= need) {
    return Math.trunc((base * (100 + (have - need))) / 100);
  }

  const penalty = (need - have) * 4;
  if (penalty > 100) {
    return stats.resistance >= 31 ? 0 : -1;
  }
  return Math.max(0, Math.trunc((base * (100 - penalty)) / 100));
}

function averageCyclesToGoal(speeds: number[], goal: number) {
  if (goal <= 0) {
    return 1;
  }

  const maxSpeed = speeds[speeds.length - 1] ?? 1;
  const goalCap = maxSpeed * 1000;
  let cappedGoal = goal;
  let multiplier = 1;

  if (goal > goalCap) {
    multiplier = goal / goalCap;
    cappedGoal = goalCap;
  }

  const signal = new Array(cappedGoal).fill(0);
  signal[0] = 1;
  const kernel = tabulate(speeds, 1 / speeds.length);
  const target = new Array(signal.length).fill(0);
  const min = speeds[0] ?? 0;
  const max = maxSpeed;
  let averageRolls = 1;
  let iteration = 0;
  let probability: number;

  do {
    probability = convolveSignalInPlace(signal, kernel, target, min, max, iteration);
    averageRolls += probability;
    iteration += 1;
  } while (probability >= 0.1 / cappedGoal);

  return averageRolls * multiplier;
}

function tabulate(values: number[], multiplier: number) {
  const max = Math.max(...values);
  const tabulated = new Array(max + 1).fill(0);
  for (const value of values) {
    tabulated[value] += multiplier;
  }
  return tabulated;
}

function convolveSignalInPlace(
  signal: number[],
  kernel: number[],
  target: number[],
  minValue: number,
  maxValue: number,
  iteration: number,
) {
  let sum = 0;
  const maxK = Math.min(signal.length, (iteration + 1) * maxValue + 1);
  const startAt = Math.min(signal.length, minValue * (iteration + 1));
  let k = Math.max(0, startAt - kernel.length);

  for (; k < startAt; k += 1) {
    target[k] = 0;
  }

  for (; k < maxK; k += 1) {
    target[k] = 0;
    for (let i = Math.max(0, k - kernel.length + 1); i <= k; i += 1) {
      const value = (signal[i] ?? 0) * (kernel[k - i] ?? 0);
      sum += value;
      target[k] = (target[k] ?? 0) + value;
    }
  }

  for (let index = 0; index < signal.length; index += 1) {
    signal[index] = target[index] ?? 0;
  }

  return sum;
}

function roundMultiplier(value: number) {
  return Math.round(value * 1000) / 1000;
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
    `${recipe.source?.recipeMap ?? recipe.recipeMap ?? ""} ${recipe.machineType}`,
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
