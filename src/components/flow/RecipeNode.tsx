"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { FactoryNode, NodeThroughputResult, Recipe } from "@/lib/model/types";
import { formatRate } from "@/lib/model";
import { NeiRecipeCanvas } from "@/components/nei/NeiRecipeCanvas";
import { makeResourceHandleId } from "./resource-handles";

export interface RecipeNodeData extends Record<string, unknown> {
  projectNode: FactoryNode;
  recipe: Recipe;
  result?: NodeThroughputResult;
}

export type RecipeFlowNode = Node<RecipeNodeData, "recipeNode">;

export function RecipeNode({ data, selected }: NodeProps<RecipeFlowNode>) {
  const { projectNode, recipe, result } = data;
  const utilization = result?.utilization ?? 0;
  const utilizationPercent = Number.isFinite(utilization) ? utilization * 100 : 999;
  const status = result?.status ?? "underutilized";
  const color = getStatusColor(status);

  return (
    <div
      className={[
        "w-[360px] border-2 border-[#f4f4f4] bg-[#c6c6c6] font-mono text-[#202020] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555]",
        selected ? "ring-2 ring-cyan-300" : "",
        color.ring,
      ].join(" ")}
    >
      <div className="px-2 pb-2 pt-1">
        <div className="grid grid-cols-[22px_minmax(0,1fr)_22px] items-center">
          <div className="h-7 border-2 border-[#252525] bg-[#8f8f8f] text-center text-[16px] leading-5 text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] [text-shadow:1px_1px_0_#000]">
            &lt;
          </div>
          <div className="h-7 truncate border-2 border-[#555] bg-[#9b9b9b] px-2 text-center text-[17px] leading-[24px] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a] [text-shadow:2px_2px_0_#3f3f3f]">
            {recipe.machineType}
          </div>
          <div className="h-7 border-2 border-[#252525] bg-[#8f8f8f] text-center text-[16px] leading-5 text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] [text-shadow:1px_1px_0_#000]">
            &gt;
          </div>
        </div>

        <div className="h-6 truncate border-x-2 border-b-2 border-[#555] bg-[#a7a7a7] px-2 text-center text-[14px] leading-5 text-white shadow-[inset_2px_0_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a] [text-shadow:1px_1px_0_#3f3f3f]">
          {recipe.name}
        </div>

        <NeiRecipeCanvas
          recipe={recipe}
          scale={2}
          className="mt-1"
          renderHandle={(slot) => {
            const isInput = slot.side === "input";
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
