"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useState } from "react";
import { AlertTriangle, WandSparkles } from "lucide-react";
import type { FactoryNode, MachineTier, NodeThroughputResult, Recipe } from "@/lib/model/types";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import {
  formatRate,
  GT_VOLTAGE_TIERS,
  getRecipePowerTier,
  getVoltageTierIndex,
  isRecipeInputConsumed,
  isVoltageTierAbove,
  resourceLabel,
} from "@/lib/model";
import { NeiRecipeWindow } from "@/components/nei/NeiRecipeWindow";
import { makeResourceHandleId } from "./resource-handles";
import { useFactoryStore } from "@/store/factory-store";
import { GT_NODE_COLORS } from "./node-colors";

export interface RecipeNodeData extends Record<string, unknown> {
  projectNode: FactoryNode;
  recipe: Recipe;
  result?: NodeThroughputResult;
}

export type RecipeFlowNode = Node<RecipeNodeData, "recipeNode">;

export function RecipeNode({ data, selected }: NodeProps<RecipeFlowNode>) {
  const { projectNode, recipe, result } = data;
  const browseResource = useFactoryStore((state) => state.browseResource);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const maxTierFilter = useFactoryStore((state) => state.maxTierFilter);
  const pendingResourceConnection = useFactoryStore((state) => state.pendingResourceConnection);
  const utilization = result?.utilization ?? 0;
  const utilizationPercent = Number.isFinite(utilization) ? utilization * 100 : 999;
  const isSearchHighlighted = recipeContainsSearchResource(recipe, recipeSearch);
  const nodeColor = projectNode.colorTag ? GT_NODE_COLORS[projectNode.colorTag] : undefined;
  const recipePowerTier = getRecipePowerTier(recipe);
  const tierControl = getNodeTierControl(recipe, projectNode);
  const overclockedRecipe = { ...recipe, ...getOverclockedRecipeStats(recipe, projectNode) };
  const exceedsMaxTier =
    maxTierFilter !== "all" && isVoltageTierAbove(recipePowerTier, maxTierFilter);
  const updateTier = (direction: -1 | 1) => {
    const nextTier = getAdjacentTier(tierControl.current, tierControl.minimum, direction);
    if (nextTier !== tierControl.current) {
      updateNode(projectNode.id, { overclockTier: nextTier });
    }
  };

  return (
    <div
      className={[
        "group relative min-w-[368px] w-max border-2 border-[#f4f4f4] bg-[#c6c6c6] font-mono text-[#202020] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555]",
        nodeColorPaintMode !== undefined ? "cursor-crosshair" : "",
        selected ? "ring-2 ring-cyan-300" : "",
        isSearchHighlighted ? "ring-4 ring-sky-300" : "",
        exceedsMaxTier ? "ring-4 ring-red-500" : "",
      ].join(" ")}
      style={
        nodeColor
          ? {
              backgroundColor: nodeColor.panel,
              borderColor: nodeColor.border,
              boxShadow: `inset 2px 2px 0 #ffffff, inset -2px -2px 0 #555, 0 0 0 2px ${nodeColor.shadow}`,
            }
          : undefined
      }
    >
      {exceedsMaxTier ? (
        <div className="pointer-events-none absolute -right-3 -top-3 z-40 flex max-w-[210px] items-center gap-2 border-4 border-red-700 bg-[#facc15] px-2 py-1 font-mono text-[13px] font-black uppercase leading-tight text-red-950 shadow-[4px_4px_0_rgba(0,0,0,0.45)] [text-shadow:1px_1px_0_rgba(255,255,255,0.45)]">
          <AlertTriangle className="h-7 w-7 shrink-0 fill-red-700 text-red-950" />
          <span>
            /!\ {recipePowerTier} required, max {maxTierFilter}
          </span>
        </div>
      ) : null}
      <div className="px-2 pb-2 pt-1">
        <div className="mb-1 grid min-w-0 grid-cols-[24px_minmax(0,1fr)_36px] items-center">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              deleteNode(projectNode.id);
            }}
            className="nodrag h-6 w-6 border-2 border-[#252525] bg-[#7d7d7d] text-base leading-[16px] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] hover:bg-red-700"
            title="Delete node"
            aria-label="Delete node"
          >
            -
          </button>
          <div
            className="minecraft-title h-6 truncate border-2 border-[#555] bg-[#9b9b9b] px-2 text-center text-[17px] leading-[20px] shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a]"
            style={nodeColor ? { backgroundColor: nodeColor.header } : undefined}
          >
            {recipe.source?.recipeMap ?? recipe.machineType}
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              updateTier(1);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              updateTier(-1);
            }}
            className="nodrag h-6 w-9 border-2 border-[#252525] bg-[#7d7d7d] text-[12px] font-bold leading-[18px] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] hover:bg-[#8d8d8d]"
            title={`Tier ${tierControl.current}. Left click up, right click down.`}
            aria-label={`Tier ${tierControl.current}`}
          >
            {tierControl.current}
          </button>
        </div>
        <NeiRecipeWindow
          recipe={overclockedRecipe}
          scale={2}
          compact
          getSlotConnectionAttributes={(slot) => {
            if (slot.side === "input" && !isRecipeInputConsumed(slot.resource)) {
              return undefined;
            }

            const handleId = makeResourceHandleId(slot.side, slot.resource, slot.resourceIndex);
            return {
              "data-resource-handle": "true",
              "data-resource-node-id": projectNode.id,
              "data-resource-handle-id": handleId,
            };
          }}
          onSlotClick={(slot, mode) => {
            browseResource(
              {
                kind: slot.resource.kind,
                id: slot.resource.id,
                displayName: slot.resource.displayName,
                iconPath: slot.resource.iconPath,
                iconAtlas: slot.resource.iconAtlas,
                anchorNodeId: projectNode.id,
              },
              mode,
            );
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
                  data-resource-handle="true"
                  data-resource-node-id={projectNode.id}
                  data-resource-handle-id={handleId}
                  title={`${isInput ? "Input" : "Output"}: ${
                    slot.resource.displayName ?? slot.resource.id
                  }`}
                  className={[
                    "resource-slot-handle nodrag !absolute !left-0 !right-auto !top-0 !z-30 !h-full !w-full !min-w-0 !translate-x-0 !translate-y-0",
                    "!rounded-none !border-0 !bg-transparent !opacity-0",
                    "cursor-crosshair",
                  ].join(" ")}
                />
              </>
            );
          }}
        />

        <div className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-1 text-[12px] leading-4 text-black">
          <MachineCountStat
            machineCount={projectNode.machineCount}
            suggestedMachineCount={getSuggestedMachineCount(result, projectNode.machineCount)}
            onChange={(machineCount) => updateNode(projectNode.id, { machineCount })}
          />
          <Stat label="Usage" value={`${formatRate(utilizationPercent, 1)}%`} />
          <Stat label="EU/t" value={formatRate(result?.euT ?? 0, 0)} />
        </div>
      </div>
    </div>
  );
}

