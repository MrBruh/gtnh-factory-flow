"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Cable } from "lucide-react";
import type { FactoryNode, NodeThroughputResult, Recipe } from "@/lib/model/types";
import { formatRate, isRecipeInputConsumed } from "@/lib/model";
import { NeiRecipeWindow } from "@/components/nei/NeiRecipeWindow";
import { makeResourceHandleId } from "./resource-handles";
import { useFactoryStore } from "@/store/factory-store";

export interface RecipeNodeData extends Record<string, unknown> {
  projectNode: FactoryNode;
  recipe: Recipe;
  result?: NodeThroughputResult;
}

export type RecipeFlowNode = Node<RecipeNodeData, "recipeNode">;

export function RecipeNode({ data, selected }: NodeProps<RecipeFlowNode>) {
  const { projectNode, recipe, result } = data;
  const browseResource = useFactoryStore((state) => state.browseResource);
  const autoConnectNode = useFactoryStore((state) => state.autoConnectNode);
  const pendingResourceConnection = useFactoryStore((state) => state.pendingResourceConnection);
  const selectResourceConnectionSlot = useFactoryStore(
    (state) => state.selectResourceConnectionSlot,
  );
  const utilization = result?.utilization ?? 0;
  const utilizationPercent = Number.isFinite(utilization) ? utilization * 100 : 999;
  const status = result?.status ?? "underutilized";
  const color = getStatusColor(status);

  return (
    <div
      className={[
        "group w-[368px] border-2 border-[#f4f4f4] bg-[#c6c6c6] font-mono text-[#202020] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555]",
        selected ? "ring-2 ring-cyan-300" : "",
        color.ring,
      ].join(" ")}
    >
      <div className="px-2 pb-2 pt-1">
        <div className="mb-1 grid grid-cols-[24px_minmax(0,1fr)_24px] items-center">
          <div />
          <div className="minecraft-title h-6 truncate border-2 border-[#555] bg-[#9b9b9b] px-2 text-center text-[17px] leading-[20px] shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a]">
            {recipe.source?.recipeMap ?? recipe.machineType}
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              autoConnectNode(projectNode.id);
            }}
            className="nodrag h-6 w-6 border-2 border-[#252525] bg-[#7d7d7d] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] hover:bg-[#9b9b9b]"
            title="Auto-connect compatible resources"
            aria-label="Auto-connect compatible resources"
          >
            <Cable className="mx-auto h-3.5 w-3.5" />
          </button>
        </div>
        <NeiRecipeWindow
          recipe={recipe}
          scale={2}
          compact
          onSlotClick={(slot, mode) => {
            if (mode === "uses") {
              browseResource(
                {
                  kind: slot.resource.kind,
                  id: slot.resource.id,
                  displayName: slot.resource.displayName,
                  iconPath: slot.resource.iconPath,
                  anchorNodeId: projectNode.id,
                },
                mode,
              );
              return;
            }

            if (slot.side === "input" && !isRecipeInputConsumed(slot.resource)) {
              return;
            }

            selectResourceConnectionSlot({
              nodeId: projectNode.id,
              side: slot.side,
              kind: slot.resource.kind,
              resourceId: slot.resource.id,
              displayName: slot.resource.displayName,
              iconPath: slot.resource.iconPath,
              handleId: makeResourceHandleId(slot.side, slot.resource, slot.resourceIndex),
            });
          }}
          renderHandle={(slot) => {
            const isInput = slot.side === "input";
            if (isInput && !isRecipeInputConsumed(slot.resource)) {
              return null;
            }
            const handleId = makeResourceHandleId(slot.side, slot.resource, slot.resourceIndex);
            const slotState = getConnectionSlotState(
              pendingResourceConnection,
              projectNode.id,
              slot.side,
              slot.resource.kind,
              slot.resource.id,
              handleId,
            );
            const shouldShowHandle = selected || slotState !== "idle";

            return (
              <>
                {slotState !== "idle" ? (
                  <span
                    className={[
                      "pointer-events-none absolute inset-0 z-20",
                      slotState === "selected" ? "ring-2 ring-amber-300" : "",
                      slotState === "compatible" ? "ring-2 ring-cyan-300" : "",
                    ].join(" ")}
                  />
                ) : null}
                <Handle
                  id={handleId}
                  type={isInput ? "target" : "source"}
                  position={isInput ? Position.Left : Position.Right}
                  title={`${isInput ? "Input" : "Output"}: ${
                    slot.resource.displayName ?? slot.resource.id
                  }`}
                  className={[
                    "!h-3 !w-3 !border-2 !border-white transition-opacity",
                    shouldShowHandle
                      ? "!opacity-100"
                      : "!opacity-0 group-hover:!opacity-100",
                    isInput ? "!-left-1.5 !bg-cyan-600" : "!-right-1.5 !bg-emerald-600",
                  ].join(" ")}
                />
              </>
            );
          }}
        />

        <div className="mt-1 grid grid-cols-3 gap-1 text-[12px] leading-4 text-black">
          <Stat label="Machines" value={`${projectNode.machineCount}x`} />
          <Stat label="Usage" value={`${formatRate(utilizationPercent, 1)}%`} />
          <Stat label="EU/t" value={formatRate(result?.euT ?? 0, 0)} />
        </div>
      </div>
    </div>
  );
}

type ConnectionSlotState = "idle" | "selected" | "compatible";

function getConnectionSlotState(
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"],
  nodeId: string,
  side: "input" | "output",
  kind: string,
  resourceId: string,
  handleId: string,
): ConnectionSlotState {
  if (!pending) {
    return "idle";
  }

  if (pending.nodeId === nodeId && pending.handleId === handleId) {
    return "selected";
  }

  if (
    pending.nodeId !== nodeId &&
    pending.side !== side &&
    pending.kind === kind &&
    pending.resourceId === resourceId
  ) {
    return "compatible";
  }

  return "idle";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#777] bg-[#b6b6b6] px-1 shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]">
      <div className="truncate text-[9px] uppercase text-[#424242]">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  );
}

function getStatusColor(status: NodeThroughputResult["status"]) {
  if (status === "balanced") {
    return { ring: "border-emerald-500", spinner: "border-yellow-300" };
  }

  if (status === "bottleneck" || status === "missing-recipe") {
    return { ring: "border-red-500", spinner: "border-red-400" };
  }

  if (status === "disabled") {
    return { ring: "opacity-70", spinner: "border-neutral-500" };
  }

  return { ring: "border-amber-500", spinner: "border-yellow-300" };
}
