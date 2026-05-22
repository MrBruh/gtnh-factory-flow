"use client";

import { useMemo } from "react";
import { formatRate } from "@/lib/model";
import type {
  FactoryProject,
  ResourceAmount,
  ResourceBalance,
} from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { ResourceIcon } from "./nei/ResourceIcon";

export function InspectorPanel() {
  const selectFuelProfile = useFactoryStore((state) => state.selectFuelProfile);

  return (
    <aside className="flex h-full min-h-[360px] flex-col bg-white">
      <SummaryPanel onSelectFuel={selectFuelProfile} />
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
        <p className="mt-1 text-xs text-neutral-500">Global flow overview.</p>
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

