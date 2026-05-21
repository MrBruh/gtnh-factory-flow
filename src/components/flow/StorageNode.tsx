"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { FactoryStorage, StorageThroughputResult } from "@/lib/model/types";
import { formatRate, makeResourceKey } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { makeResourceHandleId } from "./resource-handles";

export interface StorageNodeData extends Record<string, unknown> {
  storage: FactoryStorage;
  result?: StorageThroughputResult;
}

export type StorageFlowNode = Node<StorageNodeData, "storageNode">;

export function StorageNode({ data }: NodeProps<StorageFlowNode>) {
  const { storage, result } = data;
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const hoveredStorageResourceKey = useFactoryStore((state) => state.hoveredStorageResourceKey);
  const setHoveredStorageResourceKey = useFactoryStore(
    (state) => state.setHoveredStorageResourceKey,
  );
  const resourceKey = makeResourceKey(storage.kind, storage.resourceId);
  const isHighlighted = hoveredStorageResourceKey === resourceKey;
  const isSearchHighlighted = storageMatchesSearch(storage, recipeSearch);
  const produced = result?.producedPerSecond ?? 0;
  const consumed = result?.consumedPerSecond ?? 0;
  const net = result?.netPerSecond ?? 0;
  const unit = storage.kind === "fluid" ? "L/s" : "/s";
  const title = storage.displayName ?? storage.resourceId;
  const inputHandleId = makeResourceHandleId("input", {
    kind: storage.kind,
    id: storage.resourceId,
  });
  const outputHandleId = makeResourceHandleId("output", {
    kind: storage.kind,
    id: storage.resourceId,
  });

  return (
    <div
      onMouseEnter={() => setHoveredStorageResourceKey(resourceKey)}
      onMouseLeave={() => setHoveredStorageResourceKey(undefined)}
      className={[
        "group relative text-[#202020]",
        isHighlighted ? "ring-4 ring-cyan-300" : "",
        isSearchHighlighted ? "ring-4 ring-sky-300" : "",
      ].join(" ")}
      title={`${title}\nIn ${formatRate(produced, 3)}${unit}\nOut ${formatRate(consumed, 3)}${unit}\nNet ${net >= 0 ? "+" : ""}${formatRate(net, 3)}${unit}`}
    >
      <Handle
        id={inputHandleId}
        type="target"
        position={Position.Left}
        data-resource-handle="true"
        data-resource-node-id={storage.id}
        data-resource-handle-id={inputHandleId}
        className="nodrag !absolute !bottom-0 !left-0 !top-0 !z-30 !h-full !w-3 !min-w-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id={outputHandleId}
        type="source"
        position={Position.Right}
        data-resource-handle="true"
        data-resource-node-id={storage.id}
        data-resource-handle-id={outputHandleId}
        className="nodrag !absolute !bottom-0 !left-auto !right-0 !top-0 !z-30 !h-full !w-3 !min-w-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-transparent !opacity-0"
      />

      {storage.kind === "fluid" ? (
        <FluidStorageCard
          storage={storage}
          result={result}
          produced={produced}
          consumed={consumed}
          net={net}
          unit={unit}
        />
      ) : (
        <ItemStorageCard
          storage={storage}
          produced={produced}
          consumed={consumed}
          net={net}
          unit={unit}
        />
      )}
    </div>
  );
}

function StorageHeader({
  title,
  variant,
}: {
  title: string;
  variant: "tank" | "drawer";
}) {
  return (
    <div
      className={[
        "flex h-6 items-center gap-1 border-b-2 px-1 shadow-[inset_1px_1px_0_rgba(255,255,255,0.55)]",
        variant === "tank" ? "border-[#747c91] bg-[#b8c1d9]" : "border-[#4f3518] bg-[#8a6030]",
      ].join(" ")}
    >
      <span className="h-4 w-4 border border-[#252525] bg-[#7d7d7d] shadow-[inset_1px_1px_0_rgba(255,255,255,0.35),inset_-1px_-1px_0_rgba(0,0,0,0.45)]" />
      <div className="minecraft-title min-w-0 flex-1 truncate text-center text-[13px] leading-4">
        {title}
      </div>
      <span className="h-4 w-4 border border-[#252525] bg-[#7d7d7d] shadow-[inset_1px_1px_0_rgba(255,255,255,0.35),inset_-1px_-1px_0_rgba(0,0,0,0.45)]" />
    </div>
  );
}

