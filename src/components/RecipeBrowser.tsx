"use client";

import { PlusCircle, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { mergeDatasetAndProjectRecipes } from "@/lib/datasets";
import { primaryOutput } from "@/lib/model";
import { useFactoryStore } from "@/store/factory-store";
import type { Recipe } from "@/lib/model/types";
import { NeiRecipeWindow } from "./nei/NeiRecipeWindow";

export function RecipeBrowser() {
  const dataset = useFactoryStore((state) => state.dataset);
  const projectRecipes = useFactoryStore((state) => state.project.recipes);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const selectedRecipeId = useFactoryStore((state) => state.selectedRecipeId);
  const setRecipeSearch = useFactoryStore((state) => state.setRecipeSearch);
  const selectRecipe = useFactoryStore((state) => state.selectRecipe);
  const addNodeForRecipe = useFactoryStore((state) => state.addNodeForRecipe);
  const datasetRecipes = dataset?.recipes;
  const [selectedRecipeMap, setSelectedRecipeMap] = useState("all");
  const deferredRecipeSearch = useDeferredValue(recipeSearch);

  const recipes = useMemo(
    () => mergeDatasetAndProjectRecipes(datasetRecipes ?? [], projectRecipes),
    [datasetRecipes, projectRecipes],
  );

  const recipeMaps = useMemo(() => {
    const maps = dataset?.recipeMaps?.length
      ? dataset.recipeMaps
      : [...new Set(recipes.map((recipe) => recipe.source?.recipeMap ?? recipe.machineType))];
    return ["all", ...maps.filter(Boolean).sort((a, b) => a.localeCompare(b))];
  }, [dataset, recipes]);

  const activeRecipeMap = recipeMaps.includes(selectedRecipeMap) ? selectedRecipeMap : "all";

  const filteredRecipes = useMemo(() => {
    const query = deferredRecipeSearch.trim().toLowerCase();
    const activeMap = activeRecipeMap === "all" ? undefined : activeRecipeMap;
    const resultsWithIcons: Array<{ recipe: Recipe; iconScore: number }> = [];
    const resultsWithoutIcons: Recipe[] = [];

    for (const recipe of recipes) {
      const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
      if (activeMap && recipeMap !== activeMap) {
        continue;
      }

      if (query && !recipeMatchesQuery(recipe, query)) {
        continue;
      }

      const iconScore = recipeIconScore(recipe);
      if (iconScore > 0) {
        resultsWithIcons.push({ recipe, iconScore });
      } else if (resultsWithoutIcons.length < 240) {
        resultsWithoutIcons.push(recipe);
      }

      if (resultsWithIcons.length >= 240) {
        break;
      }
    }

    return [
      ...resultsWithIcons
        .sort((left, right) => right.iconScore - left.iconScore)
        .map((entry) => entry.recipe),
      ...resultsWithoutIcons,
    ].slice(0, 240);
  }, [activeRecipeMap, deferredRecipeSearch, recipes]);

  return (
    <aside className="flex h-full min-h-[360px] flex-col border-r border-neutral-800 bg-[#25272c] text-neutral-100">
      <div className="border-b border-neutral-800 px-3 py-3">
        <h2 className="text-sm font-semibold text-neutral-50">NEI recipe browser</h2>
        <p className="mt-1 text-xs text-neutral-400">
          {dataset
            ? `${dataset.gtnhVersion} / ${dataset.recipes.length.toLocaleString()} recipes`
            : "Import a normalized NESQL/RecEx/NERD dataset"}
        </p>
        <label className="mt-3 flex h-9 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
          <Search className="h-4 w-4 text-neutral-500" />
          <input
            value={recipeSearch}
            onChange={(event) => setRecipeSearch(event.target.value)}
            placeholder="Search item, fluid, machine..."
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
        <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
          {recipeMaps.map((recipeMap) => (
            <button
              key={recipeMap}
              type="button"
              onClick={() => setSelectedRecipeMap(recipeMap)}
              title={recipeMap === "all" ? "All recipe maps" : recipeMap}
              className={[
                "h-8 shrink-0 rounded-[3px] border px-2 text-xs font-semibold",
                activeRecipeMap === recipeMap
                  ? "border-cyan-400 bg-cyan-400/15 text-cyan-100"
                  : "border-neutral-700 bg-[#1b1d21] text-neutral-300 hover:border-neutral-500",
              ].join(" ")}
            >
              {recipeMap === "all" ? "All" : recipeMap}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {recipes.length === 0 ? (
          <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
            The selected GTNH version is loaded automatically, but its real recipe export is not
            published yet. No manual recipe entry is available.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {filteredRecipes.map((recipe) => (
              <RecipeResultCard
                key={recipe.id}
                recipe={recipe}
                selected={selectedRecipeId === recipe.id}
                onSelect={() => selectRecipe(recipe.id)}
                onAdd={() => addNodeForRecipe(recipe.id)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function RecipeResultCard({
  recipe,
  selected,
  onSelect,
  onAdd,
}: {
  recipe: Recipe;
  selected: boolean;
  onSelect: () => void;
  onAdd: () => void;
}) {
  const primary = primaryOutput(recipe);

  return (
    <article
      onClick={onSelect}
      className={[
        "cursor-pointer rounded-[4px] border bg-[#303238] p-2 shadow-sm transition hover:border-neutral-500",
        selected ? "border-cyan-400 ring-1 ring-cyan-400" : "border-neutral-700",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-neutral-50">{recipe.name}</h3>
          <p className="mt-0.5 truncate text-xs text-neutral-400">
            {recipe.source?.recipeMap ?? recipe.machineType} | {recipe.durationTicks} ticks |{" "}
            {recipe.eut} EU/t
          </p>
        </div>
        <button
          type="button"
          title="Add recipe node"
          aria-label="Add recipe node"
          onClick={(event) => {
            event.stopPropagation();
            onAdd();
          }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-neutral-600 bg-[#1b1d21] text-neutral-200 hover:border-cyan-400 hover:text-cyan-100"
        >
          <PlusCircle className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 overflow-x-auto pb-1">
        <NeiRecipeWindow recipe={recipe} scale={2} compact className="mx-auto" />
      </div>
      {primary ? (
        <p className="mt-2 truncate text-[11px] text-neutral-400">
          Primary: {primary.displayName ?? primary.id}
        </p>
      ) : null}
    </article>
  );
}

function recipeMatchesQuery(recipe: Recipe, query: string): boolean {
  return [
    recipe.name,
    recipe.machineType,
    recipe.source?.recipeMap,
    recipe.source?.rawRecipeId,
    ...recipe.inputs.map((input) => input.displayName ?? input.id),
    ...recipe.outputs.map((output) => output.displayName ?? output.id),
  ]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(query));
}

function recipeIconScore(recipe: Recipe): number {
  return [...recipe.inputs, ...recipe.outputs].reduce(
    (score, resource) => score + (resource.iconPath ? 1 : 0),
    0,
  );
}
