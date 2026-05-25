import type { FactoryNode, MachineHandler, Recipe, RecipeInput } from "./types";

const EBF_COIL_REQUIREMENTS = [
  {
    heat: 1801,
    key: "cupronickel",
    label: "Cupronickel",
    blockMeta: 0,
    colors: ["#b87953", "#e0b084"],
  },
  { heat: 2701, key: "kanthal", label: "Kanthal", blockMeta: 1, colors: ["#b77b37", "#f3c362"] },
  { heat: 3601, key: "nichrome", label: "Nichrome", blockMeta: 2, colors: ["#b9b9c4", "#f0d6d6"] },
  { heat: 4501, key: "tpv", label: "TPV-Alloy", blockMeta: 3, colors: ["#4e687b", "#9dc5de"] },
  { heat: 5401, key: "hss_g", label: "HSS-G", blockMeta: 4, colors: ["#5d7881", "#b8e3eb"] },
  { heat: 6301, key: "hss_s", label: "HSS-S", blockMeta: 9, colors: ["#8a6f9d", "#dcc3f5"] },
  { heat: 7201, key: "naquadah", label: "Naquadah", blockMeta: 5, colors: ["#2d5d43", "#69c48d"] },
  {
    heat: 8101,
    key: "naquadah_alloy",
    label: "Naquadah Alloy",
    blockMeta: 6,
    colors: ["#355956", "#7dd7c5"],
  },
  { heat: 9001, key: "trinium", label: "Trinium", blockMeta: 10, colors: ["#6c5f72", "#cdb9d6"] },
  {
    heat: 9901,
    key: "electrum_flux",
    label: "Electrum Flux",
    blockMeta: 7,
    colors: ["#966a1d", "#ffe36b"],
  },
  {
    heat: 10801,
    key: "awakened_draconium",
    label: "Awakened Draconium",
    blockMeta: 8,
    colors: ["#b85a23", "#ff9a3d"],
  },
  {
    heat: 11701,
    key: "infinity",
    label: "Infinity",
    blockMeta: 11,
    colors: ["#5f5f72", "#ffffff"],
  },
  { heat: 12601, key: "hypogen", label: "Hypogen", blockMeta: 12, colors: ["#43315c", "#d278ff"] },
  { heat: 13501, key: "eternal", label: "Eternal", blockMeta: 13, colors: ["#222222", "#f6f3ff"] },
] as const;

export type HeatingCoilTier = (typeof EBF_COIL_REQUIREMENTS)[number]["key"];

const PIPE_CASING_REQUIREMENTS = [
  {
    key: "bronze",
    label: "Bronze",
    blockId: "gregtech:gt.blockcasings2@12",
    colors: ["#8b5a2b", "#d19a4d"],
  },
  {
    key: "steel",
    label: "Steel",
    blockId: "gregtech:gt.blockcasings2@13",
    colors: ["#6b7378", "#b8c0c5"],
  },
  {
    key: "titanium",
    label: "Titanium",
    blockId: "gregtech:gt.blockcasings2@14",
    colors: ["#6b6f8f", "#c7cbe8"],
  },
  {
    key: "tungstensteel",
    label: "Tungstensteel",
    blockId: "gregtech:gt.blockcasings2@15",
    colors: ["#3d4a56", "#9fb0bd"],
  },
  {
    key: "ptfe",
    label: "PTFE",
    blockId: "gregtech:gt.blockcasings8@1",
    colors: ["#f0f0e6", "#78a0a0"],
  },
  {
    key: "pbi",
    label: "PBI",
    blockId: "gregtech:gt.blockcasings9",
    colors: ["#3c332d", "#d1a476"],
  },
] as const;

export type PipeCasingTier = (typeof PIPE_CASING_REQUIREMENTS)[number]["key"];

export interface MachineConfigTierControl {
  id: string;
  label: string;
  minimum: MachineConfigTierOption;
  current: MachineConfigTierOption;
  tiers: MachineConfigTierOption[];
  resource: RecipeInput;
}

export interface MachineConfigTierOption {
  key: string;
  label: string;
}

export function expandMachineRecipeVariants(recipes: Recipe[]): Recipe[] {
  return recipes;
}

export function getRecipeMachineHandlers(
  recipe: Pick<Recipe, "machineType" | "minimumTier" | "source" | "machineHandlers">,
): MachineHandler[] {
  const baseHandler: MachineHandler = {
    id: slug(recipe.machineType),
    label: recipe.machineType,
    machineType: recipe.machineType,
    minimumTier: recipe.minimumTier,
    kind: "single",
  };
  const handlers = [baseHandler, ...(recipe.machineHandlers ?? [])];

  return [...new Map(handlers.map((handler) => [handler.id, handler])).values()];
}

