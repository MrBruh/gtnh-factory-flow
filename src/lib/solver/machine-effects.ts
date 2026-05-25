import {
  getRecipeCoilTierControl,
  getRecipeMachineConfigTierControls,
} from "@/lib/model/recipe-rules";
import { getVoltageTierIndex } from "@/lib/model/tiers";
import type { FactoryNode, MachineTier, Recipe, RecipeOutput } from "@/lib/model/types";

type VoltageTier = Exclude<MachineTier, "DEMO">;

const TGS_BASE_OUTPUT_MULTIPLIER = 5;

export function getMachineOutputMultiplier(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: Pick<FactoryNode, "machineConfigTiers">,
  output: RecipeOutput,
  tier: VoltageTier,
): number {
  if (!isTreeGrowthSimulatorRecipe(recipe)) {
    return 1;
  }

  const tierOrdinal = getVoltageTierIndex(tier) + 1;
  const tierMultiplier = (2 * tierOrdinal ** 2 - 2 * tierOrdinal + 5) / TGS_BASE_OUTPUT_MULTIPLIER;
  const toolMultiplier = getTreeGrowthSimulatorToolMultiplier(recipe, node, output);
  return tierMultiplier * toolMultiplier;
}

export function applyMachineOutputMultipliers(
  recipe: Recipe,
  node: Pick<FactoryNode, "machineConfigTiers">,
  tier: VoltageTier,
): Recipe {
  const outputs = recipe.outputs.map((output) => {
    const multiplier = getMachineOutputMultiplier(recipe, node, output, tier);
    return multiplier === 1 ? output : { ...output, amount: output.amount * multiplier };
  });

  return outputs.some((output, index) => output !== recipe.outputs[index])
    ? { ...recipe, outputs }
    : recipe;
}

function getTreeGrowthSimulatorToolMultiplier(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: Pick<FactoryNode, "machineConfigTiers">,
  output: RecipeOutput,
) {
  const category = getTreeGrowthSimulatorOutputCategory(output);
  if (!category) {
    return 1;
  }

  const normalizedCategory = category.toLowerCase();
  const controls = getRecipeMachineConfigTierControls(recipe, node);
  const slotControl = controls
    .filter((entry) => /^tgsToolSlot\d+$/.test(entry.id))
    .find((entry) => getTreeGrowthSimulatorToolCategory(entry.current.key) === normalizedCategory);
  const categoryControl = controls.find((entry) => entry.id === `tgs${category}Tool`);

  return slotControl?.current.outputMultiplier ?? categoryControl?.current.outputMultiplier ?? 1;
}

export function getMachineParallelMultiplier(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: Pick<FactoryNode, "machineConfigTiers">,
): number {
  return getRecipeMachineConfigTierControls(recipe, node).reduce(
    (multiplier, control) => multiplier * (control.current.parallelMultiplier ?? 1),
    1,
  );
}

export function getMachineDurationMultiplier(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: Pick<FactoryNode, "coilTier" | "machineConfigTiers">,
): number {
  const coilControl = getRecipeCoilTierControl(recipe, node);
  const coilMultiplier = coilControl?.current.durationMultiplier ?? 1;
  const configMultiplier = getRecipeMachineConfigTierControls(recipe, node).reduce(
    (multiplier, control) => multiplier * (control.current.durationMultiplier ?? 1),
    1,
  );
  return coilMultiplier * configMultiplier;
}

export function getMachineEutMultiplier(
  recipe: Pick<Recipe, "machineType" | "source" | "nei" | "machineConfigControls">,
  node: Pick<FactoryNode, "coilTier" | "machineConfigTiers">,
): number {
  const coilControl = getRecipeCoilTierControl(recipe, node);
  const coilMultiplier = coilControl?.current.eutMultiplier ?? 1;
  const configMultiplier = getRecipeMachineConfigTierControls(recipe, node).reduce(
    (multiplier, control) => multiplier * (control.current.eutMultiplier ?? 1),
    1,
  );
  return coilMultiplier * configMultiplier;
}

function getTreeGrowthSimulatorOutputCategory(output: RecipeOutput) {
  const slot = output.neiSlot;
  if (slot?.x === 108 && slot.y === 36) {
    return "Log";
  }
  if (slot?.x === 126 && slot.y === 36) {
    return "Sapling";
  }
  if (slot?.x === 108 && slot.y === 54) {
    return "Leaves";
  }
  if (slot?.x === 126 && slot.y === 54) {
    return "Fruit";
  }

  const label = `${output.displayName ?? ""} ${output.id}`.toLowerCase();
  if (label.includes("sapling")) {
    return "Sapling";
  }
  if (label.includes("leaves") || label.includes("leaf")) {
    return "Leaves";
  }
  if (label.includes("log") || label.includes("wood")) {
    return "Log";
  }
  return "Fruit";
}

function getTreeGrowthSimulatorToolCategory(key: string): string | undefined {
  const [category] = key.split(":");
  return category && category !== "none" ? category : undefined;
}

function isTreeGrowthSimulatorRecipe(recipe: Pick<Recipe, "machineType" | "source">): boolean {
  const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
  return normalizeRecipeMapName(recipeMap) === "tree growth simulator";
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
