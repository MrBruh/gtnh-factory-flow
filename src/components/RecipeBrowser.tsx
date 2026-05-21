"use client";

import { Archive, GitBranchPlus, Plus, Search, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import { queryRecipeDatasetRecipes } from "@/lib/datasets/browser-loader";
import type { DatasetResource, DatasetResourceIndexEntry } from "@/lib/datasets/types";
import { getResourceKey, GT_VOLTAGE_TIERS, primaryOutput, resourceLabel } from "@/lib/model";
import type { MachineTier } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import type { Recipe, ResourceAmount, ResourceKey } from "@/lib/model/types";
import { MinecraftTooltip } from "./nei/MinecraftTooltip";
import { NeiRecipeWindow } from "./nei/NeiRecipeWindow";
import { ResourceIcon } from "./nei/ResourceIcon";

export function RecipeBrowser() {
  const dataset = useFactoryStore((state) => state.dataset);
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isDatasetLoading = useFactoryStore((state) => state.isDatasetLoading);
  const projectRecipes = useFactoryStore((state) => state.project.recipes);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const browserResource = useFactoryStore((state) => state.recipeBrowserResource);
  const browserMode = useFactoryStore((state) => state.recipeBrowserMode);
  const resourceHistory = useFactoryStore((state) => state.recipeResourceHistory);
  const selectedRecipeId = useFactoryStore((state) => state.selectedRecipeId);
  const setRecipeSearch = useFactoryStore((state) => state.setRecipeSearch);
  const browseResource = useFactoryStore((state) => state.browseResource);
  const clearResourceBrowser = useFactoryStore((state) => state.clearResourceBrowser);
  const selectRecipe = useFactoryStore((state) => state.selectRecipe);
  const addNodeForRecipe = useFactoryStore((state) => state.addNodeForRecipeObject);
  const addConnectedNodeForRecipe = useFactoryStore(
    (state) => state.addConnectedNodeForRecipeObject,
  );
  const addResourceStorage = useFactoryStore((state) => state.addResourceStorage);
  const [selectedRecipeMap, setSelectedRecipeMap] = useState("all");
  const [maxTier, setMaxTier] = useState<TierFilter>("all");
  const [filteredRecipes, setFilteredRecipes] = useState<Recipe[]>([]);
  const [queryTotal, setQueryTotal] = useState(0);
  const [availableRecipeMaps, setAvailableRecipeMaps] = useState<string[]>([]);
  const [recipeQueryLoading, setRecipeQueryLoading] = useState(false);
  const [recipeQueryError, setRecipeQueryError] = useState<string | undefined>();
  const recipeQueryCacheRef = useRef<Map<string, RecipeQueryCacheEntry>>(new Map());
  const deferredRecipeSearch = useDeferredValue(recipeSearch);

  const resourceIndex = useMemo(
    () => buildResourceIndex(dataset?.resourceIndex, dataset?.recipes ?? [], projectRecipes),
    [dataset?.resourceIndex, dataset?.recipes, projectRecipes],
  );
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

  const historyResources = useMemo(
    () =>
      resourceHistory.map((resource) => {
        const indexed = resourceIndex.get(`${resource.kind}:${resource.id}` as ResourceKey);
        return indexed ?? resource;
      }),
    [resourceHistory, resourceIndex],
  );

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

  const recipeMaps = useMemo(
    () => availableRecipeMaps.filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [availableRecipeMaps],
  );

  const recipeMapTabs = useMemo(
    () => buildRecipeMapTabs(recipeMaps, dataset?.resources ?? []),
    [dataset?.resources, recipeMaps],
  );

  const activeRecipeMap = recipeMaps.includes(selectedRecipeMap)
    ? selectedRecipeMap
    : (recipeMaps[0] ?? "");

  const selectedDatasetVersion = useMemo(
    () => datasetManifest?.versions.find((entry) => entry.id === selectedDatasetVersionId),
    [datasetManifest?.versions, selectedDatasetVersionId],
  );

  const getRecipeQueryKey = useCallback(
    (recipeMap: string) =>
      selectedDatasetVersion
        ? getRecipeQueryCacheKey({
            versionId: selectedDatasetVersion.id,
            query: deferredRecipeSearch.trim(),
            resource: activeResource,
            mode: browserMode,
            recipeMap,
            maxTier,
          })
        : "",
    [activeResource, browserMode, deferredRecipeSearch, maxTier, selectedDatasetVersion],
  );

  const prefetchRecipeMap = useCallback(
    (recipeMap: string) => {
      if (!selectedDatasetVersion) {
        return;
      }

      const query = deferredRecipeSearch.trim();
      if (!activeResource && query.length < 2) {
        return;
      }

      const cacheKey = getRecipeQueryKey(recipeMap);
      if (!cacheKey || recipeQueryCacheRef.current.has(cacheKey)) {
        return;
      }

      void queryRecipeDatasetRecipes(
        datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
        selectedDatasetVersion,
        {
          query,
          resource: activeResource
            ? {
                kind: activeResource.kind,
                id: activeResource.id,
              }
            : undefined,
          mode: browserMode,
          recipeMap: recipeMap || undefined,
          maxTier,
          limit: 240,
        },
      ).then((result) => {
        recipeQueryCacheRef.current.set(cacheKey, result);
        trimRecipeQueryCache(recipeQueryCacheRef.current);
      });
    },
    [
      activeResource,
      browserMode,
      datasetManifestUrl,
      deferredRecipeSearch,
      getRecipeQueryKey,
      maxTier,
      selectedDatasetVersion,
    ],
  );

  useEffect(() => {
    if (!selectedDatasetVersion) {
      const timeout = window.setTimeout(() => {
        setFilteredRecipes([]);
        setQueryTotal(0);
        setAvailableRecipeMaps([]);
      }, 0);
      return () => window.clearTimeout(timeout);
    }

    const query = deferredRecipeSearch.trim();
    if (!activeResource && query.length < 2) {
      const timeout = window.setTimeout(() => {
        setFilteredRecipes([]);
        setQueryTotal(0);
        setAvailableRecipeMaps([]);
        setRecipeQueryLoading(false);
        setRecipeQueryError(undefined);
      }, 0);
      return () => window.clearTimeout(timeout);
    }

    const cacheKey = getRecipeQueryKey(activeRecipeMap);
    const cached = recipeQueryCacheRef.current.get(cacheKey);
    if (cached) {
      const timeout = window.setTimeout(() => {
        setFilteredRecipes(cached.recipes);
        setQueryTotal(cached.total);
        setAvailableRecipeMaps(cached.recipeMaps);
        setRecipeQueryLoading(false);
        setRecipeQueryError(undefined);
      }, 0);
      return () => window.clearTimeout(timeout);
    }

    let cancelled = false;
    window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      setRecipeQueryLoading(true);
      setRecipeQueryError(undefined);
    }, 0);

    queryRecipeDatasetRecipes(
      datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
      selectedDatasetVersion,
      {
        query,
        resource: activeResource
          ? {
              kind: activeResource.kind,
              id: activeResource.id,
            }
          : undefined,
        mode: browserMode,
        recipeMap: activeRecipeMap || undefined,
        maxTier,
        limit: 240,
      },
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        recipeQueryCacheRef.current.set(cacheKey, result);
        trimRecipeQueryCache(recipeQueryCacheRef.current);
        setFilteredRecipes(result.recipes);
        setQueryTotal(result.total);
        setAvailableRecipeMaps(result.recipeMaps);
        setRecipeQueryLoading(false);
        window.setTimeout(() => {
          for (const recipeMap of result.recipeMaps.slice(0, 48)) {
            if (recipeMap !== activeRecipeMap) {
              prefetchRecipeMap(recipeMap);
            }
          }
        }, 0);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setFilteredRecipes([]);
        setQueryTotal(0);
        setAvailableRecipeMaps([]);
        setRecipeQueryError(error instanceof Error ? error.message : "Recipe query failed.");
        setRecipeQueryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeRecipeMap,
    activeResource,
    browserMode,
    datasetManifestUrl,
    deferredRecipeSearch,
    getRecipeQueryKey,
    maxTier,
    prefetchRecipeMap,
    selectedDatasetVersion,
  ]);

  return (
    <>
      <aside className="relative flex h-full min-h-[360px] flex-col border-r border-neutral-800 bg-[#25272c] text-neutral-100">
        <div className="border-b border-neutral-800 px-3 py-3">
          <label className="flex h-9 items-center gap-2 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm text-neutral-200 shadow-[inset_1px_1px_0_rgba(255,255,255,0.08)]">
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

          <label className="mt-2 grid gap-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            Max tier
            <select
              value={maxTier}
              onChange={(event) => setMaxTier(event.target.value as TierFilter)}
              className="h-8 rounded-[4px] border border-neutral-700 bg-[#17191d] px-2 text-sm normal-case tracking-normal text-neutral-100 outline-none"
            >
              <option value="all">All tiers</option>
              {GT_VOLTAGE_TIERS.map((entry) => (
                <option key={entry.tier} value={entry.tier}>
                  {entry.tier} and lower
                </option>
              ))}
            </select>
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
              </div>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!dataset && isDatasetLoading ? (
            <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
              Loading recipe index...
            </div>
          ) : !dataset ? (
            <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
              Recipe index is not loaded yet.
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
                  onBrowse={(mode) => browseResource(resource, mode)}
                />
              ))}
            </div>
          )}
        </div>
        <ResourceHistoryPanel resources={historyResources} onBrowse={browseResource} />
      </aside>

      {activeResource ? (
        <RecipeBookOverlay
          activeRecipeMap={activeRecipeMap}
          activeResource={activeResource}
          filteredRecipes={filteredRecipes}
          isLoading={recipeQueryLoading}
          queryError={recipeQueryError}
          queryTotal={queryTotal}
          recipeMapTabs={recipeMapTabs}
          selectedRecipeId={selectedRecipeId}
          onAdd={addNodeForRecipe}
          onAddConnected={
            activeResource.anchorNodeId
              ? (recipe) =>
                  addConnectedNodeForRecipe(recipe, activeResource.anchorNodeId!, {
                    kind: activeResource.kind,
                    id: activeResource.id,
                    displayName: activeResource.displayName,
                    mode: browserMode,
                  })
              : undefined
          }
          onClose={clearResourceBrowser}
          onAddStorage={() => {
            addResourceStorage(activeResource);
          }}
          onBrowseResource={(resource, mode) =>
            browseResource(
              {
                kind: resource.kind,
                id: resource.id,
                displayName: resource.displayName,
                iconPath: resource.iconPath,
                anchorNodeId: activeResource.anchorNodeId,
              },
              mode,
            )
          }
          onRecipeMapChange={setSelectedRecipeMap}
          onRecipeMapHover={prefetchRecipeMap}
          onSelectRecipe={selectRecipe}
        />
      ) : null}
    </>
  );
}