export function getSelectedMachineHandler(
  recipe: Pick<Recipe, "machineType" | "minimumTier" | "source" | "machineHandlers">,
  node: Pick<FactoryNode, "machineHandlerId">,
): MachineHandler {
  const handlers = getRecipeMachineHandlers(recipe);
  return handlers.find((handler) => handler.id === node.machineHandlerId) ?? handlers[0];
}

export function getAdjacentMachineHandler(
  recipe: Pick<Recipe, "machineType" | "minimumTier" | "source" | "machineHandlers">,
  currentId: string | undefined,
  direction: -1 | 1,
): MachineHandler {
  const handlers = getRecipeMachineHandlers(recipe);
  const currentIndex = Math.max(
    0,
    handlers.findIndex((handler) => handler.id === currentId),
  );
  const nextIndex = (currentIndex + direction + handlers.length) % handlers.length;
  return handlers[nextIndex] ?? handlers[0];
}

export function applyMachineHandlerToRecipe(
  recipe: Recipe,
  node: Pick<FactoryNode, "machineHandlerId">,
): Recipe {
  const handler = getSelectedMachineHandler(recipe, node);
  return {
    ...recipe,
    machineType: handler.machineType,
    minimumTier: handler.minimumTier,
    machineProfile: {
      ...recipe.machineProfile,
      machineType: handler.machineType,
      minimumTier: handler.minimumTier,
      maxParallel: handler.maxParallel ?? recipe.machineProfile?.maxParallel,
      eutLimit: handler.eutLimit ?? recipe.machineProfile?.eutLimit,
      notes: handler.notes ?? recipe.machineProfile?.notes,
    },
  };
}

export function isRecipeTierAdjustable(
  recipe: Pick<Recipe, "machineType" | "source" | "nei">,
): boolean {
  const recipeMap = recipeMapName(recipe);

  return !isTieredMachineRecipeMap(recipeMap) && getRecipeSpecialValue(recipe) === undefined;
}

export function getRecipeCoilTierControl(
  recipe: Pick<Recipe, "machineType" | "source" | "nei">,
  node: { coilTier?: string },
) {
  const specialValue = getRecipeSpecialValue(recipe);
  if (isChemicalPlantRecipeMap(recipeMapName(recipe))) {
    const requestedIndex = EBF_COIL_REQUIREMENTS.findIndex((entry) => entry.key === node.coilTier);
    const current = EBF_COIL_REQUIREMENTS[Math.max(0, requestedIndex)] ?? EBF_COIL_REQUIREMENTS[0];
    return {
      minimum: EBF_COIL_REQUIREMENTS[0],
      current,
      tiers: EBF_COIL_REQUIREMENTS,
    };
  }

  if (
    specialValue === undefined ||
    specialValue <= 0 ||
    !isBlastFurnaceRecipeMap(recipeMapName(recipe))
  ) {
    return undefined;
  }

  const minimumIndex = getCoilIndexForHeat(specialValue);
  if (minimumIndex === -1) {
    return undefined;
  }

  const requestedIndex = EBF_COIL_REQUIREMENTS.findIndex((entry) => entry.key === node.coilTier);
  const currentIndex = Math.max(minimumIndex, requestedIndex);
  const minimum = EBF_COIL_REQUIREMENTS[minimumIndex];
  const current = EBF_COIL_REQUIREMENTS[currentIndex] ?? minimum;

  return {
    minimum,
    current,
    tiers: EBF_COIL_REQUIREMENTS.slice(minimumIndex),
  };
}

export function getRecipeMachineConfigTierControls(
  recipe: Pick<Recipe, "machineType" | "source" | "nei">,
  node: Pick<FactoryNode, "machineConfigTiers">,
): MachineConfigTierControl[] {
  const recipeMap = recipeMapName(recipe);
  if (!isChemicalPlantRecipeMap(recipeMap)) {
    return [];
  }

  const currentKey = node.machineConfigTiers?.pipeCasing;
  const current =
    PIPE_CASING_REQUIREMENTS.find((entry) => entry.key === currentKey) ??
    PIPE_CASING_REQUIREMENTS[0];

  return [
    {
      id: "pipeCasing",
      label: "Pipe Casing",
      minimum: PIPE_CASING_REQUIREMENTS[0],
      current,
      tiers: [...PIPE_CASING_REQUIREMENTS],
      resource: pipeCasingTierResource(current),
    },
  ];
}

export function heatingCoilTierResource(coil: (typeof EBF_COIL_REQUIREMENTS)[number]): RecipeInput {
  return makeCoilRequirementInput(coil);
}

