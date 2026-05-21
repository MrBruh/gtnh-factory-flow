"use client";

import { Archive, Search, X } from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { DEFAULT_DATASET_MANIFEST_URL } from "@/lib/datasets";
import {
  getRecipeDatasetRecipe,
  queryRecipeDatasetRecipes,
  type RecipeDatasetQueryResult,
} from "@/lib/datasets/browser-loader";
import type {
  DatasetResource,
  DatasetResourceIndexEntry,
  RecipeSummary,
} from "@/lib/datasets/types";
import { getResourceKey, GT_VOLTAGE_TIERS, resourceLabel } from "@/lib/model";
import { useFactoryStore } from "@/store/factory-store";
import type { TierFilter } from "@/store/factory-store";
import type { Recipe, ResourceAmount, ResourceKey } from "@/lib/model/types";
import { getNeiRecipeLayout } from "@/lib/nei/layout";
import type { NeiSlotFrame } from "@/lib/nei/layout";
import { MinecraftTooltip } from "./nei/MinecraftTooltip";
import { ResourceIcon } from "./nei/ResourceIcon";

const RECIPE_QUERY_LIMIT = 24;
const RECIPE_QUERY_CACHE_TTL_MS = 90_000;

export function RecipeBrowser() {
  const dataset = useFactoryStore((state) => state.dataset);
  const datasetManifest = useFactoryStore((state) => state.datasetManifest);
  const datasetManifestUrl = useFactoryStore((state) => state.datasetManifestUrl);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isDatasetLoading = useFactoryStore((state) => state.isDatasetLoading);
  const projectRecipes = useFactoryStore((state) => state.project.recipes);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const maxTier = useFactoryStore((state) => state.maxTierFilter);
  const browserResource = useFactoryStore((state) => state.recipeBrowserResource);
  const browserMode = useFactoryStore((state) => state.recipeBrowserMode);
  const resourceHistory = useFactoryStore((state) => state.recipeResourceHistory);
  const selectedRecipeId = useFactoryStore((state) => state.selectedRecipeId);
  const setRecipeSearch = useFactoryStore((state) => state.setRecipeSearch);
  const setMaxTier = useFactoryStore((state) => state.setMaxTierFilter);
  const browseResource = useFactoryStore((state) => state.browseResource);
  const clearResourceBrowser = useFactoryStore((state) => state.clearResourceBrowser);
  const selectRecipe = useFactoryStore((state) => state.selectRecipe);
  const addNodeForRecipe = useFactoryStore((state) => state.addNodeForRecipeObject);
  const addResourceStorage = useFactoryStore((state) => state.addResourceStorage);
  const [selectedRecipeMap, setSelectedRecipeMap] = useState("all");
  const [recipePage, setRecipePage] = useState(0);
  const [filteredRecipes, setFilteredRecipes] = useState<RecipeSummary[]>([]);
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

  const sortedResources = useMemo(
    () => [...resourceIndex.values()].sort(compareResourcesByRecipeCount),
    [resourceIndex],
  );

  const resourceResults = useMemo(() => {
    if (activeResource) {
      return [];
    }

    const query = deferredRecipeSearch.trim().toLowerCase();
    if (!query) {
      return sortedResources.filter((resource) => resource.iconPath || resource.iconAtlas);
    }

    return sortedResources
      .filter((resource) => resourceMatchesQuery(resource, query))
      .sort((left, right) => {
        const leftLabel = resourceLabel(left).toLowerCase();
        const rightLabel = resourceLabel(right).toLowerCase();
        const leftExact = leftLabel === query || left.id.toLowerCase() === query ? 1 : 0;
        const rightExact = rightLabel === query || right.id.toLowerCase() === query ? 1 : 0;
        return rightExact - leftExact || compareResourcesByRecipeCount(left, right);
      });
  }, [activeResource, deferredRecipeSearch, sortedResources]);

  const visibleResourceResults = useMemo(() => {
    if (!activeResource) {
      return resourceResults;
    }

    const query = deferredRecipeSearch.trim().toLowerCase();
    return query
      ? sortedResources.filter((resource) => resourceMatchesQuery(resource, query))
      : sortedResources;
  }, [activeResource, deferredRecipeSearch, resourceResults, sortedResources]);

  const recipeMaps = useMemo(
    () => availableRecipeMaps.filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [availableRecipeMaps],
  );

  const recipeMapTabs = useMemo(
    () => buildRecipeMapTabs(recipeMaps, dataset?.resourceIndex ?? dataset?.resources ?? []),
    [dataset?.resourceIndex, dataset?.resources, recipeMaps],
  );

  const activeRecipeMap = recipeMaps.includes(selectedRecipeMap)
    ? selectedRecipeMap
    : (recipeMaps[0] ?? "");

  const selectedDatasetVersion = useMemo(
    () => datasetManifest?.versions.find((entry) => entry.id === selectedDatasetVersionId),
    [datasetManifest?.versions, selectedDatasetVersionId],
  );

  const getRecipeQueryKey = useCallback(
    (recipeMap: string, page: number) =>
      selectedDatasetVersion
        ? getRecipeQueryCacheKey({
            versionId: selectedDatasetVersion.id,
            query: deferredRecipeSearch.trim(),
            resource: activeResource,
            mode: browserMode,
            recipeMap,
            maxTier,
            offset: page * RECIPE_QUERY_LIMIT,
            limit: RECIPE_QUERY_LIMIT,
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

      const cacheKey = getRecipeQueryKey(recipeMap, 0);
      if (!cacheKey || getCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey)) {
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
          offset: 0,
          limit: RECIPE_QUERY_LIMIT,
        },
      ).then((result) => {
        setCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey, result);
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

  const getFullRecipe = useCallback(
    async (recipeId: string): Promise<Recipe> => {
      const projectRecipe = projectRecipes.find((recipe) => recipe.id === recipeId);
      if (projectRecipe) {
        return projectRecipe;
      }
      if (!selectedDatasetVersion) {
        throw new Error("No dataset version is selected.");
      }

      return getRecipeDatasetRecipe(
        datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL,
        selectedDatasetVersion,
        recipeId,
      );
    },
    [datasetManifestUrl, projectRecipes, selectedDatasetVersion],
  );

  const handleAddRecipe = useCallback(
    async (recipeId: string) => {
      addNodeForRecipe(await getFullRecipe(recipeId));
      clearResourceBrowser();
    },
    [addNodeForRecipe, clearResourceBrowser, getFullRecipe],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => setRecipePage(0), 0);
    return () => window.clearTimeout(timeout);
  }, [
    activeResource?.id,
    activeResource?.kind,
    browserMode,
    deferredRecipeSearch,
    maxTier,
    selectedDatasetVersion?.id,
    selectedRecipeMap,
  ]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(queryTotal / RECIPE_QUERY_LIMIT) - 1);
    if (recipePage > maxPage) {
      const timeout = window.setTimeout(() => setRecipePage(maxPage), 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [queryTotal, recipePage]);

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

    const cacheKey = getRecipeQueryKey(activeRecipeMap, recipePage);
    const cached = getCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey);
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
        offset: recipePage * RECIPE_QUERY_LIMIT,
        limit: RECIPE_QUERY_LIMIT,
      },
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCachedRecipeQuery(recipeQueryCacheRef.current, cacheKey, result);
        const effectiveRecipeMap = activeRecipeMap || result.recipeMaps[0] || "";
        if (effectiveRecipeMap !== activeRecipeMap && recipePage === 0) {
          setCachedRecipeQuery(
            recipeQueryCacheRef.current,
            getRecipeQueryKey(effectiveRecipeMap, 0),
            result,
          );
        }
        trimRecipeQueryCache(recipeQueryCacheRef.current);
        setFilteredRecipes(result.recipes);
        setQueryTotal(result.total);
        setAvailableRecipeMaps(result.recipeMaps);
        setRecipeQueryLoading(false);
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
    recipePage,
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

        <div className="min-h-0 flex-1 overflow-hidden p-3">
          {!dataset && isDatasetLoading ? (
            <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
              Loading recipe index...
            </div>
          ) : !dataset ? (
            <div className="rounded border border-dashed border-neutral-600 p-4 text-sm text-neutral-300">
              Recipe index is not loaded yet.
            </div>
          ) : (
            <VirtualResourceResultList
              key={[
                selectedDatasetVersionId ?? "",
                activeResource ? `${activeResource.kind}:${activeResource.id}` : "",
                deferredRecipeSearch.trim().toLowerCase(),
              ].join("|")}
              resources={visibleResourceResults}
              activeResource={activeResource}
              onBrowse={browseResource}
            />
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
          recipePage={recipePage}
          recipeLimit={RECIPE_QUERY_LIMIT}
          recipeMapTabs={recipeMapTabs}
          selectedRecipeId={selectedRecipeId}
          onAdd={handleAddRecipe}
          onAddConnected={undefined}
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
                iconAtlas: resource.iconAtlas,
                anchorNodeId: activeResource.anchorNodeId,
              },
              mode,
            )
          }
          onRecipeMapChange={(recipeMap) => {
            setSelectedRecipeMap(recipeMap);
            setRecipePage(0);
          }}
          onRecipeMapHover={prefetchRecipeMap}
          onRecipePageChange={setRecipePage}
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
  resources: Array<Pick<ResourceAmount, "kind" | "id" | "displayName" | "iconPath" | "iconAtlas">>;
  onBrowse: (
    resource: Pick<ResourceAmount, "kind" | "id" | "displayName" | "iconPath" | "iconAtlas">,
    mode: "recipes" | "uses",
  ) => void;
}) {
  const { containerRef, visibleSlotCount } = useVisibleResourceHistorySlots();
  const visibleResources = resources.slice(0, visibleSlotCount);

  if (resources.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-auto z-20 h-[58px] shrink-0 overflow-hidden border-t border-neutral-700 bg-[#111317] p-2 shadow-[0_-8px_18px_rgba(0,0,0,0.22)]">
      <div
        ref={containerRef}
        className="grid min-w-0 grid-flow-col auto-cols-[40px] gap-2 overflow-hidden"
      >
        {visibleResources.map((resource) => (
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

function useVisibleResourceHistorySlots() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visibleSlotCount, setVisibleSlotCount] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateVisibleSlotCount = () => {
      const slotSize = 40;
      const gap = 8;
      const width = container.clientWidth;
      setVisibleSlotCount(Math.max(1, Math.floor((width + gap) / (slotSize + gap))));
    };

    updateVisibleSlotCount();
    const observer = new ResizeObserver(updateVisibleSlotCount);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return { containerRef, visibleSlotCount };
}

interface IndexedResource extends Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas"
> {
  recipeCount: number;
}

interface RecipeMapTab {
  id: string;
  label: string;
  icon?: Pick<ResourceAmount, "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas">;
}

interface RecipeQueryCacheEntry {
  result: RecipeDatasetQueryResult;
  expiresAt: number;
}

function VirtualResourceResultList({
  resources,
  activeResource,
  onBrowse,
}: {
  resources: IndexedResource[];
  activeResource?: IndexedResource;
  onBrowse: (resource: IndexedResource, mode: "recipes" | "uses") => void;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(resources.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleResources = resources.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const warmPages = getWarmResourcePages(currentPage, pageCount);
  const warmedResources = warmPages.flatMap((warmPage) =>
    resources.slice(warmPage * pageSize, (warmPage + 1) * pageSize),
  );
  const handlePreviousPage = useCallback(() => {
    setPage((current) => Math.max(0, current - 1));
  }, []);
  const handleNextPage = useCallback(() => {
    setPage((current) => Math.min(pageCount - 1, current + 1));
  }, [pageCount]);

  return (
    <div className="flex h-full min-w-0 min-h-0 flex-col overflow-hidden">
      <div className="grid min-w-0 min-h-0 flex-1 content-start grid-cols-1 gap-2 overflow-hidden">
        {visibleResources.map((resource) => (
          <ResourceResult
            key={`${resource.kind}:${resource.id}`}
            resource={resource}
            active={activeResource?.kind === resource.kind && activeResource.id === resource.id}
            onBrowse={(mode) => onBrowse(resource, mode)}
          />
        ))}
        <ResourcePageWarmup resources={warmedResources} />
      </div>
      <ResourcePager
        currentPage={currentPage}
        pageCount={pageCount}
        onPreviousPage={handlePreviousPage}
        onNextPage={handleNextPage}
      />
    </div>
  );
}

function ResourcePager({
  currentPage,
  pageCount,
  onPreviousPage,
  onNextPage,
}: {
  currentPage: number;
  pageCount: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  return (
    <div className="mt-2 grid h-8 w-full min-w-0 max-w-full shrink-0 grid-cols-[32px_minmax(0,1fr)_32px] items-center overflow-hidden border border-neutral-700 bg-[#111317] text-center font-mono text-sm text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.08),inset_-1px_-1px_0_rgba(0,0,0,0.45)]">
      <button
        type="button"
        onClick={onPreviousPage}
        disabled={currentPage === 0}
        className="h-full border-r border-neutral-700 bg-[#1b1d21] text-red-400 disabled:opacity-35"
        aria-label="Previous resource page"
        title="Previous page"
      >
        {"<"}
      </button>
      <div className="truncate px-2 [text-shadow:1px_1px_0_#000]">
        {currentPage + 1}/{pageCount}
      </div>
      <button
        type="button"
        onClick={onNextPage}
        disabled={currentPage >= pageCount - 1}
        className="h-full border-l border-neutral-700 bg-[#1b1d21] text-red-400 disabled:opacity-35"
        aria-label="Next resource page"
        title="Next page"
      >
        {">"}
      </button>
    </div>
  );
}

function getWarmResourcePages(currentPage: number, pageCount: number) {
  const pages: number[] = [];
  for (const page of [currentPage - 1, currentPage + 1, currentPage + 2]) {
    if (page >= 0 && page < pageCount && !pages.includes(page)) {
      pages.push(page);
    }
  }
  return pages;
}

const ResourcePageWarmup = memo(function ResourcePageWarmup({
  resources,
}: {
  resources: IndexedResource[];
}) {
  if (resources.length === 0) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -left-[10000px] top-0 h-1 w-1 overflow-hidden opacity-0"
    >
      {resources.map((resource) => (
        <ResourceIcon
          key={`${resource.kind}:${resource.id}`}
          resource={{ ...resource, amount: 1 }}
          size="sm"
          showAmount={false}
          tooltip={false}
        />
      ))}
    </div>
  );
});

const ResourceResult = memo(function ResourceResult({
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
});

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
                <ResourceIcon
                  resource={tab.icon}
                  size="sm"
                  showAmount={false}
                  bare
                  tooltip={false}
                />
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
  recipePage,
  recipeLimit,
  recipeMapTabs,
  selectedRecipeId,
  onAdd,
  onAddConnected,
  onClose,
  onAddStorage,
  onBrowseResource,
  onRecipeMapChange,
  onRecipeMapHover,
  onRecipePageChange,
  onSelectRecipe,
}: {
  activeRecipeMap: string;
  activeResource: IndexedResource & { anchorNodeId?: string };
  filteredRecipes: RecipeSummary[];
  isLoading: boolean;
  queryError?: string;
  queryTotal: number;
  recipePage: number;
  recipeLimit: number;
  recipeMapTabs: RecipeMapTab[];
  selectedRecipeId?: string;
  onAdd: (recipeId: string) => void | Promise<void>;
  onAddConnected?: (recipeId: string) => void | Promise<void>;
  onClose: () => void;
  onAddStorage: () => void;
  onBrowseResource: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
  onRecipeMapChange: (recipeMap: string) => void;
  onRecipeMapHover: (recipeMap: string) => void;
  onRecipePageChange: (page: number) => void;
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
  const recipePageCount = Math.max(1, Math.ceil(queryTotal / recipeLimit));
  const currentRecipePage = Math.min(recipePage, recipePageCount - 1);

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

          <div className="min-h-0 flex-1 overflow-y-auto p-3" id="recipe-book-scroll">
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
              <VirtualRecipeResultList
                recipes={filteredRecipes}
                queryTotal={queryTotal}
                currentPage={currentRecipePage}
                pageSize={recipeLimit}
                selectedRecipeId={selectedRecipeId}
                onSelectRecipe={onSelectRecipe}
                onAdd={onAdd}
                onAddConnected={onAddConnected}
                onSlotBrowse={onBrowseResource}
              />
            )}
          </div>
          {filteredRecipes.length > 0 || queryTotal > 0 ? (
            <RecipePagePager
              currentPage={currentRecipePage}
              pageCount={recipePageCount}
              total={queryTotal}
              isLoading={isLoading}
              onPreviousPage={() => onRecipePageChange(Math.max(0, currentRecipePage - 1))}
              onNextPage={() =>
                onRecipePageChange(Math.min(recipePageCount - 1, currentRecipePage + 1))
              }
            />
          ) : null}
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

function VirtualRecipeResultList({
  recipes,
  queryTotal,
  currentPage,
  pageSize,
  selectedRecipeId,
  onSelectRecipe,
  onAdd,
  onAddConnected,
  onSlotBrowse,
}: {
  recipes: RecipeSummary[];
  queryTotal: number;
  currentPage: number;
  pageSize: number;
  selectedRecipeId?: string;
  onSelectRecipe: (recipeId: string) => void;
  onAdd: (recipeId: string) => void | Promise<void>;
  onAddConnected?: (recipeId: string) => void | Promise<void>;
  onSlotBrowse: (resource: ResourceAmount, mode: "recipes" | "uses") => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitRegionsRef = useRef<RecipeCanvasHitRegion[]>([]);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 360, width: 420 });
  const [, forceImageRedraw] = useState(0);
  const rowHeight = 222;
  const totalHeight = Math.max(rowHeight, recipes.length * rowHeight);

  useEffect(() => {
    const scrollParent = anchorRef.current?.parentElement;
    if (!scrollParent) {
      return;
    }

    const updateViewport = () => {
      setViewport({
        scrollTop: scrollParent.scrollTop,
        height: scrollParent.clientHeight,
        width: scrollParent.clientWidth,
      });
    };

    updateViewport();
    scrollParent.addEventListener("scroll", updateViewport, { passive: true });
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(scrollParent);

    return () => {
      scrollParent.removeEventListener("scroll", updateViewport);
      resizeObserver.disconnect();
    };
  }, [recipes.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, viewport.width);
    const height = Math.max(1, viewport.height);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    drawRecipeResultsCanvas(ctx, {
      recipes,
      viewport,
      rowHeight,
      selectedRecipeId,
      onImageLoad: () => forceImageRedraw((tick) => tick + 1),
      hitRegions: hitRegionsRef.current,
      hasConnectedAdd: Boolean(onAddConnected),
    });
  }, [onAddConnected, recipes, rowHeight, selectedRecipeId, viewport]);

  const getHitRegion = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top + viewport.scrollTop;
    return [...hitRegionsRef.current]
      .reverse()
      .find((region) => pointInRegion(x, y, region));
  }, [viewport.scrollTop]);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const region = getHitRegion(event);
      if (!region) {
        return;
      }

      if (region.type === "slot") {
        onSlotBrowse(region.resource, "recipes");
        return;
      }

      if (region.type === "add") {
        if (onAddConnected) {
          void onAddConnected(region.recipeId);
        } else {
          void onAdd(region.recipeId);
        }
        return;
      }

      onSelectRecipe(region.recipeId);
    },
    [getHitRegion, onAdd, onAddConnected, onSelectRecipe, onSlotBrowse],
  );

  const handleCanvasDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const region = getHitRegion(event);
      if (!region || region.type === "slot") {
        return;
      }

      void onAdd(region.recipeId);
    },
    [getHitRegion, onAdd],
  );

  const handleCanvasContextMenu = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const region = getHitRegion(event);
      if (region?.type !== "slot") {
        return;
      }

      event.preventDefault();
      onSlotBrowse(region.resource, "uses");
    },
    [getHitRegion, onSlotBrowse],
  );

  return (
    <div
      ref={anchorRef}
      className="relative"
      style={{ height: totalHeight }}
      title={
        queryTotal > recipes.length
          ? `${queryTotal} recipes matched, showing ${currentPage * pageSize + 1}-${Math.min(
              queryTotal,
              currentPage * pageSize + recipes.length,
            )}`
          : undefined
      }
    >
      <canvas
        ref={canvasRef}
        className="absolute left-0 top-0 cursor-pointer"
        style={{
          transform: `translateY(${viewport.scrollTop}px)`,
          imageRendering: "pixelated",
        }}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        onContextMenu={handleCanvasContextMenu}
      />
    </div>
  );
}

