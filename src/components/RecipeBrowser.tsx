"use client";

import { PlusCircle, Search } from "lucide-react";
import { useMemo } from "react";
import { mergeDatasetAndProjectRecipes } from "@/lib/datasets";
import { useFactoryStore } from "@/store/factory-store";

export function RecipeBrowser() {
  const dataset = useFactoryStore((state) => state.dataset);
  const projectRecipes = useFactoryStore((state) => state.project.recipes);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const selectedRecipeId = useFactoryStore((state) => state.selectedRecipeId);
  const setRecipeSearch = useFactoryStore((state) => state.setRecipeSearch);
  const selectRecipe = useFactoryStore((state) => state.selectRecipe);
  const addNodeForRecipe = useFactoryStore((state) => state.addNodeForRecipe);
  const datasetRecipes = dataset?.recipes;

  const recipes = useMemo(
    () => mergeDatasetAndProjectRecipes(datasetRecipes ?? [], projectRecipes),
    [datasetRecipes, projectRecipes],
  );

  const filteredRecipes = useMemo(() => {
    const query = recipeSearch.trim().toLowerCase();
    if (!query) {
      return recipes.slice(0, 250);
    }

    return recipes
      .filter((recipe) =>
        [
          recipe.name,
          recipe.machineType,
          recipe.source?.recipeMap,
          ...recipe.inputs.map((input) => input.displayName ?? input.id),
          ...recipe.outputs.map((output) => output.displayName ?? output.id),
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(query)),
      )
      .slice(0, 250);
  }, [recipeSearch, recipes]);

  return (
    <aside className="flex h-full min-h-[360px] flex-col bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-950">GTNH recipe dataset</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {dataset
            ? `${dataset.gtnhVersion} / ${dataset.recipes.length.toLocaleString()} recipes`
            : "Import a normalized NESQL/RecEx/NERD dataset"}
        </p>
        <label className="mt-3 flex h-9 items-center gap-2 rounded border border-neutral-300 bg-neutral-50 px-2 text-sm text-neutral-700">
          <Search className="h-4 w-4 text-neutral-500" />
          <input
            value={recipeSearch}
            onChange={(event) => setRecipeSearch(event.target.value)}
            placeholder="Search items, fluids, machines..."
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {recipes.length === 0 ? (
          <div className="rounded border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">
            The selected GTNH version is loaded automatically, but its real recipe export is not
            published yet. No manual recipe entry is available.
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRecipes.map((recipe) => {
              const selected = selectedRecipeId === recipe.id;
              return (
                <article
                  key={recipe.id}
                  onClick={() => selectRecipe(recipe.id)}
                  className={[
                    "cursor-pointer rounded border bg-white p-3 shadow-sm transition hover:border-neutral-500",
                    selected ? "border-neutral-900" : "border-neutral-200",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-neutral-950">
                        {recipe.name}
                      </h3>
                      <p className="mt-0.5 truncate text-xs text-neutral-500">
                        {recipe.machineType} | {recipe.durationTicks} ticks | {recipe.eut} EU/t
                      </p>
                    </div>
                    {recipe.source?.exporter ? (
                      <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-800">
                        {recipe.source.exporter}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
                    <span className="truncate">
                      {recipe.source?.recipeMap ?? recipe.machineType}
                    </span>
                    <button
                      type="button"
                      title="Add recipe node"
                      aria-label="Add recipe node"
                      onClick={(event) => {
                        event.stopPropagation();
                        addNodeForRecipe(recipe.id);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                    >
                      <PlusCircle className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
