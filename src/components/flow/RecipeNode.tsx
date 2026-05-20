"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
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
  const utilization = result?.utilization ?? 0;
  const utilizationPercent = Number.isFinite(utilization) ? utilization * 100 : 999;
  const status = result?.status ?? "underutilized";
  const color = getStatusColor(status);

  return (
    <div
      className={[
        "w-[368px] border-2 border-[#f4f4f4] bg-[#c6c6c6] font-mono text-[#202020] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555]",
        selected ? "ring-2 ring-cyan-300" : "",
        color.ring,
      ].join(" ")}
    >
      <div className="px-2 pb-2 pt-1">
        <div className="minecraft-title mb-1 h-6 truncate border-2 border-[#555] bg-[#9b9b9b] px-2 text-center text-[17px] leading-[20px] shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a]">
          {recipe.source?.recipeMap ?? recipe.machineType}
        </div>
        <NeiRecipeWindow
          recipe={recipe}
          scale={2}
          compact
          onSlotClick={(slot, mode) =>
            browseResource(
              {
                kind: slot.resource.kind,
                id: slot.resource.id,
                displayName: slot.resource.displayName,
                iconPath: slot.resource.iconPath,
                anchorNodeId: projectNode.id,
              },
              mode,
            )
          }
          renderHandle={(slot) => {
            const isInput = slot.side === "input";
            if (isInput && !isRecipeInputConsumed(slot.resource)) {
              return null;
            }

            return (
              <Handle
                id={makeResourceHandleId(slot.side, slot.resource, slot.resourceIndex)}
                type={isInput ? "target" : "source"}
                position={isInput ? Position.Left : Position.Right}
                title={`${isInput ? "Input" : "Output"}: ${
                  slot.resource.displayName ?? slot.resource.id
                }`}
                className={[
                  "!h-3 !w-3 !border-2 !border-white",
                  isInput ? "!-left-1.5 !bg-cyan-600" : "!-right-1.5 !bg-emerald-600",
                ].join(" ")}
              />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#777] bg-[#b6b6b6] px-1 shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]">
      <div className="truncate text-[9px] uppercase text-[#424242]">{label}</div>
      <div className="truncate font-bold">{value}</div>
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