type RecipeCanvasHitRegion =
  | { type: "card" | "add"; recipeId: string; x: number; y: number; width: number; height: number }
  | {
      type: "slot";
      recipeId: string;
      resource: ResourceAmount;
      x: number;
      y: number;
      width: number;
      height: number;
    };

interface RecipeCanvasDrawContext {
  recipes: RecipeSummary[];
  viewport: { scrollTop: number; height: number; width: number };
  rowHeight: number;
  selectedRecipeId?: string;
  onImageLoad: () => void;
  hitRegions: RecipeCanvasHitRegion[];
  hasConnectedAdd: boolean;
}

const canvasImageCache = new Map<string, HTMLImageElement>();

function drawRecipeResultsCanvas(ctx: CanvasRenderingContext2D, draw: RecipeCanvasDrawContext) {
  ctx.clearRect(0, 0, draw.viewport.width, draw.viewport.height);
  draw.hitRegions.length = 0;
  const startIndex = Math.max(0, Math.floor(draw.viewport.scrollTop / draw.rowHeight) - 1);
  const endIndex = Math.min(
    draw.recipes.length,
    Math.ceil((draw.viewport.scrollTop + draw.viewport.height) / draw.rowHeight) + 1,
  );

  for (let index = startIndex; index < endIndex; index += 1) {
    const summary = draw.recipes[index];
    if (!summary) {
      continue;
    }
    drawRecipeCanvasCard(ctx, summary, {
      x: 0,
      y: index * draw.rowHeight - draw.viewport.scrollTop,
      scrollY: index * draw.rowHeight,
      width: draw.viewport.width,
      rowHeight: draw.rowHeight,
      selected: draw.selectedRecipeId === summary.id,
      onImageLoad: draw.onImageLoad,
      hitRegions: draw.hitRegions,
      hasConnectedAdd: draw.hasConnectedAdd,
    });
  }
}

