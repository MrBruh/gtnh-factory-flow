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

/**
 * Move a node's slot-indexed input overrides onto a migrated recipe's slots.
 *
 * Overrides carry the user's concrete oredict picks - the Spruce Log chosen for a `logWood` slot -
 * and are keyed by input index. A plan whose recipe id moved between dataset builds is re-pointed
 * by content, and content matching deliberately ignores slot order, so the recipe it lands on may
 * list the same inputs in a different order. Leaving an override on its old index would silently
 * reseat that pick on another slot - the "Spruce Log must not become Oak Log" case.
 *
 * The old index wins whenever it still fits, so an unchanged slot order is left exactly as it was.
 * An override with no compatible slot in the new recipe is dropped rather than placed on a guess:
 * the slot falls back to the recipe's own input instead of showing an item that is not in it.
 */
export function remapMigratedRecipeInputOverrides(
  overrides: NonNullable<FactoryNode["recipeInputOverrides"]>,
  previousRecipe: Recipe,
  nextRecipe: Recipe,
): FactoryNode["recipeInputOverrides"] {
  const remapped: NonNullable<FactoryNode["recipeInputOverrides"]> = {};
  const claimed = new Set<number>();

  // Ascending slot order, so a same-order recipe reseats each override on its own index.
  const entries = Object.entries(overrides).sort(([left], [right]) => Number(left) - Number(right));

  for (const [rawIndex, override] of entries) {
    const previousIndex = Number(rawIndex);
    const previousInput = previousRecipe.inputs[previousIndex];
    if (!previousInput) {
      continue;
    }

    const fits = (index: number) => {
      const input = nextRecipe.inputs[index];
      return Boolean(
        input &&
        !claimed.has(index) &&
        input.kind === previousInput.kind &&
        input.id === previousInput.id &&
        input.amount === previousInput.amount &&
        resourceMatchesInput(override, input),
      );
    };

    const nextIndex = fits(previousIndex)
      ? previousIndex
      : nextRecipe.inputs.findIndex((_, index) => fits(index));
    if (nextIndex === -1) {
      continue;
    }

    claimed.add(nextIndex);
    remapped[String(nextIndex)] = override;
  }

  return Object.keys(remapped).length > 0 ? remapped : undefined;
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
