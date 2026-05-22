"use client";

import { Power, Trash2, X } from "lucide-react";
import { useMemo } from "react";
import { mergeDatasetAndProjectRecipes } from "@/lib/datasets";
import { formatRate, formatResourceRate, makeResourceKey, primaryOutput } from "@/lib/model";
import type {
  FactoryProject,
  ResourceAmount,
  ResourceBalance,
  ResourceKind,
  TargetRate,
} from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { ResourceIcon } from "./nei/ResourceIcon";

export function InspectorPanel() {
  const project = useFactoryStore((state) => state.project);
  const dataset = useFactoryStore((state) => state.dataset);
  const projectRecipes = useFactoryStore((state) => state.project.recipes);
  const result = useFactoryStore((state) => state.lastResult);
  const selectedNodeId = useFactoryStore((state) => state.selectedNodeId);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const deleteEdge = useFactoryStore((state) => state.deleteEdge);
  const selectFuelProfile = useFactoryStore((state) => state.selectFuelProfile);
  const datasetRecipes = dataset?.recipes;

  const recipes = useMemo(
    () => mergeDatasetAndProjectRecipes(datasetRecipes ?? [], projectRecipes),
    [datasetRecipes, projectRecipes],
  );

  const selectedNode = project.nodes.find((node) => node.id === selectedNodeId);
  const selectedRecipe = selectedNode
    ? recipes.find((recipe) => recipe.id === selectedNode.recipeId)
    : undefined;
  const nodeResult = selectedNode ? result.nodes[selectedNode.id] : undefined;
  const selectedNodeEdges = selectedNode
    ? project.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
    : [];

  if (!selectedNode || !selectedRecipe) {
    return (
      <aside className="flex h-full min-h-[360px] flex-col bg-white">
        <SummaryPanel onSelectFuel={selectFuelProfile} />
      </aside>
    );
  }

  const primary = primaryOutput(selectedRecipe);
  const primaryFlow = primary
    ? nodeResult?.outputs[makeResourceKey(primary.kind, primary.id)]
    : undefined;
  const targetDraft: TargetRate = selectedNode.targetOutput ?? {
    kind: primary?.kind ?? "fluid",
    resourceId: primary?.id ?? "",
    amountPerSecond: nodeResult?.requiredRatePerSecond || nodeResult?.maxRatePerSecond || 1,
    displayName: primary?.displayName,
  };

  const updateTarget = (patch: Partial<TargetRate>) => {
    const nextTarget = {
      ...targetDraft,
      ...patch,
    };

    if (nextTarget.resourceId && nextTarget.amountPerSecond > 0) {
      updateNode(selectedNode.id, { targetOutput: nextTarget });
    } else {
      updateNode(selectedNode.id, { targetOutput: undefined });
    }
  };

  return (
    <aside className="flex h-full min-h-[360px] flex-col bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-neutral-950">
              {selectedRecipe.name}
            </h2>
            <p className="mt-1 truncate text-xs text-neutral-500">
              {selectedRecipe.source?.recipeMap ?? selectedRecipe.machineType}
            </p>
          </div>
          <button
            type="button"
            onClick={() => deleteNode(selectedNode.id)}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-neutral-300 bg-white text-red-700 hover:bg-red-50"
            aria-label="Delete node"
            title="Delete node"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label="Utilization"
              value={`${formatRate((nodeResult?.utilization ?? 0) * 100, 1)}%`}
            />
            <Metric label="Node EU/t" value={formatRate(nodeResult?.euT ?? 0, 0)} />
            <Metric label="Primary output" value={formatResourceRate(primaryFlow)} wide />
            <Metric
              label="Machines required"
              value={formatRate(nodeResult?.theoreticalMachinesRequired ?? 0, 2)}
            />
          </div>

          <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Node settings
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium text-neutral-600">
                Machines
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={selectedNode.machineCount}
                  onChange={(event) =>
                    updateNode(selectedNode.id, { machineCount: toNumber(event.target.value, 0) })
                  }
                  className="h-9 rounded border border-neutral-300 bg-white px-2 text-sm text-neutral-900"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-neutral-600">
                Parallel
                <input
                  type="number"
                  min="0.001"
                  step="1"
                  value={selectedNode.parallel}
                  onChange={(event) =>
                    updateNode(selectedNode.id, { parallel: toNumber(event.target.value, 1) })
                  }
                  className="h-9 rounded border border-neutral-300 bg-white px-2 text-sm text-neutral-900"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-neutral-600">
                Overclock tier
                <input
                  value={selectedNode.overclockTier}
                  onChange={(event) =>
                    updateNode(selectedNode.id, { overclockTier: event.target.value || "DEMO" })
                  }
                  className="h-9 rounded border border-neutral-300 bg-white px-2 text-sm text-neutral-900"
                />
              </label>
              <label className="mt-5 inline-flex h-9 items-center gap-2 rounded border border-neutral-300 bg-white px-3 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={selectedNode.enabled}
                  onChange={(event) =>
                    updateNode(selectedNode.id, { enabled: event.target.checked })
                  }
                />
                <Power className="h-4 w-4" />
                Enabled
              </label>
            </div>
          </div>

          <FlowIOPanel className="rounded border border-neutral-200 bg-neutral-50 p-3" />

          <StorageSummary />

          <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Resource links
              </h3>
            </div>
            {selectedNodeEdges.length === 0 ? (
              <p className="text-sm text-neutral-500">No links yet.</p>
            ) : (
              <div className="space-y-1">
                {selectedNodeEdges.map((edge) => {
                  const isOutput = edge.source === selectedNode.id;
                  const otherNode = project.nodes.find((node) =>
                    isOutput ? node.id === edge.target : node.id === edge.source,
                  );
                  const otherRecipe = recipes.find((recipe) => recipe.id === otherNode?.recipeId);
                  const edgeResult = result.edges[edge.id];
                  const unit = edge.resourceKind === "fluid" ? "L/s" : "/s";
                  const demand = edgeResult?.demandPerSecond ?? edge.ratePerSecond ?? 0;
                  return (
                    <div
                      key={edge.id}
                      className="grid grid-cols-[18px_minmax(0,1fr)_auto_24px] items-center gap-2 rounded border border-neutral-200 bg-white px-2 py-1 text-xs"
                    >
                      <span className="font-semibold text-neutral-500">
                        {isOutput ? ">" : "<"}
                      </span>
                      <span className="min-w-0 truncate text-neutral-800">
                        {edge.label ?? edge.resourceId}
                        <span className="text-neutral-400">
                          {" "}
                          {isOutput ? "to" : "from"} {otherRecipe?.machineType ?? "node"}
                        </span>
                      </span>
                      <span className="font-semibold text-neutral-950">
                        {formatRate(demand, 3)}
                        {unit}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteEdge(edge.id)}
                        className="h-6 w-6 rounded border border-neutral-300 text-neutral-600 hover:bg-red-50 hover:text-red-700"
                        aria-label="Delete link"
                        title="Delete link"
                      >
                        <X className="mx-auto h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Node target output
              </h3>
              <button
                type="button"
                onClick={() => updateNode(selectedNode.id, { targetOutput: undefined })}
                className="inline-flex h-8 items-center gap-1 rounded border border-neutral-300 bg-white px-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-[90px_minmax(0,1fr)_96px]">
              <label className="grid gap-1 text-xs font-medium text-neutral-600">
                Kind
                <select
                  value={targetDraft.kind}
                  onChange={(event) => updateTarget({ kind: event.target.value as ResourceKind })}
                  className="h-9 rounded border border-neutral-300 bg-white px-2 text-sm text-neutral-900"
                >
                  <option value="item">Item</option>
                  <option value="fluid">Fluid</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium text-neutral-600">
                Resource
                <input
                  value={targetDraft.resourceId}
                  onChange={(event) => updateTarget({ resourceId: event.target.value })}
                  className="h-9 rounded border border-neutral-300 bg-white px-2 text-sm text-neutral-900"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-neutral-600">
                Rate/s
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={targetDraft.amountPerSecond}
                  onChange={(event) =>
                    updateTarget({ amountPerSecond: toNumber(event.target.value, 0) })
                  }
                  className="h-9 rounded border border-neutral-300 bg-white px-2 text-sm text-neutral-900"
                />
              </label>
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}

function SummaryPanel({ onSelectFuel }: { onSelectFuel: (fuelProfileId: string) => void }) {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);

  return (
    <>
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-950">Calculation summary</h2>
        <p className="mt-1 text-xs text-neutral-500">Select a dataset recipe or a graph node.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Total EU/t" value={formatRate(result.totalEuT, 0)} />
          <Metric label="EU/s" value={formatRate(result.totalEuPerSecond, 0)} />
          <Metric label="Bottlenecks" value={String(result.bottlenecks.length)} />
          <Metric label="Nodes" value={String(project.nodes.length)} />
        </div>

        <section className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Fuel estimate
          </h3>
          <select
            value={project.selectedFuelProfileId ?? ""}
            onChange={(event) => onSelectFuel(event.target.value)}
            className="mt-2 h-9 w-full rounded border border-neutral-300 bg-white px-2 text-sm text-neutral-900"
          >
            {project.fuelProfiles.map((fuel) => (
              <option key={fuel.id} value={fuel.id}>
                {fuel.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm font-semibold text-neutral-950">
            {result.fuelEstimate
              ? `${formatRate(result.fuelEstimate.fuelPerSecond, 4)} ${result.fuelEstimate.unit}`
              : "No fuel selected"}
          </p>
        </section>

        <FlowIOPanel className="mt-4 rounded border border-neutral-200 bg-white p-3" />
        <StorageSummary className="mt-4" />
      </div>
    </>
  );
}

function FlowIOPanel({ className = "" }: { className?: string }) {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const setRecipeSearch = useFactoryStore((state) => state.setRecipeSearch);
  const browseResource = useFactoryStore((state) => state.browseResource);
  const resourcesByKey = useMemo(() => buildProjectResourceLookup(project), [project]);
  const allBalances = useMemo(
    () =>
      Object.values(result.resources).sort(
        (left, right) =>
          Math.max(right.deficitPerSecond, right.surplusPerSecond) -
          Math.max(left.deficitPerSecond, left.surplusPerSecond),
      ),
    [result.resources],
  );
  const externalInputs = result.externalInputs;
  const finalOutputs = result.unconsumedOutputs;
  const balanced = allBalances
    .filter(
      (balance) =>
        balance.producedPerSecond > 0 &&
        balance.consumedPerSecond > 0 &&
        balance.deficitPerSecond <= 0.000001 &&
        balance.surplusPerSecond <= 0.000001,
    )
    .sort((left, right) => right.consumedPerSecond - left.consumedPerSecond);

  const inspectResource = (balance: ResourceBalance, mode: "recipes" | "uses") => {
    const resource = resourcesByKey.get(balance.key);
    setRecipeSearch(balance.displayName ?? balance.resourceId);
    browseResource(
      {
        kind: balance.kind,
        id: balance.resourceId,
        displayName: balance.displayName,
        iconPath: resource?.iconPath,
        iconAtlas: resource?.iconAtlas,
        dominantColor: resource?.dominantColor ?? resource?.iconAtlas?.dominantColor,
      },
      mode,
    );
  };

  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Flow I/O
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            Global resources entering, leaving, or balanced inside the chart.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRecipeSearch("")}
          className="h-7 shrink-0 rounded border border-neutral-300 bg-white px-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Clear
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1 text-center text-[11px]">
        <FlowCount label="Need" value={externalInputs.length} tone="red" />
        <FlowCount label="Output" value={finalOutputs.length} tone="emerald" />
        <FlowCount label="Internal" value={balanced.length} tone="neutral" />
      </div>

      <FlowIOSection
        title="Needed inputs"
        empty="No missing inputs."
        items={externalInputs}
        resourcesByKey={resourcesByKey}
        mode="uses"
        value={(balance) => balance.deficitPerSecond}
        onInspect={inspectResource}
      />
      <FlowIOSection
        title="Final outputs"
        empty="No unconsumed outputs."
        items={finalOutputs}
        resourcesByKey={resourcesByKey}
        mode="recipes"
        value={(balance) => balance.surplusPerSecond}
        onInspect={inspectResource}
      />
      <FlowIOSection
        title="Balanced internal"
        empty="No balanced internal resources."
        items={balanced}
        resourcesByKey={resourcesByKey}
        mode="uses"
        value={(balance) => balance.consumedPerSecond}
        onInspect={inspectResource}
      />
    </section>
  );
}

function FlowCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "red" | "emerald" | "neutral";
}) {
  const toneClass =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-900"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-neutral-200 bg-neutral-50 text-neutral-800";

  return (
    <div className={["rounded border px-2 py-1", toneClass].join(" ")}>
      <div className="font-semibold">{value}</div>
      <div className="uppercase tracking-wide opacity-70">{label}</div>
    </div>
  );
}

function FlowIOSection({
  title,
  empty,
  items,
  resourcesByKey,
  mode,
  value,
  onInspect,
}: {
  title: string;
  empty: string;
  items: ResourceBalance[];
  resourcesByKey: Map<string, FlowResourceDisplay>;
  mode: "recipes" | "uses";
  value: (balance: ResourceBalance) => number;
  onInspect: (balance: ResourceBalance, mode: "recipes" | "uses") => void;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        <span>{title}</span>
        {items.length > 8 ? <span>Top 8 / {items.length}</span> : null}
      </div>
      {items.length === 0 ? (
        <p className="rounded border border-neutral-200 bg-white px-2 py-2 text-xs text-neutral-500">
          {empty}
        </p>
      ) : (
        <div className="space-y-1">
          {items.slice(0, 8).map((balance) => {
            const resource = resourcesByKey.get(balance.key);
            return (
              <button
                key={balance.key}
                type="button"
                onClick={() => onInspect(balance, mode)}
                className="grid w-full grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2 rounded border border-neutral-200 bg-white px-2 py-1 text-left text-xs hover:border-cyan-300 hover:bg-cyan-50"
                title="Highlight matching nodes and open this resource in the browser"
              >
                <ResourceIcon
                  resource={{
                    kind: balance.kind,
                    id: balance.resourceId,
                    amount: 1,
                    displayName: balance.displayName,
                    iconPath: resource?.iconPath,
                    iconAtlas: resource?.iconAtlas,
                  }}
                  size="sm"
                  showAmount={false}
                  bare
                  tooltip={false}
                  className="!h-6 !w-6"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-neutral-900">
                    {balance.displayName ?? balance.resourceId}
                  </span>
                  <span className="block truncate text-[10px] text-neutral-500">
                    +{formatRate(balance.producedPerSecond, 3)}/s -
                    {formatRate(balance.consumedPerSecond, 3)}/s
                  </span>
                </span>
                <span className="font-semibold text-neutral-950">
                  {formatRate(value(balance), 3)}
                  {balance.kind === "fluid" ? "L/s" : "/s"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type FlowResourceDisplay = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

function buildProjectResourceLookup(project: FactoryProject): Map<string, FlowResourceDisplay> {
  const resources = new Map<string, FlowResourceDisplay>();
  const addResource = (resource: FlowResourceDisplay) => {
    const key = `${resource.kind}:${resource.id}`;
    const existing = resources.get(key);
    if (!existing || (!existing.iconPath && resource.iconPath)) {
      resources.set(key, resource);
    }
  };

  for (const recipe of project.recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) {
      addResource(resource);
    }
  }

  for (const storage of project.storages ?? []) {
    addResource({
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor,
    });
  }

  return resources;
}

function StorageSummary({ className = "" }: { className?: string }) {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const setHoveredStorageResourceKey = useFactoryStore((state) => state.setHoveredStorageResourceKey);
  const storages = project.storages ?? [];

  return (
    <section className={[className, "rounded border border-neutral-200 bg-white p-3"].join(" ")}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Resource buses
      </h3>
      {storages.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">No tank or drawer buses.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {storages.map((storage) => {
            const storageResult = result.storages[storage.id];
            const unit = storage.kind === "fluid" ? "L/s" : "/s";
            const resourceKey = `${storage.kind}:${storage.resourceId}`;
            const producerCount = project.edges.filter((edge) => edge.target === storage.id).length;
            const consumerCount = project.edges.filter((edge) => edge.source === storage.id).length;
            return (
              <div
                key={storage.id}
                onMouseEnter={() => setHoveredStorageResourceKey(resourceKey)}
                onMouseLeave={() => setHoveredStorageResourceKey(undefined)}
                className="grid grid-cols-[34px_minmax(0,1fr)_56px] gap-2 rounded border border-neutral-200 bg-neutral-50 p-2 text-xs"
              >
                <ResourceIcon
                  resource={{ ...storage, id: storage.resourceId, amount: 1 }}
                  size="sm"
                  showAmount={false}
                  bare
                  className="!h-8 !w-8"
                />
                <div className="min-w-0">
                  <div className="truncate font-medium text-neutral-900">
                    {storage.displayName ?? storage.resourceId}
                  </div>
                  <div className="mt-0.5 grid grid-cols-3 gap-1 text-[11px] text-neutral-600">
                    <span>+{formatRate(storageResult?.producedPerSecond ?? 0, 2)}{unit}</span>
                    <span>-{formatRate(storageResult?.consumedPerSecond ?? 0, 2)}{unit}</span>
                    <span>
                      {(storageResult?.netPerSecond ?? 0) >= 0 ? "+" : ""}
                      {formatRate(storageResult?.netPerSecond ?? 0, 2)}{unit}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-neutral-500">
                    {producerCount} in / {consumerCount} out
                  </div>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => deleteStorage(storage.id)}
                    className="h-7 w-8 rounded border border-neutral-300 bg-white text-red-700 hover:bg-red-50"
                    title="Delete bus"
                    aria-label="Delete bus"
                  >
                    <Trash2 className="mx-auto h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div
      className={[
        "rounded border border-neutral-200 bg-neutral-50 p-2",
        wide ? "col-span-2" : "",
      ].join(" ")}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-semibold text-neutral-950">{value}</div>
    </div>
  );
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