function drawRecipeCanvasCard(
  ctx: CanvasRenderingContext2D,
  summary: RecipeSummary,
  options: {
    x: number;
    y: number;
    scrollY: number;
    width: number;
    rowHeight: number;
    selected: boolean;
    onImageLoad: () => void;
    hitRegions: RecipeCanvasHitRegion[];
    hasConnectedAdd: boolean;
  },
) {
  const recipe = summaryToPreviewRecipe(summary);
  const layout = getNeiRecipeLayout(recipe);
  const scale = 2;
  const padding = 8;
  const titleHeight = 22;
  const footerHeight = 31;
  const cardHeight = options.rowHeight - 8;
  const cardWidth = Math.max(360, options.width - 4);
  const cardX = options.x + 2;
  const cardY = options.y + 2;
  const contentWidth = layout.canvas.width * scale;
  const contentHeight = Math.max(82, layout.canvas.height) * scale;
  const contentX = cardX + Math.max(padding, Math.floor((cardWidth - contentWidth) / 2));
  const contentY = cardY + titleHeight + 4;
  const totalEu = Math.max(0, recipe.eut) * Math.max(1, Math.ceil(recipe.durationTicks / 20));
  const seconds = recipe.durationTicks / 20;

  options.hitRegions.push({
    type: "card",
    recipeId: summary.id,
    x: cardX,
    y: options.scrollY + 2,
    width: cardWidth,
    height: cardHeight,
  });

  ctx.save();
  ctx.fillStyle = "#b6b6b6";
  ctx.fillRect(cardX, cardY, cardWidth, cardHeight);
  drawBeveledRect(ctx, cardX, cardY, cardWidth, cardHeight, "#eeeeee", "#777777", 2);
  if (options.selected) {
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.strokeRect(cardX + 1, cardY + 1, cardWidth - 2, cardHeight - 2);
  }

  ctx.fillStyle = "#8f8f8f";
  ctx.fillRect(cardX + 5, cardY + 5, cardWidth - 10, titleHeight);
  drawBeveledRect(ctx, cardX + 5, cardY + 5, cardWidth - 10, titleHeight, "#d8d8d8", "#404040", 2);
  drawPixelText(ctx, recipe.source?.recipeMap ?? recipe.machineType, cardX + cardWidth / 2, cardY + 21, {
    align: "center",
    color: "#ffffff",
    size: 14,
    shadow: true,
  });

  const addSize = 24;
  const addX = cardX + cardWidth - addSize - 7;
  const addY = cardY + 6;
  ctx.fillStyle = "#1b1d21";
  ctx.fillRect(addX, addY, addSize, addSize);
  drawBeveledRect(ctx, addX, addY, addSize, addSize, "#4b5563", "#050505", 1);
  drawPixelText(ctx, options.hasConnectedAdd ? "+" : "+", addX + addSize / 2, addY + 17, {
    align: "center",
    color: "#e5e7eb",
    size: 17,
    shadow: false,
  });
  options.hitRegions.push({
    type: "add",
    recipeId: summary.id,
    x: addX,
    y: options.scrollY + 6,
    width: addSize,
    height: addSize,
  });

  drawImage(ctx, "/nei/gregtech/gui/background/nei_single_recipe.png", contentX, contentY, contentWidth, contentHeight, options.onImageLoad);
  drawRecipeProgress(ctx, layout.progressBars[0], contentX, contentY, scale, options.onImageLoad);

  for (const frame of layout.frames) {
    drawRecipeSlot(ctx, frame, {
      recipeId: summary.id,
      x: contentX + frame.x * scale,
      y: contentY + frame.y * scale,
      scrollY: options.scrollY + contentY - cardY + frame.y * scale + 2,
      scale,
      hitRegions: options.hitRegions,
      onImageLoad: options.onImageLoad,
    });
  }

  const logoX = Math.min(layout.logo.x, layout.canvas.width - 28);
  drawImage(
    ctx,
    "/nei/gregtech/gui/picture/gt_logo_17x17_transparent.png",
    contentX + logoX * scale - 5,
    contentY + layout.logo.y * scale,
    17 * scale,
    17 * scale,
    options.onImageLoad,
  );

  const footerY = Math.min(cardY + cardHeight - footerHeight - 4, contentY + contentHeight + 3);
  drawPixelText(ctx, `Total: ${formatCompactNumber(totalEu)} EU`, cardX + 9, footerY + 11, {
    color: "#111111",
    size: 12,
  });
  drawPixelText(ctx, `Usage: ${formatCompactNumber(recipe.eut)} EU/t`, cardX + 9, footerY + 23, {
    color: "#111111",
    size: 12,
  });
  drawPixelText(ctx, `Time: ${formatCompactNumber(seconds)} seconds`, cardX + 9, footerY + 35, {
    color: "#111111",
    size: 12,
  });
  ctx.restore();
}

