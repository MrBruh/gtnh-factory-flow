"use client";

import { ArrowLeft, GitBranchPlus, PlusCircle, Search, X } from "lucide-react";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { mergeDatasetAndProjectRecipes } from "@/lib/datasets";
import type { DatasetResource } from "@/lib/datasets/types";
import { getResourceKey, primaryOutput, resourceLabel } from "@/lib/model";
import { useFactoryStore } from "@/store/factory-store";
import type { Recipe, ResourceAmount, ResourceKey } from "@/lib/model/types";
import { NeiRecipeWindow } from "./nei/NeiRecipeWindow";
import { ResourceIcon } from "./nei/ResourceIcon";

export function RecipeBrowser() {
  const dataset = useFactoryStore((state) => state.dataset);
  const projectRecipes = useFactoryStore((state) => state.project.recipes);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const browserResource = useFactoryStore((state) => state.recipeBrowserResource);
  const browserMode = useFactoryStore((state) => state.recipeBrowserMode);
  const selectedRecipeId = useFactoryStore((state) => state.selectedRecipeId);
  const setRecipeSearch = useFactoryStore((state) => state.setRecipeSearch);
  const browseResource = useFactoryStore((state) => state.browseResource);
  const clearResourceBrowser = useFactoryStore((state) => state.clearResourceBrowser);
  const selectRecipe = useFactoryStore((state) => state.selectRecipe);
  const addNodeForRecipe = useFactoryStore((state) => state.addNodeForRecipe);
  const addConnectedNodeForRecipe = useFactoryStore((state) => state.addConnectedNodeForRecipe);
  const datasetRecipes = dataset?.recipes;
  const [selectedRecipeMap, setSelectedRecipeMap] = useState("all");
  const deferredRecipeSearch = useDeferredValue(recipeSearch);

  const recipes = useMemo(
    () => mergeDatasetAndProjectRecipes(datasetRecipes ?? [], projectRecipes),
    [datasetRecipes, projectRecipes],
  );

  const resourceIndex = useMemo(() => buildResourceIndex(recipes), [recipes]);
  const activeResource = useMemo(() => {
    if (!browserResource) {
      return undefined;
    }

    const indexed = resourceIndex.get(
      `${browserResource.kind}:${browserResource.id}` as ResourceKey,
    );

    return {
      ...(indexed ?? { ...browserResource, recipeCount: 0 }),
      anchorNodeId: browserResource.anchorNodeId,
    };
  }, [browserResource, resourceIndex]);

  const resourceResults = useMemo(() => {
    if (activeResource) {
      return [];
    }

    const query = deferredRecipeSearch.trim().toLowerCase();
    if (!query) {
      return [...resourceIndex.values()]
        .filter((resource) => resource.iconPath)
        .sort((left, right) => right.recipeCount - left.recipeCount)
        .slice(0, 72);
    }

    return [...resourceIndex.values()]
      .filter((resource) => resourceMatchesQuery(resource, query))
      .sort((left, right) => {
        const leftLabel = resourceLabel(left).toLowerCase();
        const rightLabel = resourceLabel(right).toLowerCase();
        const leftExact = leftLabel === query || left.id.toLowerCase() === query ? 1 : 0;
        const rightExact = rightLabel === query || right.id.toLowerCase() === query ? 1 : 0;
        return rightExact - leftExact || right.recipeCount - left.recipeCount;
      })
      .slice(0, 96);
  }, [activeResource, deferredRecipeSearch, resourceIndex]);

  const scopedRecipes = useMemo(() => {
    if (!activeResource) {
      return recipes;
    }

    return recipes.filter((recipe) => recipeHasResource(recipe, activeResource, browserMode));
  }, [activeResource, browserMode, recipes]);

  const recipeMaps = useMemo(() => {
    const maps = dataset?.recipeMaps?.length
      ? dataset.recipeMaps.filter((map) =>
          scopedRecipes.some((recipe) => (recipe.source?.recipeMap ?? recipe.machineType) === map),
        )
      : [...new Set(scopedRecipes.map((recipe) => recipe.source?.recipeMap ?? recipe.machineType))];
    return maps.filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [dataset, scopedRecipes]);

  const recipeMapTabs = useMemo(
    () => buildRecipeMapTabs(recipeMaps, dataset?.resources ?? []),
    [dataset?.resources, recipeMaps],
  );

  const activeRecipeMap = recipeMaps.includes(selectedRecipeMap)
    ? selectedRecipeMap
    : (recipeMaps[0] ?? "");

  const filteredRecipes = useMemo(() => {
    const query = deferredRecipeSearch.trim().toLowerCase();
    const activeMap = activeRecipeMap || undefined;
    const resultsWithIcons: Array<{ recipe: Recipe; iconScore: number }> = [];
    const resultsWithoutIcons: Recipe[] = [];

    for (const recipe of scopedRecipes) {
      const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
      if (activeMap && recipeMap !== activeMap) {
        continue;
      }

      if (!activeResource && query && !recipeMatchesQuery(recipe, query)) {
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
  }, [activeRecipeMap, activeResource, deferredRecipeSearch, scopedRecipes]);

  const setMode = (mode: "recipes" | "uses") => {
    if (!activeResource) {
      return;
    }

    browseResource(activeResource, mode);
    setSelectedRecipeMap("all");
  };

  return (
    <>
      <aside className="flex h-full min-h-[360px] flex-col border-r border-neutral-800 bg-[#25272c] text-neutral-100">
        <div className="border-b border-neutral-800 px-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-neutral-50">NEI recipe browser</h2>
              <p className="mt-1 text-xs text-neutral-400">
                {dataset
                  ? `${dataset.gtnhVersion} / ${dataset.recipes.length.toLocaleString()} recipes`
                  : "Import a normalized NESQL/RecEx/NERD dataset"}
              </p>
            </div>
            {activeResource ? (
              <button
                type="button"
                onClick={clearResourceBrowser}
                title="Back to resource search"
                aria-label="Back to resource search"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-neutral-700 bg-[#1b1d21] text-neutral-200 hover:border-cyan-400"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <label className="mt-3 flex h-9 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
            <Search className="h-4 w-4 text-neutral-500" />
            <input
              value={recipeSearch}
              onChange={(event) => setRecipeSearch(event.target.value)}
              placeholder="Search item or fluid..."
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
            {recipeSearch ? (
              <button
                type="button"
                onClick={() => setRecipeSearch("")}
                title="Clear search"
                aria-label="Clear search"
                className="text-neutral-500 hover:text-neutral-200"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>

          {activeResource ? (
            <div className="mt-3 flex items-center gap-2 rounded-[4px] border border-cyan-500 bg-[#303238] p-2">
              <ResourceIcon
                resource={{ ...activeResource, amount: 1 }}
                size="sm"
                showAmount={false}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-neutral-50">
                  {resourceLabel(activeResource)}
                </div>
                <div className="truncate text-[11px] text-neutral-400">
                  {browserMode === "recipes" ? "Recipes" : "Uses"} / {filteredRecipes.length} shown
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {recipes.length === 0 ? (
            <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
              The selected GTNH version is loaded automatically, but its real recipe export is not
              published yet. No manual recipe entry is available.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {(activeResource
                ? [...resourceIndex.values()]
                    .filter((resource) =>
                      resourceMatchesQuery(resource, deferredRecipeSearch.trim().toLowerCase()),
                    )
                    .slice(0, 96)
                : resourceResults
              ).map((resource) => (
                <ResourceResult
                  key={`${resource.kind}:${resource.id}`}
                  resource={resource}
                  active={
                    activeResource?.kind === resource.kind && activeResource.id === resource.id
                  }
                  onRecipes={() => browseResource(resource, "recipes")}
                  onUses={() => browseResource(resource, "uses")}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      {activeResource ? (
        <RecipeBookOverlay
          activeRecipeMap={activeRecipeMap}
          activeResource={activeResource}
          browserMode={browserMode}
          filteredRecipes={filteredRecipes}
          recipeMapTabs={recipeMapTabs}
          selectedRecipeId={selectedRecipeId}
          onAdd={addNodeForRecipe}
          onAddConnected={
            activeResource.anchorNodeId
              ? (recipeId) =>
                  addConnectedNodeForRecipe(recipeId, activeResource.anchorNodeId!, {
                    kind: activeResource.kind,
                    id: activeResource.id,
                    displayName: activeResource.displayName,
                    mode: browserMode,
                  })
              : undefined
          }
          onClose={clearResourceBrowser}
          onModeChange={setMode}
          onRecipeMapChange={setSelectedRecipeMap}
          onSelectRecipe={selectRecipe}
        />
      ) : null}
    </>
  );
}

interface IndexedResource extends Pick<ResourceAmount, "kind" | "id" | "displayName" | "iconPath"> {
  recipeCount: number;
}

interface RecipeMapTab {
  id: string;
  label: string;
  icon?: Pick<ResourceAmount, "kind" | "id" | "amount" | "displayName" | "iconPath">;
}

function ResourceResult({
  resource,
  active,
  onRecipes,
  onUses,
}: {
  resource: IndexedResource;
  active?: boolean;
  onRecipes: () => void;
  onUses: () => void;
}) {
  return (
    <article
      className={[
        "flex items-center gap-2 rounded-[4px] border bg-[#303238] p-2",
        active ? "border-cyan-400 ring-1 ring-cyan-400" : "border-neutral-700",
      ].join(" ")}
    >
      <ResourceIcon resource={{ ...resource, amount: 1 }} size="sm" showAmount={false} />
      <button type="button" onClick={onRecipes} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-semibold text-neutral-50">
          {resourceLabel(resource)}
        </div>
        <div className="truncate text-[11px] text-neutral-400">
          {resource.kind} / {resource.recipeCount} linked recipes
        </div>
      </button>
      <button
        type="button"
        onClick={onRecipes}
        className="h-8 rounded-[3px] border border-neutral-700 bg-[#1b1d21] px-2 text-xs font-semibold text-neutral-200 hover:border-cyan-400"
      >
        R
      </button>
      <button
        type="button"
        onClick={onUses}
        className="h-8 rounded-[3px] border border-neutral-700 bg-[#1b1d21] px-2 text-xs font-semibold text-neutral-200 hover:border-cyan-400"
      >
        U
      </button>
    </article>
  );
}

function RecipeMapTabBar({
  activeRecipeMap,
  tabs,
  onRecipeMapChange,
}: {
  activeRecipeMap: string;
  tabs: RecipeMapTab[];
  onRecipeMapChange: (recipeMap: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollTabs = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * 184, behavior: "smooth" });
  };

  return (
    <div className="absolute left-1 right-1 top-0 grid h-[42px] grid-cols-[24px_minmax(0,1fr)_24px] items-start">
      <NeiTabArrow direction="left" onClick={() => scrollTabs(-1)} />
      <div
        ref={scrollRef}
        className="nei-tab-strip flex h-[42px] gap-1 overflow-x-auto overflow-y-hidden px-1"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onRecipeMapChange(tab.id)}
            title={tab.label}
            aria-label={tab.label}
            className={neiTabClass(activeRecipeMap === tab.id)}
          >
            {tab.icon ? (
              <ResourceIcon resource={tab.icon} size="sm" showAmount={false} bare />
            ) : (
              <span className="text-[12px] font-bold leading-none text-white [text-shadow:1px_1px_0_#000]">
                ?
              </span>
            )}
          </button>
        ))}
      </div>
      <NeiTabArrow direction="right" onClick={() => scrollTabs(1)} />
    </div>
  );
}

function NeiTabArrow({ direction, onClick }: { direction: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={direction === "left" ? "Previous recipe maps" : "Next recipe maps"}
      aria-label={direction === "left" ? "Previous recipe maps" : "Next recipe maps"}
      className="mt-1 h-9 w-6 border-2 border-[#252525] bg-[#7d7d7d] text-[18px] leading-5 text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] [text-shadow:1px_1px_0_#000] hover:bg-[#9b9b9b]"
    >
      {direction === "left" ? "<" : ">"}
    </button>
  );
}

function RecipeBookOverlay({
  activeRecipeMap,
  activeResource,
  browserMode,
  filteredRecipes,
  recipeMapTabs,
  selectedRecipeId,
  onAdd,
  onAddConnected,
  onClose,
  onModeChange,
  onRecipeMapChange,
  onSelectRecipe,
}: {
  activeRecipeMap: string;
  activeResource: IndexedResource & { anchorNodeId?: string };
  browserMode: "recipes" | "uses";
  filteredRecipes: Recipe[];
  recipeMapTabs: RecipeMapTab[];
  selectedRecipeId?: string;
  onAdd: (recipeId: string) => void;
  onAddConnected?: (recipeId: string) => void;
  onClose: () => void;
  onModeChange: (mode: "recipes" | "uses") => void;
  onRecipeMapChange: (recipeMap: string) => void;
  onSelectRecipe: (recipeId: string) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    setDragOffset(
      clampDragOffset(
        {
          x: drag.originX + event.clientX - drag.startX,
          y: drag.originY + event.clientY - drag.startY,
        },
        panelRef.current,
      ),
    );
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center px-3 py-4 lg:left-[360px] lg:right-[440px]">
      <section
        ref={panelRef}
        className="pointer-events-auto relative flex h-[min(760px,calc(100vh-32px))] w-full max-w-[620px] flex-col pt-[42px] font-mono"
        aria-label="Recipe book"
        style={{
          transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        }}
      >
        <RecipeMapTabBar
          activeRecipeMap={activeRecipeMap}
          tabs={recipeMapTabs}
          onRecipeMapChange={onRecipeMapChange}
        />

        <div className="flex min-h-0 flex-1 flex-col border-2 border-[#f4f4f4] bg-[#c6c6c6] text-[#202020] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555]">
          <div className="grid grid-cols-[36px_minmax(0,1fr)_36px] items-center px-2 pt-2">
            <button
              type="button"
              onClick={() => onModeChange("recipes")}
              className={bookModeButtonClass(browserMode === "recipes")}
              title="Recipes"
            >
              R
            </button>
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="h-8 cursor-move select-none truncate border-2 border-[#555] bg-[#9b9b9b] px-2 text-center text-[18px] leading-[26px] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a] [text-shadow:2px_2px_0_#3f3f3f]"
            >
              {resourceLabel(activeResource)}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-8 border-2 border-[#252525] bg-[#7d7d7d] text-[18px] leading-5 text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] [text-shadow:1px_1px_0_#000]"
              title="Close"
              aria-label="Close recipe book"
            >
              x
            </button>
          </div>

          <div className="grid grid-cols-[36px_minmax(0,1fr)_36px] items-center px-2">
            <button
              type="button"
              onClick={() => onModeChange("uses")}
              className={bookModeButtonClass(browserMode === "uses")}
              title="Uses"
            >
              U
            </button>
            <div className="h-8 truncate border-x-2 border-b-2 border-[#555] bg-[#a7a7a7] px-2 text-center text-[18px] leading-[26px] text-white shadow-[inset_2px_0_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a] [text-shadow:2px_2px_0_#3f3f3f]">
              {browserMode === "recipes" ? "Recipes" : "Uses"} / {filteredRecipes.length}
            </div>
            <div className="h-8 border-x-2 border-b-2 border-[#252525] bg-[#5d5d5d] shadow-[inset_2px_0_0_#9f9f9f,inset_-2px_-2px_0_#303030]" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {filteredRecipes.length === 0 ? (
              <div className="border-2 border-[#777] bg-[#b6b6b6] p-3 text-sm shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]">
                No matching recipes.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {filteredRecipes.map((recipe) => (
                  <RecipeResultCard
                    key={recipe.id}
                    recipe={recipe}
                    selected={selectedRecipeId === recipe.id}
                    onSelect={() => onSelectRecipe(recipe.id)}
                    onAdd={() => onAdd(recipe.id)}
                    onAddConnected={onAddConnected ? () => onAddConnected(recipe.id) : undefined}
                    minimal
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function RecipeResultCard({
  recipe,
  selected,
  onSelect,
  onAdd,
  onAddConnected,
  minimal = false,
}: {
  recipe: Recipe;
  selected: boolean;
  onSelect: () => void;
  onAdd: () => void;
  onAddConnected?: () => void;
  minimal?: boolean;
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
      <div className="flex items-start justify-end gap-2">
        {!minimal ? (
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-neutral-50">{recipe.name}</h3>
            <p className="mt-0.5 truncate text-xs text-neutral-400">
              {recipe.source?.recipeMap ?? recipe.machineType} | {recipe.durationTicks} ticks |{" "}
              {recipe.eut} EU/t
            </p>
          </div>
        ) : null}
        <button
          type="button"
          title={onAddConnected ? "Add and connect recipe node" : "Add recipe node"}
          aria-label={onAddConnected ? "Add and connect recipe node" : "Add recipe node"}
          onClick={(event) => {
            event.stopPropagation();
            if (onAddConnected) {
              onAddConnected();
            } else {
              onAdd();
            }
          }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-neutral-600 bg-[#1b1d21] text-neutral-200 hover:border-cyan-400 hover:text-cyan-100"
        >
          {onAddConnected ? (
            <GitBranchPlus className="h-4 w-4" />
          ) : (
            <PlusCircle className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="mt-2 overflow-x-auto pb-1">
        <NeiRecipeWindow recipe={recipe} scale={2} compact className="mx-auto" />
      </div>
      {!minimal && primary ? (
        <p className="mt-2 truncate text-[11px] text-neutral-400">
          Primary: {primary.displayName ?? primary.id}
        </p>
      ) : null}
    </article>
  );
}

function clampDragOffset(offset: { x: number; y: number }, panel: HTMLElement | null) {
  if (!panel || typeof window === "undefined") {
    return offset;
  }

  const rect = panel.getBoundingClientRect();
  const margin = 12;
  const maxX = Math.max(0, (window.innerWidth - rect.width) / 2 - margin);
  const maxY = Math.max(0, (window.innerHeight - rect.height) / 2 - margin);

  return {
    x: clamp(offset.x, -maxX, maxX),
    y: clamp(offset.y, -maxY, maxY),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildResourceIndex(recipes: Recipe[]): Map<ResourceKey, IndexedResource> {
  const index = new Map<ResourceKey, IndexedResource>();

  for (const recipe of recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) {
      const key = getResourceKey(resource);
      const existing = index.get(key);
      if (existing) {
        existing.recipeCount += 1;
        if (!existing.iconPath && resource.iconPath) {
          existing.iconPath = resource.iconPath;
        }
        if (!existing.displayName && resource.displayName) {
          existing.displayName = resource.displayName;
        }
      } else {
        index.set(key, {
          kind: resource.kind,
          id: resource.id,
          displayName: resource.displayName,
          iconPath: resource.iconPath,
          recipeCount: 1,
        });
      }
    }
  }

  return index;
}

function resourceMatchesQuery(resource: IndexedResource, query: string): boolean {
  return [resource.displayName, resource.id, resource.kind]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(query));
}

function recipeHasResource(
  recipe: Recipe,
  resource: Pick<ResourceAmount, "kind" | "id">,
  mode: "recipes" | "uses",
): boolean {
  const resources = mode === "recipes" ? recipe.outputs : recipe.inputs;
  return resources.some((entry) => entry.kind === resource.kind && entry.id === resource.id);
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

function buildRecipeMapTabs(recipeMaps: string[], resources: DatasetResource[]): RecipeMapTab[] {
  return recipeMaps.map((recipeMap) => {
    const resource = findRecipeMapIcon(recipeMap, resources);
    return {
      id: recipeMap,
      label: recipeMap,
      icon: resource
        ? {
            kind: resource.kind,
            id: resource.id,
            amount: 1,
            displayName: resource.displayName,
            iconPath: resource.iconPath,
          }
        : undefined,
    };
  });
}

function findRecipeMapIcon(
  recipeMap: string,
  resources: DatasetResource[],
): DatasetResource | undefined {
  const recipeMapTokens = tokenizeRecipeMap(recipeMap);
  const normalizedMap = normalizeText(recipeMap);
  let best: { resource: DatasetResource; score: number } | undefined;

  for (const resource of resources) {
    if (resource.kind !== "item" || !resource.iconPath) {
      continue;
    }

    const label = normalizeText(resource.displayName);
    const tokens = new Set(label.split(" ").filter(Boolean));
    let score = 0;

    if (label === normalizedMap) {
      score += 120;
    } else if (label.includes(normalizedMap)) {
      score += 80;
    }

    for (const token of recipeMapTokens) {
      if (tokens.has(token) || label.includes(token)) {
        score += 14;
      }
    }

    if (resource.id.startsWith("gregtech:gt.blockmachines@")) {
      score += 35;
    }
    if (/^(basic|steam|simple|large) /.test(label)) {
      score += 12;
    }
    if (/\b(pipe|cover|upgrade|part|component)\b/.test(label)) {
      score -= 30;
    }

    if (score > (best?.score ?? 0)) {
      best = { resource, score };
    }
  }

  return best && best.score >= 35 ? best.resource : undefined;
}

function tokenizeRecipeMap(value: string): string[] {
  const aliases: Record<string, string[]> = {
    washer: ["washing", "wash"],
    wash: ["washing", "washer"],
    extractor: ["extractor", "extract"],
  };

  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2)
    .flatMap((token) => [token, ...(aliases[token] ?? [])]);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function neiTabClass(active: boolean): string {
  return [
    "flex h-10 w-10 shrink-0 items-center justify-center border-2 p-0 shadow-[inset_2px_2px_0_rgba(255,255,255,0.35),inset_-2px_-2px_0_rgba(0,0,0,0.45)]",
    active ? "border-[#f4f4f4] bg-[#c6c6c6]" : "border-[#252525] bg-[#7d7d7d] hover:bg-[#9b9b9b]",
  ].join(" ");
}

function bookModeButtonClass(active: boolean): string {
  return [
    "h-8 border-2 border-[#252525] text-[16px] font-bold leading-5 text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] [text-shadow:1px_1px_0_#000]",
    active ? "bg-[#00758a]" : "bg-[#5d5d5d]",
  ].join(" ");
}
