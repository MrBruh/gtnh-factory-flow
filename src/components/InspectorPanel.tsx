"use client";

import { Cable, Power, Trash2, X } from "lucide-react";
import { useMemo } from "react";
import { mergeDatasetAndProjectRecipes } from "@/lib/datasets";
import { formatRate, formatResourceRate, makeResourceKey, primaryOutput } from "@/lib/model";
import type { ResourceKind, TargetRate } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";

export function InspectorPanel() {
  const project = useFactoryStore((state) => state.project);
  const dataset = useFactoryStore((state) => state.dataset);
  const projectRecipes = useFactoryStore((state) => state.project.recipes);
  const result = useFactoryStore((state) => state.lastResult);
  const selectedNodeId = useFactoryStore((state) => state.selectedNodeId);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const deleteEdge = useFactoryStore((state) => state.deleteEdge);
  const autoConnectNode = useFactoryStore((state) => state.autoConnectNode);
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
            <h2 className="truncate text-sm font-semibold text-neutral-950">Selected node</h2>
            <p className="mt-1 truncate text-xs text-neutral-500">{selectedRecipe.name}</p>
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

          <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Resource links
              </h3>
              <button
                type="button"
                onClick={() => autoConnectNode(selectedNode.id)}
                className="inline-flex h-8 items-center gap-1 rounded border border-neutral-300 bg-white px-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                <Cable className="h-3.5 w-3.5" />
                Auto
              </button>
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

        <ResourceSection
          title="External inputs required"
          empty="No external inputs."
          items={result.externalInputs}
        />
        <ResourceSection
          title="Unconsumed outputs"
          empty="No surplus outputs."
          items={result.unconsumedOutputs}
        />
      </div>
    </>
  );
}

function ResourceSection({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{
    key: string;
    displayName?: string;
    resourceId: string;
    surplusPerSecond: number;
    deficitPerSecond: number;
  }>;
}) {
  return (
    <section className="mt-4 rounded border border-neutral-200 bg-white p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">{empty}</p>
      ) : (
        <div className="mt-2 space-y-1">
          {items.slice(0, 10).map((item) => {
            const rate = Math.max(item.surplusPerSecond, item.deficitPerSecond);
            return (
              <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-neutral-700">
                  {item.displayName ?? item.resourceId}
                </span>
                <span className="font-semibold text-neutral-950">{formatRate(rate, 3)}/s</span>
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