function drawRecipeSlot(
  ctx: CanvasRenderingContext2D,
  frame: NeiSlotFrame,
  options: {
    recipeId: string;
    x: number;
    y: number;
    scrollY: number;
    scale: number;
    hitRegions: RecipeCanvasHitRegion[];
    onImageLoad: () => void;
  },
) {
  const slotSize = 18 * options.scale;
  drawImage(
    ctx,
    `/nei/modularui/gui/slot/${frame.kind}.png`,
    options.x,
    options.y,
    slotSize,
    slotSize,
    options.onImageLoad,
  );

  if (!frame.resource) {
    return;
  }

  options.hitRegions.push({
    type: "slot",
    recipeId: options.recipeId,
    resource: frame.resource,
    x: options.x,
    y: options.scrollY,
    width: slotSize,
    height: slotSize,
  });

  drawResourceIcon(ctx, frame.resource, options.x, options.y, slotSize, options.onImageLoad);
  const amount = formatCanvasAmount(frame.resource);
  if (amount) {
    drawPixelText(ctx, amount, options.x + slotSize - 2, options.y + slotSize - 2, {
      align: "right",
      color: "#ffffff",
      size: 10,
      shadow: true,
    });
  }
  const renderResource = frame.resource as ResourceAmount & { chance?: number; consumed?: boolean };
  if (renderResource.chance !== undefined && renderResource.chance < 1) {
    drawPixelText(ctx, `${formatCompactNumber(renderResource.chance * 100)}%`, options.x + slotSize - 2, options.y + 8, {
      align: "right",
      color: "#ffff55",
      size: 9,
      shadow: true,
    });
  }
  if (renderResource.consumed === false) {
    drawPixelText(ctx, "NC", options.x + 1, options.y + 8, {
      color: "#ffff55",
      size: 8,
      shadow: true,
    });
  }
}

