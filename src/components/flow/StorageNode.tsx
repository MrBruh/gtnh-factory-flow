"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { FactoryStorage, StorageThroughputResult } from "@/lib/model/types";
import { formatRate, makeResourceKey } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import { makeResourceHandleId } from "./resource-handles";
import { GT_NODE_COLORS } from "./node-colors";

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
  const storageColor = storage.colorTag ? GT_NODE_COLORS[storage.colorTag] : undefined;
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
      data-storage-node-id={storage.id}
      data-storage-kind={storage.kind}
      data-storage-resource-id={storage.resourceId}
      onMouseEnter={() => setHoveredStorageResourceKey(resourceKey)}
      onMouseLeave={() => setHoveredStorageResourceKey(undefined)}
      className={["group relative text-[#202020]", storageColor ? "storage-node-tinted" : ""].join(
        " ",
      )}
      style={
        storageColor
          ? ({
              "--storage-node-tint": storageColor.panel,
              "--storage-node-tint-header": storageColor.header,
              "--storage-node-tint-border": storageColor.border,
            } as CSSProperties)
          : undefined
      }
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
          isHighlighted={isHighlighted || isSearchHighlighted}
          storageColor={storageColor}
          inputHandleId={inputHandleId}
          outputHandleId={outputHandleId}
        />
      ) : (
        <ItemStorageCard
          storage={storage}
          produced={produced}
          consumed={consumed}
          net={net}
          unit={unit}
          isHighlighted={isHighlighted || isSearchHighlighted}
          storageColor={storageColor}
          inputHandleId={inputHandleId}
          outputHandleId={outputHandleId}
        />
      )}
    </div>
  );
}

function StorageHeader({
  title,
  variant,
  storageColor,
}: {
  title: string;
  variant: "tank" | "drawer";
  storageColor: StorageColor;
}) {
  return (
    <div
      className={[
        "storage-node-header flex h-6 items-center gap-1 border-b-2 px-1 shadow-[inset_1px_1px_0_rgba(255,255,255,0.55)]",
        variant === "tank" ? "border-[#747c91] bg-[#b8c1d9]" : "border-[#4f3518] bg-[#8a6030]",
      ].join(" ")}
      style={{
        backgroundColor: storageColor?.header,
        borderColor: storageColor?.border,
      }}
    >
      <div className="minecraft-title min-w-0 flex-1 truncate text-center text-[13px] leading-4">
        {title}
      </div>
    </div>
  );
}

type StorageColor = (typeof GT_NODE_COLORS)[keyof typeof GT_NODE_COLORS] | undefined;

function FluidStorageCard({
  storage,
  result,
  produced,
  consumed,
  net,
  unit,
  isHighlighted,
  storageColor,
  inputHandleId,
  outputHandleId,
}: {
  storage: FactoryStorage;
  result?: StorageThroughputResult;
  produced: number;
  consumed: number;
  net: number;
  unit: string;
  isHighlighted: boolean;
  storageColor: StorageColor;
  inputHandleId: string;
  outputHandleId: string;
}) {
  return (
    <div
      className={[
        "storage-node-card w-[174px] border-2 border-[#565f72] bg-[#b9c2d4] p-1 shadow-[inset_2px_2px_0_#e8edf7,inset_-2px_-2px_0_#7b8497]",
        isHighlighted ? "brightness-110" : "",
      ].join(" ")}
      style={
        {
          backgroundColor: storageColor?.panel,
          borderColor: storageColor?.border,
          "--storage-node-base": "#b9c2d4",
          "--storage-node-header-base": "#b8c1d9",
          "--storage-node-body-base": "#9fa9bd",
        } as CSSProperties
      }
    >
      <StorageHeader title="Super Tank" variant="tank" storageColor={storageColor} />
      <div
        className="storage-node-body border-2 border-[#80889c] bg-[#9fa9bd] p-2 shadow-[inset_2px_2px_0_#d8deeb,inset_-2px_-2px_0_#767f91]"
        style={{
          backgroundColor: storageColor?.panel,
          borderColor: storageColor?.border,
        }}
      >
        <div className="relative h-[92px] overflow-hidden border-2 border-[#1a1a1a] bg-black shadow-[2px_2px_0_#e2e7f0,-2px_-2px_0_#70798b]">
          <StorageEdgeAnchors
            nodeId={storage.id}
            inputHandleId={inputHandleId}
            outputHandleId={outputHandleId}
          />
          <div
            className="absolute bottom-0 left-0 right-0 overflow-hidden bg-[#0d3b69]"
            style={{ height: `${Math.max(8, Math.min(88, getFillPercent(result) * 0.88))}px` }}
          >
            <ResourceIcon
              resource={{ ...storage, id: storage.resourceId, amount: 1 }}
              size="sm"
              showAmount={false}
              bare
              className="absolute inset-0 !h-full !w-full opacity-85"
            />
          </div>
          <div className="pointer-events-none absolute inset-x-3 top-2 h-1 bg-[#2a87d5]/70" />
          <div className="pointer-events-none absolute bottom-5 left-7 h-2 w-20 bg-[#2a87d5]/55" />
        </div>
      </div>
      <StorageStats
        produced={produced}
        consumed={consumed}
        net={net}
        unit={unit}
        storageColor={storageColor}
      />
    </div>
  );
}

