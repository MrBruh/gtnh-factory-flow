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
  const setHoveredStorageResourceKey = useFactoryStore((state) => state.setHoveredStorageResourceKey);
  const resourceKey = makeResourceKey(storage.kind, storage.resourceId);
  const isHighlighted = hoveredStorageResourceKey === resourceKey;
  const isSearchHighlighted = storageMatchesSearch(storage, recipeSearch);
  const produced = result?.producedPerSecond ?? 0;
  const consumed = result?.consumedPerSecond ?? 0;
  const net = result?.netPerSecond ?? 0;
  const unit = storage.kind === "fluid" ? "L/s" : "/s";

  return (
    <div
      onMouseEnter={() => setHoveredStorageResourceKey(resourceKey)}
      onMouseLeave={() => setHoveredStorageResourceKey(undefined)}
      className={[
        "group relative w-[116px] border-2 border-[#252525] text-[#202020]",
        storage.kind === "fluid"
          ? "bg-[#aeb7cc] shadow-[inset_2px_2px_0_#eef2ff,inset_-2px_-2px_0_#586174]"
          : "bg-[#76552b] shadow-[inset_3px_3px_0_#a67a3e,inset_-3px_-3px_0_#3b2915]",
        isHighlighted ? "ring-4 ring-cyan-300" : "",
        isSearchHighlighted ? "ring-4 ring-sky-300" : "",
      ].join(" ")}
      title={`${storage.displayName ?? storage.resourceId}\nIn ${formatRate(produced, 3)}${unit}\nOut ${formatRate(consumed, 3)}${unit}\nNet ${net >= 0 ? "+" : ""}${formatRate(net, 3)}${unit}`}
    >
      <Handle
        id={makeResourceHandleId("input", { kind: storage.kind, id: storage.resourceId })}
        type="target"
        position={Position.Left}
        className="!-left-1.5 !h-3 !w-3 !border-2 !border-white !bg-cyan-600 !opacity-0 group-hover:!opacity-100"
      />
      <Handle
        id={makeResourceHandleId("output", { kind: storage.kind, id: storage.resourceId })}
        type="source"
        position={Position.Right}
        className="!-right-1.5 !h-3 !w-3 !border-2 !border-white !bg-emerald-600 !opacity-0 group-hover:!opacity-100"
      />

      <div className="flex h-6 items-center gap-1 border-b-2 border-[#565656] bg-[#a9a9a9] px-1 shadow-[inset_1px_1px_0_#dedede]">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            deleteStorage(storage.id);
          }}
          className="nodrag h-4 w-4 border border-[#252525] bg-[#7d7d7d] text-xs leading-[9px] text-white hover:bg-red-700"
          title="Delete bus"
          aria-label="Delete bus"
        >
          -
        </button>
        <div className="minecraft-title min-w-0 flex-1 truncate text-center text-[13px] leading-4">
          {storage.kind === "fluid" ? "Tank Bus" : "Drawer Bus"}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            autoRouteStorage(storage.id);
          }}
          className="nodrag h-4 w-4 border border-[#252525] bg-[#7d7d7d] text-white hover:bg-[#9b9b9b]"
          title="Auto-route matching recipes through this bus"
          aria-label="Auto-route matching recipes through this bus"
        >
          <Cable className="mx-auto h-2.5 w-2.5" />
        </button>
      </div>

      <div className="p-2">
        {storage.kind === "fluid" ? (
          <div className="relative mx-auto h-[58px] w-[42px] border-2 border-[#202020] bg-[#1f2937] shadow-[inset_2px_2px_0_#93a4bf,inset_-2px_-2px_0_#111827]">
            <div
              className="absolute bottom-0 left-0 right-0 bg-cyan-400/70"
              style={{ height: `${getFillPercent(result)}%` }}
            />
            <div className="absolute inset-0 grid place-items-center">
              <ResourceIcon
                resource={{ ...storage, id: storage.resourceId, amount: 1 }}
                size="sm"
                showAmount={false}
                bare
                className="!h-9 !w-9"
              />
            </div>
          </div>
        ) : (
          <div className="mx-auto grid h-[58px] w-[58px] place-items-center border-2 border-[#2b1c0e] bg-[#8f6734] shadow-[inset_4px_4px_0_#6a4b28,inset_-4px_-4px_0_#3e2b16]">
            <div className="grid h-11 w-11 place-items-center border-2 border-[#1f1f1f] bg-[#d8c4b4] shadow-[inset_2px_2px_0_#fff,inset_-2px_-2px_0_#7d6d61]">
              <ResourceIcon
                resource={{ ...storage, id: storage.resourceId, amount: 1 }}
                size="sm"
                showAmount={false}
                bare
                className="!h-9 !w-9"
              />
            </div>
          </div>
        )}

        <div className="mt-1 grid grid-cols-2 gap-1 text-[9px]">
          <StorageStat label="In" value={formatCompact(produced, unit)} />
          <StorageStat label="Out" value={formatCompact(consumed, unit)} />
          <div className="col-span-2">
            <StorageStat label="Net" value={`${net >= 0 ? "+" : ""}${formatCompact(net, unit)}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function storageMatchesSearch(storage: FactoryStorage, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return false;
  }

  return `${storage.displayName ?? ""} ${storage.resourceId}`.toLowerCase().includes(normalizedQuery);
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

function getFillPercent(result?: StorageThroughputResult) {
  if (!result || result.producedPerSecond <= 0) {
    return 12;
  }

  const ratio = result.consumedPerSecond / result.producedPerSecond;
  return Math.max(18, Math.min(100, 52 + (1 - ratio) * 38));
}