export function getAdjacentCoilTier(
  currentKey: string,
  minimumKey: string,
  direction: -1 | 1,
): string {
  const currentIndex = EBF_COIL_REQUIREMENTS.findIndex((entry) => entry.key === currentKey);
  const minimumIndex = EBF_COIL_REQUIREMENTS.findIndex((entry) => entry.key === minimumKey);
  const nextIndex = Math.min(
    EBF_COIL_REQUIREMENTS.length - 1,
    Math.max(minimumIndex, currentIndex + direction),
  );
  return EBF_COIL_REQUIREMENTS[nextIndex]?.key ?? currentKey;
}

export function getAdjacentMachineConfigTier(
  control: MachineConfigTierControl,
  direction: -1 | 1,
): string {
  const currentIndex = control.tiers.findIndex((entry) => entry.key === control.current.key);
  const minimumIndex = control.tiers.findIndex((entry) => entry.key === control.minimum.key);
  const nextIndex = Math.min(
    control.tiers.length - 1,
    Math.max(Math.max(0, minimumIndex), currentIndex + direction),
  );
  return control.tiers[nextIndex]?.key ?? control.current.key;
}

function isTieredMachineRecipeMap(recipeMap: string): boolean {
  const normalized = normalizeRecipeMapName(recipeMap);
  return (
    normalized === "blast furnace" ||
    normalized === "electric blast furnace" ||
    normalized === "pyrolyse oven" ||
    normalized === "cracker" ||
    normalized === "chemical plant" ||
    normalized === "distillation tower" ||
    normalized === "vacuum freezer" ||
    normalized === "fusion reactor"
  );
}

export function getRecipeSpecialValue(recipe: Pick<Recipe, "nei">): number | undefined {
  for (const entry of recipe.nei?.additionalInfo ?? []) {
    const match = /special\s+value\s*:\s*(-?\d+)/i.exec(entry);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return undefined;
}

function makeCoilRequirementInput(coil: (typeof EBF_COIL_REQUIREMENTS)[number]): RecipeInput {
  return {
    kind: "item",
    id:
      coil.blockMeta === 0
        ? "gregtech:gt.blockcasings5"
        : `gregtech:gt.blockcasings5@${coil.blockMeta}`,
    amount: 1,
    displayName: `${coil.label} Coil Block`,
    iconPath: coilTextureDataUri(coil.colors[0], coil.colors[1]),
    consumed: false,
    tooltip: ["Heating coil tier", `Heat capacity: ${coil.heat} K`],
  };
}

function pipeCasingTierResource(casing: (typeof PIPE_CASING_REQUIREMENTS)[number]): RecipeInput {
  return {
    kind: "item",
    id: casing.blockId,
    amount: 1,
    displayName: `${casing.label} Pipe Casing`,
    iconPath: machineConfigTextureDataUri(casing.colors[0], casing.colors[1]),
    consumed: false,
    tooltip: ["Pipe casing tier", `${casing.label} pipe casing`],
  };
}

function getCoilIndexForHeat(heat: number): number {
  for (let index = 0; index < EBF_COIL_REQUIREMENTS.length; index += 1) {
    if (EBF_COIL_REQUIREMENTS[index].heat >= heat) {
      return index;
    }
  }

  return EBF_COIL_REQUIREMENTS.length - 1;
}

function isBlastFurnaceRecipeMap(recipeMap: string): boolean {
  const normalized = normalizeRecipeMapName(recipeMap);
  return normalized === "blast furnace" || normalized === "electric blast furnace";
}

function isChemicalPlantRecipeMap(recipeMap: string): boolean {
  const normalized = normalizeRecipeMapName(recipeMap);
  return normalized === "chemical plant" || normalized === "exxonmobil chemical plant";
}

function recipeMapName(recipe: Pick<Recipe, "machineType" | "source">): string {
  return recipe.source?.recipeMap ?? recipe.machineType;
}

function slug(value: string): string {
  return normalizeRecipeMapName(value).replace(/[^a-z0-9]+/g, "-");
}

function coilTextureDataUri(primary: string, secondary: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" shape-rendering="crispEdges"><rect width="16" height="16" fill="#2a2a2a"/><rect x="2" y="2" width="12" height="12" fill="${primary}"/><rect x="4" y="4" width="8" height="8" fill="#111"/><rect x="5" y="5" width="6" height="6" fill="${secondary}"/><rect x="7" y="7" width="2" height="2" fill="#fff"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function machineConfigTextureDataUri(primary: string, secondary: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" shape-rendering="crispEdges"><rect width="16" height="16" fill="#2b2b2b"/><rect x="1" y="1" width="14" height="14" fill="${primary}"/><rect x="3" y="3" width="10" height="10" fill="${secondary}"/><rect x="5" y="5" width="6" height="6" fill="#262626"/><rect x="6" y="6" width="4" height="4" fill="${primary}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function normalizeRecipeMapName(recipeMap: string): string {
  return recipeMap
    .trim()
    .toLowerCase()
    .replace(/\brecipes?\b/g, "")
    .replace(/\brecipe\s+map\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