function recipeContainsSearchResource(recipe: Recipe, query: string) {
  const normalizedQuery = normalizeSearch(query);
  if (normalizedQuery.length < 2) {
    return false;
  }

  return [...recipe.inputs, ...recipe.outputs].some((resource) =>
    normalizeSearch(`${resourceLabel(resource)} ${resource.id}`).includes(normalizedQuery),
  );
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

type VoltageTier = Exclude<MachineTier, "DEMO">;

function getNodeTierControl(recipe: Recipe, node: FactoryNode) {
  const minimum = getOverclockedRecipeStats(recipe, node).minimumTier;
  const current = clampTier(resolveVoltageTier(node.overclockTier, minimum), minimum);
  return { minimum, current };
}

function getAdjacentTier(current: VoltageTier, minimum: VoltageTier, direction: -1 | 1) {
  const currentIndex = getVoltageTierIndex(current);
  const minimumIndex = getVoltageTierIndex(minimum);
  const nextIndex = Math.min(
    GT_VOLTAGE_TIERS.length - 1,
    Math.max(minimumIndex, currentIndex + direction),
  );
  return GT_VOLTAGE_TIERS[nextIndex]?.tier ?? current;
}

function clampTier(tier: VoltageTier, minimum: VoltageTier) {
  return getVoltageTierIndex(tier) < getVoltageTierIndex(minimum) ? minimum : tier;
}

function resolveVoltageTier(value: string, fallback: VoltageTier): VoltageTier {
  const tier = GT_VOLTAGE_TIERS.find((entry) => entry.tier === value)?.tier;
  return tier ?? fallback;
}

function getSuggestedMachineCount(result: NodeThroughputResult | undefined, current: number) {
  const exact = result?.theoreticalMachinesRequired;
  if (!Number.isFinite(exact) || exact === undefined || exact <= 0) {
    return Math.max(1, Math.round(current));
  }

  return Math.max(1, Math.round(exact));
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
    <div className="min-w-0 border border-[#777] bg-[#b6b6b6] px-1 shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]">
      <div className="truncate text-[9px] uppercase text-[#424242]">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  );
}

function MachineCountStat({
  machineCount,
  suggestedMachineCount,
  onChange,
}: {
  machineCount: number;
  suggestedMachineCount: number;
  onChange: (machineCount: number) => void;
}) {
  const machineCountText = String(machineCount);
  const [draftState, setDraftState] = useState({
    machineCount,
    draft: machineCountText,
  });
  const draft = draftState.machineCount === machineCount ? draftState.draft : machineCountText;

  const commitDraft = (value: string) => {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) {
      return;
    }

    const next = Math.max(1, Number.parseInt(normalized, 10));
    if (Number.isFinite(next) && next !== machineCount) {
      setDraftState({ machineCount: next, draft: String(next) });
      onChange(next);
    }
  };

  return (
    <div className="min-w-0 border border-[#777] bg-[#b6b6b6] px-1 shadow-[inset_1px_1px_0_#eeeeee,inset_-1px_-1px_0_#777]">
      <div className="truncate text-[9px] uppercase text-[#424242]">Machines</div>
      <div className="flex min-w-0 items-center gap-1">
        <input
          value={draft}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraftState({ machineCount, draft: nextDraft });
            commitDraft(nextDraft);
          }}
          onBlur={() => {
            if (!/^\d+$/.test(draft.trim())) {
              setDraftState({ machineCount, draft: machineCountText });
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          inputMode="numeric"
          aria-label="Machine count"
          title="Edit machine count"
          className="nodrag h-[18px] w-0 min-w-0 flex-1 border border-[#777] bg-[#d8d8d8] px-1 text-[12px] font-medium leading-4 text-black shadow-[inset_1px_1px_0_#ffffff,inset_-1px_-1px_0_#8a8a8a] outline-none focus:border-cyan-700 focus:bg-white focus:ring-1 focus:ring-cyan-400"
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setDraftState({
              machineCount: suggestedMachineCount,
              draft: String(suggestedMachineCount),
            });
            onChange(suggestedMachineCount);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="nodrag flex h-4 w-4 shrink-0 items-center justify-center border border-[#555] bg-[#d0d0d0] text-[#202020] shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#777] hover:bg-white"
          title={`Set to ${suggestedMachineCount}x`}
          aria-label={`Set machines to ${suggestedMachineCount}`}
        >
          <WandSparkles className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
