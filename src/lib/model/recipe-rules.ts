import type {
  FactoryNode,
  MachineConfigControl,
  MachineConfigTierOption,
  MachineHandler,
  Recipe,
} from "./types";

export interface MachineConfigTierControl {
  id: string;
  label: string;
  minimum: MachineConfigTierOption;
  current: MachineConfigTierOption;
  tiers: MachineConfigTierOption[];
  resource: MachineConfigTierOption["resource"];
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
    durationTicks: handler.durationTicks ?? recipe.durationTicks,
    eut: handler.eut ?? recipe.eut,
    machineProfile: {
      ...recipe.machineProfile,
      machineType: handler.machineType,
      minimumTier: handler.minimumTier,
      durationTicks: handler.durationTicks ?? recipe.machineProfile?.durationTicks,
      eut: handler.eut ?? recipe.machineProfile?.eut,
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
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: { coilTier?: string },
) {
  const importedControl = findMachineConfigControl(recipe, "heatingCoil");
  return importedControl
    ? resolveMachineConfigTierControl(importedControl, node.coilTier)
    : undefined;
}

export function getRecipeMachineConfigTierControls(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: Pick<FactoryNode, "machineConfigTiers">,
): MachineConfigTierControl[] {
  const importedControls = recipe.machineConfigControls
    ?.filter((control) => control.id !== "heatingCoil")
    .map((control) =>
      resolveMachineConfigTierControl(control, node.machineConfigTiers?.[control.id]),
    )
    .filter((control): control is MachineConfigTierControl => Boolean(control));
  if (importedControls?.length) {
    return importedControls;
  }
  return [];
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

function findMachineConfigControl(
  recipe: Pick<Recipe, "machineConfigControls">,
  id: string,
): MachineConfigControl | undefined {
  return recipe.machineConfigControls?.find((control) => control.id === id);
}

function resolveMachineConfigTierControl(
  control: MachineConfigControl,
  selectedKey: string | undefined,
): MachineConfigTierControl | undefined {
  const minimum = control.tiers.find((tier) => tier.key === control.minimumKey) ?? control.tiers[0];
  if (!minimum) {
    return undefined;
  }

  const minimumIndex = control.tiers.findIndex((tier) => tier.key === minimum.key);
  const tiers = control.tiers.slice(Math.max(0, minimumIndex));
  const selected = tiers.find((tier) => tier.key === selectedKey);
  const defaultTier = tiers.find((tier) => tier.key === control.defaultKey);
  const current = selected ?? defaultTier ?? minimum;

  return {
    id: control.id,
    label: control.label,
    minimum,
    current,
    tiers,
    resource: current.resource,
  };
}

function recipeMapName(recipe: Pick<Recipe, "machineType" | "source">): string {
  return recipe.source?.recipeMap ?? recipe.machineType;
}

function slug(value: string): string {
  return normalizeRecipeMapName(value).replace(/[^a-z0-9]+/g, "-");
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