function ResourceHistoryPanel({
  resources,
  onBrowse,
}: {
  resources: Array<Pick<ResourceAmount, "kind" | "id" | "displayName" | "iconPath">>;
  onBrowse: (
    resource: Pick<ResourceAmount, "kind" | "id" | "displayName" | "iconPath">,
    mode: "recipes" | "uses",
  ) => void;
}) {
  if (resources.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-20 max-h-[116px] overflow-hidden border border-neutral-700 bg-[#111317] p-2 shadow-xl">
      <div className="flex flex-wrap gap-2">
        {resources.map((resource) => (
          <button
            key={`${resource.kind}:${resource.id}`}
            type="button"
            onClick={() => onBrowse(resource, "recipes")}
            onContextMenu={(event) => {
              event.preventDefault();
              onBrowse(resource, "uses");
            }}
            aria-label={resourceLabel(resource)}
            className="h-10 w-10 shrink-0 border border-neutral-600 bg-[#2b2d32] p-0 hover:border-cyan-400"
          >
            <ResourceIcon
              resource={{ ...resource, amount: 1 }}
              size="sm"
              showAmount={false}
              bare
              className="!h-full !w-full"
            />
          </button>
        ))}
      </div>
    </div>
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

type TierFilter = "all" | Exclude<MachineTier, "DEMO">;

interface RecipeQueryCacheEntry {
  recipes: Recipe[];
  total: number;
  recipeMaps: string[];
}

function ResourceResult({
  resource,
  active,
  onBrowse,
}: {
  resource: IndexedResource;
  active?: boolean;
  onBrowse: (mode: "recipes" | "uses") => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onBrowse("recipes")}
      onContextMenu={(event) => {
        event.preventDefault();
        onBrowse("uses");
      }}
      className={[
        "flex items-center gap-2 rounded-[4px] border bg-[#303238] p-2 text-left",
        active ? "border-cyan-400 ring-1 ring-cyan-400" : "border-neutral-700",
      ].join(" ")}
      title="Left click: recipes. Right click: uses."
    >
      <ResourceIcon resource={{ ...resource, amount: 1 }} size="sm" showAmount={false} />
      <span className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-neutral-50">
          {resourceLabel(resource)}
        </div>
      </span>
    </button>
  );
}

function RecipeMapTabBar({
  activeRecipeMap,
  tabs,
  onRecipeMapChange,
  onRecipeMapHover,
}: {
  activeRecipeMap: string;
  tabs: RecipeMapTab[];
  onRecipeMapChange: (recipeMap: string) => void;
  onRecipeMapHover: (recipeMap: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const updateOverflow = () => {
      setHasOverflow(element.scrollWidth > element.clientWidth + 2);
    };

    updateOverflow();
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [tabs]);

  const scrollTabs = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * 184, behavior: "smooth" });
  };

  return (
    <div
      className={[
        "absolute left-1 right-1 top-0 grid h-[42px] items-start",
        hasOverflow ? "grid-cols-[24px_minmax(0,1fr)_24px]" : "grid-cols-[minmax(0,1fr)]",
      ].join(" ")}
    >
      {hasOverflow ? <NeiTabArrow direction="left" onClick={() => scrollTabs(-1)} /> : null}
      <div
        ref={scrollRef}
        className="nei-tab-strip flex h-[42px] gap-1 overflow-x-auto overflow-y-hidden px-1"
      >
        {tabs.map((tab) => (
          <MinecraftTooltip key={tab.id} label={tab.label}>
            <button
              type="button"
              onMouseEnter={() => onRecipeMapHover(tab.id)}
              onFocus={() => onRecipeMapHover(tab.id)}
              onClick={() => onRecipeMapChange(tab.id)}
              aria-label={tab.label}
              className={neiTabClass(activeRecipeMap === tab.id)}
            >
              {tab.icon ? (
                <ResourceIcon resource={tab.icon} size="sm" showAmount={false} bare tooltip={false} />
              ) : (
                <span className="text-[12px] font-bold leading-none text-white [text-shadow:1px_1px_0_#000]">
                  ?
                </span>
              )}
            </button>
          </MinecraftTooltip>
        ))}
      </div>
      {hasOverflow ? <NeiTabArrow direction="right" onClick={() => scrollTabs(1)} /> : null}
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
  filteredRecipes,
  isLoading,
  queryError,
  queryTotal,
  recipeMapTabs,
  selectedRecipeId,
  onAdd,
  onAddConnected,
  onClose,
  onAddStorage,
  onBrowseResource,
  onRecipeMapChange,
  onRecipeMapHover,
  onSelectRecipe,
}: {
  activeRecipeMap: string;
  activeResource: IndexedResource & { anchorNodeId?: string };
  filteredRecipes: Recipe[];
  isLoading: boolean;
  queryError?: string;
  queryTotal: number;
  recipeMapTabs: RecipeMapTab[];
  selectedRecipeId?: string;
  onAdd: (recipe: Recipe) => void;
  onAddConnected?: (recipe: Recipe) => void;
  onClose: () => void;
  onAddStorage: () => void;
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  onRecipeMapChange: (recipeMap: string) => void;
  onRecipeMapHover: (recipeMap: string) => void;
  onSelectRecipe: (recipeId: string) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const initialPanelSize = getInitialRecipeBookSize();
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [panelSize, setPanelSize] = useState(initialPanelSize);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const closeImmediately = () => {
    setIsClosing(true);
    window.setTimeout(onClose, 0);
  };

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
    if (resizeRef.current?.pointerId === event.pointerId) {
      resizeRef.current = null;
    }
  };

  const handleResizePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: panelSize.width,
      height: panelSize.height,
    };
  };

  const handleResizePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) {
      return;
    }

    setPanelSize(
      clampPanelSize({
        width: resize.width + event.clientX - resize.startX,
        height: resize.height + event.clientY - resize.startY,
      }),
    );
  };

  if (isClosing) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center px-3 py-4 lg:left-[360px] lg:right-[440px]">
      <section
        ref={panelRef}
        className="pointer-events-auto relative flex flex-col pt-[42px] font-mono"
        aria-label="Recipe book"
        style={{
          transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
          width: `min(${panelSize.width}px, calc(100vw - 24px))`,
          height: `min(${panelSize.height}px, calc(100vh - 32px))`,
        }}
      >
        <RecipeMapTabBar
          activeRecipeMap={activeRecipeMap}
          tabs={recipeMapTabs}
          onRecipeMapChange={onRecipeMapChange}
          onRecipeMapHover={onRecipeMapHover}
        />

        <div className="relative flex min-h-0 flex-1 flex-col border-2 border-[#f4f4f4] bg-[#c6c6c6] text-[#202020] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555]">
          <button
            type="button"
            onClick={closeImmediately}
            className="absolute -right-8 top-0 z-20 h-8 w-8 border-2 border-[#252525] bg-[#7d7d7d] text-[18px] leading-5 text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] [text-shadow:1px_1px_0_#000]"
            title="Close"
            aria-label="Close recipe book"
          >
            x
          </button>

          <div className="grid grid-cols-[24px_minmax(0,1fr)_24px] items-center px-2 pt-2">
            <div />
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="h-8 cursor-move select-none truncate border-2 border-[#555] bg-[#9b9b9b] px-2 text-center text-[18px] leading-[26px] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a] [text-shadow:2px_2px_0_#3f3f3f]"
            >
              {activeRecipeMap || filteredRecipes[0]?.machineType || resourceLabel(activeResource)}
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAddStorage();
              }}
              className="nodrag h-8 w-8 border-2 border-[#252525] bg-[#7d7d7d] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] hover:bg-[#9b9b9b]"
              title={`Add ${activeResource.kind === "fluid" ? "super tank" : "drawer"}`}
              aria-label={`Add ${activeResource.kind === "fluid" ? "super tank" : "drawer"}`}
            >
              <Archive className="mx-auto h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {queryError ? (
              <div className="border-2 border-[#777] bg-[#b6b6b6] p-3 text-sm shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]">
                {queryError}
              </div>
            ) : isLoading && filteredRecipes.length === 0 ? (
              <div className="border-2 border-[#777] bg-[#b6b6b6] p-3 text-sm shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]">
                Loading recipes...
              </div>
            ) : filteredRecipes.length === 0 ? (
              <div className="border-2 border-[#777] bg-[#b6b6b6] p-3 text-sm shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]">
                No matching recipes.
              </div>
            ) : (
              <div
                className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] items-start gap-2"
                title={
                  queryTotal > filteredRecipes.length ? `${queryTotal} recipes matched` : undefined
                }
              >
                {filteredRecipes.map((recipe) => (
                  <RecipeResultCard
                    key={recipe.id}
                    recipe={recipe}
                    selected={selectedRecipeId === recipe.id}
                    onSelect={() => onSelectRecipe(recipe.id)}
                    onAdd={() => onAdd(recipe)}
                    onAddConnected={onAddConnected ? () => onAddConnected(recipe) : undefined}
                    onSlotBrowse={onBrowseResource}
                    minimal
                  />
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="absolute bottom-1 right-1 h-5 w-5 cursor-nwse-resize border-2 border-[#252525] bg-[#8f8f8f] shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040]"
            title="Resize recipe book"
            aria-label="Resize recipe book"
          >
            <span className="absolute bottom-0.5 right-0.5 h-2 w-2 border-b-2 border-r-2 border-white opacity-80" />
          </button>
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
  onSlotBrowse,
  minimal = false,
}: {
  recipe: Recipe;
  selected: boolean;
  onSelect: () => void;
  onAdd: () => void;
  onAddConnected?: () => void;
  onSlotBrowse?: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  minimal?: boolean;
}) {
  const primary = primaryOutput(recipe);

  return (
    <article
      onClick={onSelect}
      className={[
        "relative cursor-pointer transition",
        selected ? "ring-1 ring-cyan-400" : "",
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
          className="absolute right-1 top-1 z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center border border-neutral-600 bg-[#1b1d21] text-neutral-200 hover:border-cyan-400 hover:text-cyan-100"
        >
          {onAddConnected ? <GitBranchPlus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>
      </div>
      <div className="overflow-x-auto pb-1 pr-9">
        <NeiRecipeWindow
          recipe={recipe}
          scale={2}
          compact
          className="mx-auto"
          onSlotClick={onSlotBrowse ? (slot, mode) => onSlotBrowse(slot.resource, mode) : undefined}
        />
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

function clampPanelSize(size: { width: number; height: number }) {
  const maxWidth = typeof window === "undefined" ? 960 : Math.max(420, window.innerWidth - 24);
  const maxHeight = typeof window === "undefined" ? 900 : Math.max(360, window.innerHeight - 32);

  return {
    width: clamp(size.width, 420, maxWidth),
    height: clamp(size.height, 360, maxHeight),
  };
}

function getInitialRecipeBookSize() {
  if (typeof window === "undefined") {
    return { width: 760, height: 760 };
  }

  return {
    width: Math.min(920, Math.max(420, window.innerWidth - 360 - 440 - 48)),
    height: Math.min(760, Math.max(360, window.innerHeight - 32)),
  };
}

function buildResourceIndex(
  datasetResourceIndex: DatasetResourceIndexEntry[] | undefined,
  datasetRecipes: Recipe[],
  projectRecipes: Recipe[],
): Map<ResourceKey, IndexedResource> {
  const index = new Map<ResourceKey, IndexedResource>();
  if (datasetResourceIndex) {
    for (const resource of datasetResourceIndex) {
      index.set(`${resource.kind}:${resource.id}` as ResourceKey, resource);
    }
  } else {
    addRecipesToResourceIndex(index, datasetRecipes);
  }

  if (projectRecipes.length > 0) {
    const datasetRecipeIds = new Set(datasetRecipes.map((recipe) => recipe.id));
    addRecipesToResourceIndex(
      index,
      projectRecipes.filter((recipe) => !datasetRecipeIds.has(recipe.id)),
    );
  }

  return index;
}

function getRecipeQueryCacheKey({
  versionId,
  query,
  resource,
  mode,
  recipeMap,
  maxTier,
}: {
  versionId: string;
  query: string;
  resource?: Pick<ResourceAmount, "kind" | "id">;
  mode: "recipes" | "uses";
  recipeMap: string;
  maxTier: TierFilter;
}) {
  return [
    versionId,
    query.trim().toLowerCase(),
    resource ? `${resource.kind}:${resource.id}` : "",
    mode,
    recipeMap,
    maxTier,
  ].join("|");
}

function trimRecipeQueryCache(cache: Map<string, RecipeQueryCacheEntry>) {
  while (cache.size > 120) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    cache.delete(oldestKey);
  }
}

function addRecipesToResourceIndex(index: Map<ResourceKey, IndexedResource>, recipes: Recipe[]) {
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
}

function resourceMatchesQuery(resource: IndexedResource, query: string): boolean {
  return [resource.displayName, resource.id, resource.kind]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(query));
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