function drawRecipeProgress(
  ctx: CanvasRenderingContext2D,
  bar: { x: number; y: number; width: number; height: number; texture: string } | undefined,
  x: number,
  y: number,
  scale: number,
  onImageLoad: () => void,
) {
  if (!bar) {
    return;
  }

  drawImage(
    ctx,
    `/nei/gregtech/gui/progressbar/${bar.texture}.png`,
    x + bar.x * scale,
    y + bar.y * scale,
    bar.width * scale,
    bar.height * scale,
    onImageLoad,
    { sx: 0, sy: 0.5, sw: 1, sh: 0.5 },
  );
}

function drawResourceIcon(
  ctx: CanvasRenderingContext2D,
  resource: ResourceAmount,
  x: number,
  y: number,
  size: number,
  onImageLoad: () => void,
) {
  const iconSize = size * 1.75;
  const iconX = x + (size - iconSize) / 2;
  const iconY = y + (size - iconSize) / 2;

  if (resource.iconAtlas) {
    const image = loadCanvasImage(resource.iconAtlas.imagePath, onImageLoad);
    if (!image?.complete) {
      return;
    }
    ctx.drawImage(
      image,
      resource.iconAtlas.x,
      resource.iconAtlas.y,
      resource.iconAtlas.width,
      resource.iconAtlas.height,
      iconX,
      iconY,
      iconSize,
      iconSize,
    );
    return;
  }

  if (!resource.iconPath || resource.iconPath.includes("/textures/rendered/")) {
    return;
  }

  drawImage(ctx, resource.iconPath, iconX, iconY, iconSize, iconSize, onImageLoad);
}

