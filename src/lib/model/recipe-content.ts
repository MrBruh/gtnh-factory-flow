import type { Recipe, RecipeInput, RecipeOutput } from "./types";

/**
 * The fields that identify a recipe by what it *does*, independently of its dataset id.
 *
 * Dataset recipe ids are not portable across dataset regenerations: the oracle exporter used to
 * hash the registry iteration index (and, for GregTech, an identity hash), so republishing the
 * very same GTNH version reshuffled every id. Exported plans embed `node.recipeId`, so such a plan
 * resolved nothing against the republished dataset. Content matching re-points those references,
 * and keeps working for every future regeneration regardless of how ids are produced.
 */
export type RecipeContentRef = Pick<Recipe, "durationTicks" | "eut" | "inputs" | "outputs"> &
  Partial<Pick<Recipe, "machineType" | "source">>;

/** A dataset recipe, reduced to what content matching needs. */
export type DatasetRecipeContentRef = Pick<Recipe, "id"> & RecipeContentRef;

/** `contentKey -> dataset recipe ids`, in the order the dataset yielded them. */
export type RecipeContentIndex = Map<string, string[]>;

function resourceContentKey(resource: RecipeInput | RecipeOutput): string {
  const chance = "chance" in resource && resource.chance != null ? `@${resource.chance}` : "";
  return `${resource.kind}:${resource.id}:${resource.amount}${chance}`;
}

function resourceMultisetKey(resources: Array<RecipeInput | RecipeOutput> | undefined): string {
  return (resources ?? []).map(resourceContentKey).sort().join("|");
}

/**
 * Stable fingerprint of a recipe's observable behaviour: where it runs, how long it takes, what it
 * costs, and the exact multisets it consumes and produces.
 *
 * Slot order is deliberately *not* part of the key. Normalizers are free to reorder slots between
 * dataset builds, and a plan that matches on behaviour should survive that; the amounts and chances
 * that the solver actually uses are all still compared. The flip side is that a match may carry a
 * different slot order than the plan recorded, so any caller that re-points a recipe id must also
 * repair slot-indexed references to it - see `remapMigratedRecipeReferences` in `TopBar`.
 */
export function recipeContentKey(recipe: RecipeContentRef): string {
  return [
    recipe.source?.recipeMap ?? recipe.machineType ?? "",
    recipe.durationTicks ?? 0,
    recipe.eut ?? 0,
    resourceMultisetKey(recipe.inputs),
    resourceMultisetKey(recipe.outputs),
  ].join("##");
}

export function buildRecipeContentIndex(
  recipes: Iterable<DatasetRecipeContentRef>,
): RecipeContentIndex {
  const index: RecipeContentIndex = new Map();

  for (const recipe of recipes) {
    const key = recipeContentKey(recipe);
    const ids = index.get(key);
    if (ids) {
      ids.push(recipe.id);
    } else {
      index.set(key, [recipe.id]);
    }
  }

  return index;
}
