"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Cable } from "lucide-react";
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
  const deleteStorage = useFactoryStore((state) => state.deleteStorage);
  const autoRouteStorage = useFactoryStore((state) => state.autoRouteStorage);
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
        id={makeResourceHandleId("input", { kind: storage.kind, id: storage.resourceId })}
        type="target"
        position={Position.Left}
        className="nodrag !absolute !bottom-0 !left-0 !top-0 !z-30 !h-full !w-1/2 !min-w-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id={makeResourceHandleId("output", { kind: storage.kind, id: storage.resourceId })}
        type="source"
        position={Position.Right}
        className="nodrag !absolute !bottom-0 !left-1/2 !right-auto !top-0 !z-30 !h-full !w-1/2 !min-w-0 !translate-x-0 !translate-y-0 !rounded-none !border-0 !bg-transparent !opacity-0"
      />

      {storage.kind === "fluid" ? (
        <FluidStorageCard
          storage={storage}
          result={result}
          produced={produced}
          consumed={consumed}
          net={net}
          unit={unit}
          onDelete={() => deleteStorage(storage.id)}
          onAutoRoute={() => autoRouteStorage(storage.id)}
        />
      ) : (
        <ItemStorageCard
          storage={storage}
          produced={produced}
          consumed={consumed}
          net={net}
          unit={unit}
          onDelete={() => deleteStorage(storage.id)}
          onAutoRoute={() => autoRouteStorage(storage.id)}
        />
      )}
    </div>
  );
}

function StorageHeader({
  title,
  onDelete,
  onAutoRoute,
  variant,
}: {
  title: string;
  onDelete: () => void;
  onAutoRoute: () => void;
  variant: "tank" | "drawer";
}) {
  return (
    <div
      className={[
        "flex h-6 items-center gap-1 border-b-2 px-1 shadow-[inset_1px_1px_0_rgba(255,255,255,0.55)]",
        variant === "tank" ? "border-[#747c91] bg-[#b8c1d9]" : "border-[#4f3518] bg-[#8a6030]",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="nodrag h-4 w-4 border border-[#252525] bg-[#7d7d7d] text-xs leading-[9px] text-white hover:bg-red-700"
        title="Delete storage"
        aria-label="Delete storage"
      >
        -
      </button>
      <div className="minecraft-title min-w-0 flex-1 truncate text-center text-[13px] leading-4">
        {title}
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onAutoRoute();
        }}
        className="nodrag h-4 w-4 border border-[#252525] bg-[#7d7d7d] text-white hover:bg-[#9b9b9b]"
        title="Auto-route matching recipes through this storage"
        aria-label="Auto-route matching recipes through this storage"
      >
        <Cable className="mx-auto h-2.5 w-2.5" />
      </button>
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
  onDelete,
  onAutoRoute,
}: {
  storage: FactoryStorage;
  result?: StorageThroughputResult;
  produced: number;
  consumed: number;
  net: number;
  unit: string;
  onDelete: () => void;
  onAutoRoute: () => void;
}) {
  return (
    <div className="w-[154px] border-2 border-[#5f6677] bg-[#aeb7cc] shadow-[inset_3px_3px_0_#e5ebff,inset_-3px_-3px_0_#6a7286]">
      <StorageHeader
        title="Super Tank I"
        variant="tank"
        onDelete={onDelete}
        onAutoRoute={onAutoRoute}
      />
      <div className="grid grid-cols-[1fr_30px] gap-2 p-2">
        <div className="relative h-[74px] border-2 border-[#d7dcef] bg-black p-1 text-white shadow-[inset_-2px_-2px_0_#252525]">
          <div className="minecraft-title text-left text-[13px] leading-[15px]">Fluid Amount</div>
          <div className="minecraft-title text-left text-[16px] leading-[17px]">
            {formatTankAmount(result)}
          </div>
          <div
            className="absolute bottom-1 right-1 w-7 border border-[#111] bg-cyan-400/75"
            style={{ height: `${Math.max(10, Math.min(42, getFillPercent(result) * 0.42))}px` }}
          />
          <div className="absolute bottom-0 right-1 text-[8px] leading-none text-white">16kL</div>
          <ResourceIcon
            resource={{ ...storage, id: storage.resourceId, amount: 1 }}
            size="sm"
            showAmount={false}
            bare
            className="absolute bottom-2 left-2 !h-8 !w-8 opacity-80"
          />
        </div>
        <div className="grid content-start gap-1 pt-1">
          <PortLabel label="IN" active />
          <div className="h-8 border-2 border-[#7b1414] bg-[#2b2b2b] px-1 py-0.5">
            <div className="h-full border-l-2 border-[#d04444]" />
          </div>
          <PortLabel label="OUT" />
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
  onDelete,
  onAutoRoute,
}: {
  storage: FactoryStorage;
  produced: number;
  consumed: number;
  net: number;
  unit: string;
  onDelete: () => void;
  onAutoRoute: () => void;
}) {
  return (
    <div className="w-[132px] border-2 border-[#2b1c0e] bg-[#76552b] shadow-[inset_4px_4px_0_#a67a3e,inset_-4px_-4px_0_#3b2915]">
      <StorageHeader
        title="Drawer"
        variant="drawer"
        onDelete={onDelete}
        onAutoRoute={onAutoRoute}
      />
      <div className="mx-auto mt-2 grid h-[76px] w-[100px] place-items-center border-2 border-[#3a260f] bg-[#8f6734] shadow-[inset_5px_5px_0_#6a4b28,inset_-5px_-5px_0_#3e2b16]">
        <div className="grid h-[54px] w-[54px] place-items-center border-2 border-[#1f1f1f] bg-[#d8c4b4] shadow-[inset_2px_2px_0_#fff,inset_-2px_-2px_0_#7d6d61]">
          <ResourceIcon
            resource={{ ...storage, id: storage.resourceId, amount: 1 }}
            size="sm"
            showAmount={false}
            bare
            className="!h-11 !w-11"
          />
        </div>
      </div>
      <StorageStats produced={produced} consumed={consumed} net={net} unit={unit} />
    </div>
  );
}

function PortLabel({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div
      className={[
        "h-7 border-2 px-1 text-center text-[10px] font-bold leading-[22px]",
        active
          ? "border-[#5a5f70] bg-[#9aa4bd] text-[#d8dcef]"
          : "border-[#777] bg-[#8c8c8c] text-[#cfcfcf]",
      ].join(" ")}
    >
      {label}
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
    <div className="grid grid-cols-3 gap-1 p-2 pt-0 text-[9px]">
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
    <div className="border border-[#555] bg-[#b6b6b6] px-1 shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]">
      <div className="text-[7px] uppercase text-[#424242]">{label}</div>
      <div className="truncate font-medium leading-3">{value}</div>
    </div>
  );
}

function formatCompact(value: number, unit: string) {
  return `${formatRate(value, 2)}${unit}`;
}

function formatTankAmount(result?: StorageThroughputResult) {
  if (!result) {
    return "0";
  }

  return formatRate(Math.max(0, result.storedAmount), 0);
}

function getFillPercent(result?: StorageThroughputResult) {
  if (!result || result.producedPerSecond <= 0) {
    return 12;
  }

  const ratio = result.consumedPerSecond / result.producedPerSecond;
  return Math.max(18, Math.min(100, 52 + (1 - ratio) * 38));
}