function drawImage(
  ctx: CanvasRenderingContext2D,
  src: string,
  x: number,
  y: number,
  width: number,
  height: number,
  onImageLoad: () => void,
  source?: { sx: number; sy: number; sw: number; sh: number },
) {
  const image = loadCanvasImage(src, onImageLoad);
  if (!image?.complete) {
    return;
  }

  if (source) {
    ctx.drawImage(
      image,
      image.width * source.sx,
      image.height * source.sy,
      image.width * source.sw,
      image.height * source.sh,
      x,
      y,
      width,
      height,
    );
    return;
  }

  ctx.drawImage(image, x, y, width, height);
}

function loadCanvasImage(src: string, onLoad: () => void): HTMLImageElement | undefined {
  const absoluteSrc = toAbsoluteAssetUrl(src);
  const cached = canvasImageCache.get(absoluteSrc);
  if (cached) {
    return cached;
  }

  const image = new Image();
  image.decoding = "async";
  image.onload = onLoad;
  image.src = absoluteSrc;
  canvasImageCache.set(absoluteSrc, image);
  return image;
}

function toAbsoluteAssetUrl(src: string) {
  try {
    return new URL(src, window.location.origin).toString();
  } catch {
    return src;
  }
}

function drawBeveledRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  light: string,
  dark: string,
  lineWidth: number,
) {
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = light;
  ctx.beginPath();
  ctx.moveTo(x + lineWidth / 2, y + height);
  ctx.lineTo(x + lineWidth / 2, y + lineWidth / 2);
  ctx.lineTo(x + width, y + lineWidth / 2);
  ctx.stroke();
  ctx.strokeStyle = dark;
  ctx.beginPath();
  ctx.moveTo(x + width - lineWidth / 2, y);
  ctx.lineTo(x + width - lineWidth / 2, y + height - lineWidth / 2);
  ctx.lineTo(x, y + height - lineWidth / 2);
  ctx.stroke();
}

