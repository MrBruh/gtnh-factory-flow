import type { FactoryNode, Recipe } from "./types";
import { resourceMatchesInput } from "./resources";

export function applyRecipeInputOverrides(
  recipe: Recipe,
  node: Pick<FactoryNode, "recipeInputOverrides">,
): Recipe {
  if (!node.recipeInputOverrides) {
    return recipe;
  }

  let changed = false;
  const inputs = recipe.inputs.map((input, index) => {
    const override = node.recipeInputOverrides?.[String(index)];
    if (!override) {
      return input;
    }
    changed = true;
    return {
      ...input,
      ...override,
      amount: override.amount ?? input.amount,
      optional: input.optional,
      consumed: input.consumed,
      neiSlot: input.neiSlot,
      alternatives: undefined,
    };
  });

  return changed ? { ...recipe, inputs } : recipe;
}

export function restoreCrossKindInputOverrideVisuals(
  displayRecipe: Recipe,
  baseRecipe: Recipe,
  node: Pick<FactoryNode, "recipeInputOverrides">,
): Recipe {
  if (!node.recipeInputOverrides) {
    return displayRecipe;
  }

  let changed = false;
  const inputs = displayRecipe.inputs.map((input, index) => {
    const override = node.recipeInputOverrides?.[String(index)];
    const baseInput = baseRecipe.inputs[index];
    if (
      !override ||
      !baseInput ||
      override.kind === baseInput.kind ||
      !resourceMatchesInput(override, baseInput)
    ) {
      return input;
    }

    changed = true;
    return {
      ...baseInput,
      amount: baseInput.amount,
      optional: input.optional,
      consumed: input.consumed,
      neiSlot: input.neiSlot,
    };
  });

  return changed ? { ...displayRecipe, inputs } : displayRecipe;
}