function FluidStorageCard({
  storage,
  result,
  produced,
  consumed,
  net,
  unit,
}: {
  storage: FactoryStorage;
  result?: StorageThroughputResult;
  produced: number;
  consumed: number;
  net: number;
  unit: string;
}) {
  return (
    <div className="w-[174px] border-2 border-[#565f72] bg-[#b9c2d4] p-1 shadow-[0_0_0_3px_#53e5ef,inset_2px_2px_0_#e8edf7,inset_-2px_-2px_0_#7b8497]">
      <StorageHeader title="Super Tank" variant="tank" />
      <div className="border-2 border-[#80889c] bg-[#9fa9bd] p-2 shadow-[inset_2px_2px_0_#d8deeb,inset_-2px_-2px_0_#767f91]">
        <div className="relative h-[92px] border-2 border-[#1a1a1a] bg-black p-1 shadow-[2px_2px_0_#e2e7f0,-2px_-2px_0_#70798b]">
          <div
            className="absolute bottom-1 left-1 right-1 overflow-hidden bg-[#0d3b69]"
            style={{ height: `${Math.max(8, Math.min(82, getFillPercent(result) * 0.82))}px` }}
          >
            <div className="h-full w-full opacity-80 [background:linear-gradient(180deg,#1968ad_0%,#0c5596_38%,#0a3f76_39%,#0b4b86_72%,#07365f_100%)]" />
            <div className="absolute left-2 top-2 h-2 w-24 bg-[#2a87d5]/70" />
            <div className="absolute bottom-3 left-4 h-2 w-12 bg-[#2a87d5]/55" />
          </div>
          <ResourceIcon
            resource={{ ...storage, id: storage.resourceId, amount: 1 }}
            size="sm"
            showAmount={false}
            bare
            className="absolute bottom-2 left-2 !h-8 !w-8 opacity-70"
          />
        </div>
      </div>
      <StorageStats produced={produced} consumed={consumed} net={net} unit={unit} />
    </div>
  );
}

function ItemStorageCard({
  storage,
  produced,
  consumed,
  net,
  unit,
}: {
  storage: FactoryStorage;
  produced: number;
  consumed: number;
  net: number;
  unit: string;
}) {
  return (
    <div className="w-[174px] border-2 border-[#2b1c0e] bg-[#8a6030] p-1 shadow-[0_0_0_3px_#53e5ef,inset_3px_3px_0_#ad7b3e,inset_-3px_-3px_0_#3e2a13]">
      <StorageHeader title="Drawer" variant="drawer" />
      <div className="mx-auto mt-3 grid h-[96px] w-[132px] place-items-center border-2 border-[#3a260f] bg-[#7a5427] shadow-[inset_7px_7px_0_#5a3b1b,inset_-7px_-7px_0_#4a3117]">
        <div className="grid h-[64px] w-[64px] place-items-center border-2 border-[#1f1f1f] bg-[#d8c4b4] shadow-[inset_2px_2px_0_#fff,inset_-2px_-2px_0_#7d6d61]">
          <ResourceIcon
            resource={{ ...storage, id: storage.resourceId, amount: 1 }}
            size="sm"
            showAmount={false}
            bare
            className="!h-12 !w-12"
          />
        </div>
      </div>
      <StorageStats produced={produced} consumed={consumed} net={net} unit={unit} />
    </div>
  );
}

function StorageStats({
  produced,
  consumed,
  net,
  unit,
}: {
  produced: number;
  consumed: number;
  net: number;
  unit: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 pt-2 text-[9px]">
      <StorageStat label="In" value={formatCompact(produced, unit)} />
      <StorageStat label="Out" value={formatCompact(consumed, unit)} />
      <StorageStat label="Net" value={`${net >= 0 ? "+" : ""}${formatCompact(net, unit)}`} />
    </div>
  );
}

function storageMatchesSearch(storage: FactoryStorage, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return false;
  }

  return `${storage.displayName ?? ""} ${storage.resourceId}`
    .toLowerCase()
    .includes(normalizedQuery);
}

function StorageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="h-9 min-w-0 border-2 border-[#707070] bg-[#bababa] px-1 shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]">
      <div className="text-[8px] uppercase leading-[10px] text-[#424242]">{label}</div>
      <div
        className={[
          "whitespace-nowrap font-medium leading-[14px] text-[#111]",
          value.length > 9 ? "text-[8px]" : value.length > 7 ? "text-[9px]" : "text-[11px]",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

function formatCompact(value: number, unit: string) {
  const abs = Math.abs(value);
  if (!Number.isFinite(value) || abs < 0.005) {
    return `0${unit}`;
  }

  if (abs >= 1_000_000) {
    return `${trimFlow(value / 1_000_000)}M${unit}`;
  }

  if (abs >= 1_000) {
    return `${trimFlow(value / 1_000)}k${unit}`;
  }

  return `${trimFlow(value)}${unit}`;
}

function trimFlow(value: number) {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function getFillPercent(result?: StorageThroughputResult) {
  if (!result || result.producedPerSecond <= 0) {
    return 12;
  }

  const ratio = result.consumedPerSecond / result.producedPerSecond;
  return Math.max(18, Math.min(100, 52 + (1 - ratio) * 38));
}