function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    color?: string;
    size?: number;
    align?: CanvasTextAlign;
    shadow?: boolean;
  } = {},
) {
  ctx.font = `${options.size ?? 12}px Monocraft, "Courier New", monospace`;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "alphabetic";
  if (options.shadow) {
    ctx.fillStyle = "#000000";
    ctx.fillText(text, x + 1, y + 1);
  }
  ctx.fillStyle = options.color ?? "#111111";
  ctx.fillText(text, x, y);
}

function pointInRegion(x: number, y: number, region: RecipeCanvasHitRegion) {
  return (
    x >= region.x &&
    x <= region.x + region.width &&
    y >= region.y &&
    y <= region.y + region.height
  );
}

function formatCanvasAmount(resource: ResourceAmount) {
  if (resource.kind === "item") {
    return resource.amount === 1 ? "" : formatCompactNumber(resource.amount);
  }

  return `${formatCompactNumber(resource.amount)}L`;
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function RecipePagePager({
  currentPage,
  pageCount,
  total,
  isLoading,
  onPreviousPage,
  onNextPage,
}: {
  currentPage: number;
  pageCount: number;
  total: number;
  isLoading: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  return (
    <div className="grid h-9 shrink-0 grid-cols-[36px_minmax(0,1fr)_36px] items-center border-t-2 border-[#777] bg-[#b6b6b6] text-center text-[13px] text-[#111] shadow-[inset_0_1px_0_#eeeeee]">
      <button
        type="button"
        onClick={onPreviousPage}
        disabled={currentPage === 0 || isLoading}
        className="h-full border-r-2 border-[#777] bg-[#8f8f8f] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] disabled:opacity-35"
        aria-label="Previous recipe page"
        title="Previous recipe page"
      >
        {"<"}
      </button>
      <div className="truncate px-2 [text-shadow:1px_1px_0_rgba(255,255,255,0.55)]">
        {currentPage + 1}/{pageCount} · {total} recipes
      </div>
      <button
        type="button"
        onClick={onNextPage}
        disabled={currentPage >= pageCount - 1 || isLoading}
        className="h-full border-l-2 border-[#777] bg-[#8f8f8f] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] disabled:opacity-35"
        aria-label="Next recipe page"
        title="Next recipe page"
      >
        {">"}
      </button>
    </div>
  );
}

function summaryToPreviewRecipe(summary: RecipeSummary): Recipe {
  return {
    id: summary.id,
    name: summary.name,
    machineType: summary.machineType,
    minimumTier: summary.minimumTier,
    durationTicks: summary.durationTicks,
    eut: summary.eut,
    inputs: summary.inputs,
    outputs: summary.outputs,
    programmedCircuit: summary.programmedCircuit,
    source: summary.source,
    nei: summary.nei,
  };
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
  offset,
  limit,
}: {
  versionId: string;
  query: string;
  resource?: Pick<ResourceAmount, "kind" | "id">;
  mode: "recipes" | "uses";
  recipeMap: string;
  maxTier: TierFilter;
  offset: number;
  limit: number;
}) {
  return [
    versionId,
    query.trim().toLowerCase(),
    resource ? `${resource.kind}:${resource.id}` : "",
    mode,
    recipeMap,
    maxTier,
    offset,
    limit,
  ].join("|");
}

function getCachedRecipeQuery(cache: Map<string, RecipeQueryCacheEntry>, key: string) {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return entry.result;
}

function setCachedRecipeQuery(
  cache: Map<string, RecipeQueryCacheEntry>,
  key: string,
  result: RecipeDatasetQueryResult,
) {
  cache.set(key, {
    result,
    expiresAt: Date.now() + RECIPE_QUERY_CACHE_TTL_MS,
  });
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
        if (!existing.iconAtlas && resource.iconAtlas) {
          existing.iconAtlas = resource.iconAtlas;
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
          iconAtlas: resource.iconAtlas,
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

function compareResourcesByRecipeCount(left: IndexedResource, right: IndexedResource) {
  return (
    right.recipeCount - left.recipeCount || resourceLabel(left).localeCompare(resourceLabel(right))
  );
}

function buildRecipeMapTabs(
  recipeMaps: string[],
  resources: Array<DatasetResource | DatasetResourceIndexEntry>,
): RecipeMapTab[] {
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
            iconAtlas: resource.iconAtlas,
          }
        : undefined,
    };
  });
}

function findRecipeMapIcon(
  recipeMap: string,
  resources: Array<DatasetResource | DatasetResourceIndexEntry>,
): DatasetResource | DatasetResourceIndexEntry | undefined {
  const recipeMapTokens = tokenizeRecipeMap(recipeMap);
  const normalizedMap = normalizeText(recipeMap);
  let best: { resource: DatasetResource | DatasetResourceIndexEntry; score: number } | undefined;

  for (const resource of resources) {
    if (resource.kind !== "item" || (!resource.iconPath && !resource.iconAtlas)) {
      continue;
    }

    const label = normalizeText(resource.displayName ?? resource.id);
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