function ItemStorageCard({
  storage,
  produced,
  consumed,
  net,
  unit,
  isHighlighted,
  storageColor,
  inputHandleId,
  outputHandleId,
}: {
  storage: FactoryStorage;
  produced: number;
  consumed: number;
  net: number;
  unit: string;
  isHighlighted: boolean;
  storageColor: StorageColor;
  inputHandleId: string;
  outputHandleId: string;
}) {
  return (
    <div
      className={[
        "storage-node-card w-[174px] border-2 border-[#2b1c0e] bg-[#8a6030] p-1 shadow-[inset_3px_3px_0_#ad7b3e,inset_-3px_-3px_0_#3e2a13]",
        isHighlighted ? "brightness-110" : "",
      ].join(" ")}
      style={
        {
          backgroundColor: storageColor?.panel,
          borderColor: storageColor?.border,
          "--storage-node-base": "#8a6030",
          "--storage-node-header-base": "#8a6030",
          "--storage-node-body-base": "#7a5427",
        } as CSSProperties
      }
    >
      <StorageHeader title="Drawer" variant="drawer" storageColor={storageColor} />
      <div
        className="storage-node-body mx-auto mt-3 grid h-[96px] w-[132px] place-items-center border-2 border-[#3a260f] bg-[#7a5427] shadow-[inset_7px_7px_0_#5a3b1b,inset_-7px_-7px_0_#4a3117]"
        style={{
          backgroundColor: storageColor?.panel,
          borderColor: storageColor?.border,
        }}
      >
        <div className="relative grid h-[64px] w-[64px] place-items-center border-2 border-[#1f1f1f] bg-[#d8c4b4] shadow-[inset_2px_2px_0_#fff,inset_-2px_-2px_0_#7d6d61]">
          <StorageEdgeAnchors
            nodeId={storage.id}
            inputHandleId={inputHandleId}
            outputHandleId={outputHandleId}
          />
          <ResourceIcon
            resource={{ ...storage, id: storage.resourceId, amount: 1 }}
            size="sm"
            showAmount={false}
            bare
            className="!h-12 !w-12"
          />
        </div>
      </div>
      <StorageStats
        produced={produced}
        consumed={consumed}
        net={net}
        unit={unit}
        storageColor={storageColor}
      />
    </div>
  );
}

function StorageEdgeAnchors({
  nodeId,
  inputHandleId,
  outputHandleId,
}: {
  nodeId: string;
  inputHandleId: string;
  outputHandleId: string;
}) {
  return (
    <>
      <span
        data-resource-edge-anchor="true"
        data-resource-node-id={nodeId}
        data-resource-handle-id={inputHandleId}
        className="pointer-events-none absolute inset-0"
      />
      <span
        data-resource-edge-anchor="true"
        data-resource-node-id={nodeId}
        data-resource-handle-id={outputHandleId}
        className="pointer-events-none absolute inset-0"
      />
    </>
  );
}

function StorageStats({
  produced,
  consumed,
  net,
  unit,
  storageColor,
}: {
  produced: number;
  consumed: number;
  net: number;
  unit: string;
  storageColor: StorageColor;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 pt-2 text-[9px]">
      <StorageStat label="In" value={formatCompact(produced, unit)} storageColor={storageColor} />
      <StorageStat label="Out" value={formatCompact(consumed, unit)} storageColor={storageColor} />
      <StorageStat
        label="Net"
        value={`${net >= 0 ? "+" : ""}${formatCompact(net, unit)}`}
        storageColor={storageColor}
      />
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

function StorageStat({
  label,
  value,
  storageColor,
}: {
  label: string;
  value: string;
  storageColor: StorageColor;
}) {
  return (
    <div
      className="storage-node-stat h-9 min-w-0 border-2 border-[#707070] bg-[#bababa] px-1 shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]"
      style={{
        backgroundColor: storageColor?.panel,
        borderColor: storageColor?.border,
      }}
    >
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
