"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useState, type CSSProperties } from "react";
import { AlertTriangle, ChevronDown, WandSparkles } from "lucide-react";
import type {
  FactoryNode,
  MachineTier,
  NodeThroughputResult,
  Recipe,
  ResourceAmount,
} from "@/lib/model/types";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { applyMachineOutputMultipliers } from "@/lib/solver/machine-effects";
import {
  formatRate,
  applyMachineHandlerToRecipe,
  getAdjacentMachineConfigTier,
  GT_VOLTAGE_TIERS,
  getRecipeMachineHandlers,
  getRecipeMachineConfigTierControls,
  getRecipeCoilTierControl,
  getRecipePowerTier,
  getSelectedMachineHandler,
  getVoltageTierIndex,
  isRecipeInputConsumed,
  isVoltageTierAbove,
  makeResourceKey,
  resourceMatchesInput,
  resourceLabel,
  type MachineConfigTierControl,
} from "@/lib/model";
import { NeiRecipeWindow } from "@/components/nei/NeiRecipeWindow";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import type { NeiPositionedSlot } from "@/lib/nei/layout";
import { makeResourceHandleId } from "./resource-handles";
import { useFactoryStore } from "@/store/factory-store";
import { GT_NODE_COLORS } from "./node-colors";
import { GT_TIER_COLORS } from "./tier-colors";

export interface RecipeNodeData extends Record<string, unknown> {
  projectNode: FactoryNode;
  recipe: Recipe;
  result?: NodeThroughputResult;
}

export type RecipeFlowNode = Node<RecipeNodeData, "recipeNode">;

export function RecipeNode({ data, selected }: NodeProps<RecipeFlowNode>) {
  const { projectNode, recipe, result } = data;
  const [isMachineMenuOpen, setIsMachineMenuOpen] = useState(false);
  const [openMachineConfigMenuId, setOpenMachineConfigMenuId] = useState<string>();
  const browseResource = useFactoryStore((state) => state.browseResource);
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const hoveredFlowResourceKey = useFactoryStore((state) => state.hoveredFlowResourceKey);
  const selectedFlowResourceKey = useFactoryStore((state) => state.selectedFlowResourceKey);
  const hoveredNodeBottlenecks = useFactoryStore((state) => state.hoveredNodeBottlenecks);
  const selectedNodeBottlenecks = useFactoryStore((state) => state.selectedNodeBottlenecks);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const updateNode = useFactoryStore((state) => state.updateNode);
  const optimizeMachineCount = useFactoryStore((state) => state.optimizeMachineCount);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const maxTierFilter = useFactoryStore((state) => state.maxTierFilter);
  const pendingResourceConnection = useFactoryStore((state) => state.pendingResourceConnection);
  const dataset = useFactoryStore((state) => state.dataset);
  const utilization = result?.utilization ?? 0;
  const utilizationPercent = Number.isFinite(utilization) ? utilization * 100 : 999;
  const isSearchHighlighted = recipeContainsSearchResource(recipe, recipeSearch);
  const isFlowResourceHighlighted = recipeContainsResourceKey(
    recipe,
    hoveredFlowResourceKey ?? selectedFlowResourceKey,
  );
  const isNodeBottleneckHighlighted =
    (hoveredNodeBottlenecks || selectedNodeBottlenecks) && result?.status === "bottleneck";
  const isInspectorHighlighted = isFlowResourceHighlighted || isNodeBottleneckHighlighted;
  const nodeColor = projectNode.colorTag ? GT_NODE_COLORS[projectNode.colorTag] : undefined;
  const machineHandlers = getRecipeMachineHandlers(recipe);
  const selectedMachineHandler = getSelectedMachineHandler(recipe, projectNode);
  const effectiveRecipe = applyMachineHandlerToRecipe(recipe, projectNode);
  const recipePowerTier = getRecipePowerTier(effectiveRecipe);
  const tierControl = getNodeTierControl(effectiveRecipe, projectNode);
  const coilControl = getRecipeCoilTierControl(effectiveRecipe, projectNode);
  const coilResource = coilControl
    ? resolveDatasetMachineConfigResource(coilControl.resource, dataset)
    : undefined;
  const machineConfigControls = getRecipeMachineConfigTierControls(
    effectiveRecipe,
    projectNode,
  ).map((control) => ({
    ...control,
    resource: resolveDatasetMachineConfigResource(control.resource, dataset),
  }));
  const tgsToolControls = machineConfigControls.filter(isTreeGrowthSimulatorToolControl);
  const statsMachineConfigControls = machineConfigControls.filter(
    (control) => !isTreeGrowthSimulatorToolControl(control),
  );
  const overclockedStats = getOverclockedRecipeStats(recipe, projectNode);
  const displayRecipe = applyTreeGrowthSimulatorToolInputs(effectiveRecipe, tgsToolControls);
  const adjustedRecipe = applyMachineOutputMultipliers(
    displayRecipe,
    projectNode,
    overclockedStats.tier,
  );
  const overclockedRecipe = {
    ...displayRecipe,
    ...adjustedRecipe,
    ...overclockedStats,
  };
  const tierColor = tierControl ? GT_TIER_COLORS[tierControl.current] : undefined;
  const exceedsMaxTier =
    tierControl !== undefined &&
    maxTierFilter !== "all" &&
    isVoltageTierAbove(recipePowerTier, maxTierFilter);
  const updateTier = (direction: -1 | 1) => {
    if (!tierControl) {
      return;
    }

    const nextTier = getAdjacentTier(tierControl.current, tierControl.minimum, direction);
    if (nextTier !== tierControl.current) {
      updateNode(projectNode.id, { overclockTier: nextTier });
    }
  };
  const updateCoilTier = (direction: -1 | 1) => {
    if (!coilControl) {
      return;
    }

    const nextTier = getAdjacentMachineConfigTier(coilControl, direction);
    if (nextTier !== coilControl.current.key) {
      updateNode(projectNode.id, { coilTier: nextTier });
    }
  };
  const updateMachineConfigTier = (controlId: string, nextTier: string) => {
    updateNode(projectNode.id, {
      machineConfigTiers: {
        ...(projectNode.machineConfigTiers ?? {}),
        [controlId]: nextTier,
      },
    });
  };
  const updateMachineHandler = (machineHandlerId: string) => {
    if (machineHandlers.length <= 1) {
      return;
    }

    const nextHandler =
      machineHandlers.find((handler) => handler.id === machineHandlerId) ?? selectedMachineHandler;
    updateNode(projectNode.id, {
      machineHandlerId: nextHandler.id,
      overclockTier: nextHandler.minimumTier,
    });
    setIsMachineMenuOpen(false);
  };

  return (
    <div
      className={[
        "group relative min-w-[368px] w-max border-2 border-[#f4f4f4] bg-[#c6c6c6] font-mono text-[#202020] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555]",
        nodeColorPaintMode !== undefined ? "cursor-crosshair" : "",
        selected ? "ring-2 ring-cyan-300" : "",
        isSearchHighlighted ? "ring-4 ring-sky-300" : "",
        isInspectorHighlighted
          ? "outline outline-4 outline-offset-4 outline-yellow-300 ring-8 ring-cyan-300 [filter:drop-shadow(0_0_16px_rgba(34,211,238,0.95))]"
          : "",
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
          <span>{recipePowerTier} Required</span>
        </div>
      ) : null}
      <div className="px-2 pb-2 pt-1">
        <div
          className={[
            "mb-1 grid min-w-0 items-center",
            machineHandlers.length > 1 && tierControl
              ? "grid-cols-[24px_minmax(0,1fr)_50px_24px]"
              : machineHandlers.length > 1
                ? "grid-cols-[24px_minmax(0,1fr)_24px]"
                : tierControl
                  ? "grid-cols-[24px_minmax(0,1fr)_50px]"
                  : "grid-cols-[24px_minmax(0,1fr)]",
          ].join(" ")}
        >
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
            {selectedMachineHandler.label}
          </div>
          {tierControl && tierColor ? (
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
              className="nodrag h-6 w-[50px] border-2 px-1 text-[11px] font-bold leading-[18px] shadow-[inset_2px_2px_0_rgba(255,255,255,0.55),inset_-2px_-2px_0_rgba(0,0,0,0.45)] hover:brightness-110"
              style={{
                backgroundColor: tierColor.background,
                borderColor: tierColor.border,
                color: tierColor.text,
                textShadow: `1px 1px 0 ${tierColor.shadow}`,
              }}
              title={`Tier ${tierControl.current}. Left click up, right click down.`}
              aria-label={`Tier ${tierControl.current}`}
            >
              {tierControl.current}
            </button>
          ) : null}
          {machineHandlers.length > 1 ? (
            <div className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsMachineMenuOpen((current) => !current);
                }}
                className="nodrag flex h-6 w-6 items-center justify-center border-2 border-[#252525] bg-[#8d8d8d] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] hover:brightness-110"
                title={`Machine: ${selectedMachineHandler.label}`}
                aria-label={`Select machine handler. Current: ${selectedMachineHandler.label}`}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {isMachineMenuOpen ? (
                <div
                  className="nodrag absolute right-0 top-7 z-50 min-w-[180px] border-2 border-[#252525] bg-[#c6c6c6] p-1 text-[11px] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555,4px_4px_0_rgba(0,0,0,0.35)]"
                  onClick={(event) => event.stopPropagation()}
                >
                  {machineHandlers.map((handler) => (
                    <button
                      key={handler.id}
                      type="button"
                      onClick={() => updateMachineHandler(handler.id)}
                      className={[
                        "block w-full truncate border-2 px-2 py-1 text-left font-bold",
                        handler.id === selectedMachineHandler.id
                          ? "border-[#6b4fd1] bg-[#8b70dd] text-white"
                          : "border-[#777] bg-[#d8d8d8] text-black hover:bg-white",
                      ].join(" ")}
                      title={handler.label}
                    >
                      {handler.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div
          className={nodeColor ? "recipe-node-tinted-area" : undefined}
          style={
            nodeColor
              ? ({
                  "--recipe-node-tint": nodeColor.panel,
                  "--recipe-node-tint-header": nodeColor.header,
                  "--recipe-node-tint-border": nodeColor.border,
                } as CSSProperties)
              : undefined
          }
        >
          <NeiRecipeWindow
            recipe={overclockedRecipe}
            scale={2}
            compact
            className={nodeColor ? "recipe-node-nei-tint" : undefined}
            canvasClassName={nodeColor ? "recipe-node-canvas-tint" : undefined}
            statsAction={
              coilControl && coilResource ? (
                <div className="flex gap-1">
                  <MachineConfigButton
                    resource={coilResource}
                    title={`${coilResource.displayName ?? coilControl.current.label}. Left click up, right click down.`}
                    ariaLabel={`Coil ${coilResource.displayName ?? coilControl.current.label}`}
                    onStep={updateCoilTier}
                  />
                  {statsMachineConfigControls.map((control) => (
                    <MachineConfigButton
                      key={control.id}
                      resource={control.resource}
                      title={`${control.resource.displayName ?? control.current.label}. Left click up, right click down.`}
                      ariaLabel={`${control.label} ${control.resource.displayName ?? control.current.label}`}
                      onStep={(direction) =>
                        updateMachineConfigTier(
                          control.id,
                          getAdjacentMachineConfigTier(control, direction),
                        )
                      }
                    />
                  ))}
                </div>
              ) : statsMachineConfigControls.length > 0 ? (
                <div className="flex gap-1">
                  {statsMachineConfigControls.map((control) => (
                    <MachineConfigButton
                      key={control.id}
                      resource={control.resource}
                      title={`${control.resource.displayName ?? control.current.label}. Left click up, right click down.`}
                      ariaLabel={`${control.label} ${control.resource.displayName ?? control.current.label}`}
                      onStep={(direction) =>
                        updateMachineConfigTier(
                          control.id,
                          getAdjacentMachineConfigTier(control, direction),
                        )
                      }
                    />
                  ))}
                </div>
              ) : undefined
            }
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
                  dominantColor:
                    slot.resource.dominantColor ?? slot.resource.iconAtlas?.dominantColor,
                  anchorNodeId: projectNode.id,
                },
                mode,
              );
            }}
            suppressSlotHover={(slot) =>
              Boolean(getTreeGrowthSimulatorToolControlForSlot(slot, tgsToolControls))
            }
            getSlotZIndex={(slot) => {
              const control = getTreeGrowthSimulatorToolControlForSlot(slot, tgsToolControls);
              if (!control) {
                return undefined;
              }
              return openMachineConfigMenuId === control.id ? 130 : 70;
            }}
            renderHandle={(slot) => {
              const tgsToolControl = getTreeGrowthSimulatorToolControlForSlot(
                slot,
                tgsToolControls,
              );
              if (tgsToolControl) {
                return (
                  <TreeGrowthSimulatorToolSlotMenu
                    control={tgsToolControl}
                    dataset={dataset}
                    isOpen={openMachineConfigMenuId === tgsToolControl.id}
                    onOpenChange={(isOpen) =>
                      setOpenMachineConfigMenuId(isOpen ? tgsToolControl.id : undefined)
                    }
                    onSelect={(nextTier) => updateMachineConfigTier(tgsToolControl.id, nextTier)}
                  />
                );
              }

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
                slot.resource.alternatives,
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
                  <MinecraftTooltip
                    label={slot.resource.tooltip ?? slot.resource.displayName ?? slot.resource.id}
                  >
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
                  </MinecraftTooltip>
                </>
              );
            }}
          />
        </div>

        <div
          className={[
            "mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-1 text-[12px] leading-4 text-black",
            nodeColor ? "recipe-node-stat-grid" : "",
          ].join(" ")}
          style={nodeColor ? { backgroundColor: nodeColor.panel } : undefined}
        >
          <MachineCountStat
            machineCount={projectNode.machineCount}
            suggestedMachineCount={getSuggestedMachineCount(result, projectNode.machineCount)}
            onChange={(machineCount) => updateNode(projectNode.id, { machineCount })}
            onOptimize={() => optimizeMachineCount(projectNode.id)}
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

function recipeContainsResourceKey(recipe: Recipe, resourceKey: string | undefined) {
  if (!resourceKey) {
    return false;
  }

  return [...recipe.inputs, ...recipe.outputs].some(
    (resource) =>
      makeResourceKey(resource.kind, resource.id) === resourceKey ||
      resource.alternatives?.some(
        (alternative) => makeResourceKey(alternative.kind, alternative.id) === resourceKey,
      ),
  );
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

type VoltageTier = Exclude<MachineTier, "DEMO">;

function getNodeTierControl(recipe: Recipe, node: FactoryNode) {
  const hasVoltageTier = GT_VOLTAGE_TIERS.some((entry) => entry.tier === recipe.minimumTier);
  if (
    recipe.durationTicks <= 0 ||
    (recipe.eut === 0 && !hasVoltageTier && !isTierDrivenOutputRecipe(recipe))
  ) {
    return undefined;
  }

  const minimum = getOverclockedRecipeStats(recipe, node).minimumTier;
  const current = clampTier(resolveVoltageTier(node.overclockTier, minimum), minimum);
  return { minimum, current };
}

function isTierDrivenOutputRecipe(recipe: Recipe) {
  const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
  return normalizeSearch(recipeMap) === "tree growth simulator";
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

function resolveVoltageTier(value: string, defaultTier: VoltageTier): VoltageTier {
  const tier = GT_VOLTAGE_TIERS.find((entry) => entry.tier === value)?.tier;
  return tier ?? defaultTier;
}

function resolveDatasetMachineConfigResource(
  configuredResource: ResourceAmount,
  dataset: ReturnType<typeof useFactoryStore.getState>["dataset"],
): ResourceAmount {
  const normalizedLabel = normalizeSearch(configuredResource.displayName ?? configuredResource.id);
  const indexed = [...(dataset?.resources ?? []), ...(dataset?.resourceIndex ?? [])].find(
    (resource) =>
      resource.kind === configuredResource.kind &&
      (resource.id === configuredResource.id ||
        normalizeSearch(resource.displayName ?? resource.id) === normalizedLabel),
  );

  if (!indexed) {
    return configuredResource;
  }

  return {
    ...configuredResource,
    id: indexed.id,
    displayName: indexed.displayName ?? configuredResource.displayName,
    iconPath: indexed.iconPath ?? configuredResource.iconPath,
    iconAtlas: indexed.iconAtlas ?? configuredResource.iconAtlas,
    dominantColor: indexed.dominantColor ?? configuredResource.dominantColor,
  };
}

function isTreeGrowthSimulatorToolControl(control: MachineConfigTierControl) {
  return (
    /^tgsToolSlot\d+$/.test(control.id) ||
    (control.id.startsWith("tgs") && control.id.endsWith("Tool"))
  );
}

const TREE_GROWTH_SIMULATOR_TOOL_SLOTS: Record<string, { x: number; y: number }> = {
  tgsToolSlot1: { x: 36, y: 36 },
  tgsToolSlot2: { x: 54, y: 36 },
  tgsToolSlot3: { x: 36, y: 54 },
  tgsToolSlot4: { x: 54, y: 54 },
  tgsLogTool: { x: 36, y: 36 },
  tgsSaplingTool: { x: 54, y: 36 },
  tgsLeavesTool: { x: 36, y: 54 },
  tgsFruitTool: { x: 54, y: 54 },
};

function getTreeGrowthSimulatorToolControlForSlot(
  slot: NeiPositionedSlot,
  controls: MachineConfigTierControl[],
) {
  if (slot.side !== "input" || slot.kind !== "item") {
    return undefined;
  }

  return controls.find((control) => {
    const position = TREE_GROWTH_SIMULATOR_TOOL_SLOTS[control.id];
    return position?.x === slot.x && position.y === slot.y;
  });
}

function applyTreeGrowthSimulatorToolInputs(
  recipe: Recipe,
  controls: MachineConfigTierControl[],
): Recipe {
  if (controls.length === 0) {
    return recipe;
  }

  const inputs = recipe.inputs.map((input) => {
    const matchingControl = controls.find((control) => {
      const position = TREE_GROWTH_SIMULATOR_TOOL_SLOTS[control.id];
      return position?.x === input.neiSlot?.x && position.y === input.neiSlot?.y;
    });

    if (!matchingControl) {
      return input;
    }

    return {
      ...input,
      ...matchingControl.resource,
      amount: 1,
      optional: true,
      consumed: false,
      neiSlot: input.neiSlot,
    };
  });

  return { ...recipe, inputs };
}

function isTreeGrowthSimulatorEmptyTool(control: MachineConfigTierControl) {
  return control.current.key === "none";
}

function TreeGrowthSimulatorToolSlotMenu({
  control,
  dataset,
  isOpen,
  onOpenChange,
  onSelect,
}: {
  control: MachineConfigTierControl;
  dataset: ReturnType<typeof useFactoryStore.getState>["dataset"];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (nextTier: string) => void;
}) {
  const selectedEmpty = isTreeGrowthSimulatorEmptyTool(control);
  const currentTitle = selectedEmpty
    ? `${control.label}: empty`
    : `${control.label}: ${control.resource.displayName ?? control.current.label}`;

  return (
    <span className="absolute inset-0 z-[70] block">
      <span
        role="button"
        tabIndex={0}
        className={[
          "block h-full w-full cursor-pointer",
          isOpen ? "" : "hover:ring-2 hover:ring-cyan-300",
        ].join(" ")}
        title={currentTitle}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!isOpen);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!isOpen);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!isOpen);
        }}
      >
        {selectedEmpty ? (
          <span className="grid h-full w-full place-items-center text-[17px] font-bold leading-none text-white [text-shadow:1px_1px_0_#000]">
            +
          </span>
        ) : null}
      </span>
      {isOpen ? (
        <span
          className="absolute left-0 top-[calc(100%+4px)] z-[120] grid grid-cols-3 gap-2 border-2 border-[#252525] bg-[#c6c6c6] p-2 shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555,4px_4px_0_rgba(0,0,0,0.35)]"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {control.tiers.map((tier) => {
            const isEmpty = tier.key === "none";
            const resource = resolveDatasetMachineConfigResource(tier.resource, dataset);
            return (
              <span
                key={tier.key}
                role="button"
                tabIndex={0}
                className={[
                  "grid h-10 w-10 place-items-center border-2 text-[18px] font-bold leading-none",
                  tier.key === control.current.key
                    ? "border-[#6b4fd1] bg-[#8b70dd] text-white"
                    : "border-[#777] bg-[#d8d8d8] text-black hover:bg-white",
                ].join(" ")}
                title={isEmpty ? "-" : (resource.displayName ?? tier.label)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(tier.key);
                  onOpenChange(false);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(tier.key);
                  onOpenChange(false);
                }}
              >
                {isEmpty ? (
                  <span>-</span>
                ) : (
                  <ResourceIcon
                    resource={resource}
                    bare
                    tooltip={false}
                    showAmount={false}
                    showConsumedState={false}
                    iconPixelSize={46}
                    className="h-9 w-9 !overflow-visible"
                  />
                )}
              </span>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}

function MachineConfigButton({
  resource,
  title,
  ariaLabel,
  onStep,
}: {
  resource: ResourceAmount;
  title: string;
  ariaLabel: string;
  onStep: (direction: -1 | 1) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onStep(1);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onStep(-1);
      }}
      className="nodrag flex h-10 w-10 items-center justify-center border-2 border-[#252525] bg-[#8d8d8d] shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] hover:brightness-110"
      title={title}
      aria-label={ariaLabel}
    >
      <ResourceIcon
        resource={resource}
        bare
        tooltip={false}
        showAmount={false}
        showConsumedState={false}
        iconPixelSize={46}
        className="h-10 w-10 !overflow-visible"
      />
    </button>
  );
}

function getSuggestedMachineCount(result: NodeThroughputResult | undefined, current: number) {
  const exact = result?.theoreticalMachinesRequired;
  if (!Number.isFinite(exact) || exact === undefined || exact <= 0) {
    return Math.max(1, Math.round(current));
  }

  return Math.max(1, Math.ceil(exact));
}

type ConnectionSlotState = "idle" | "selected" | "compatible";

function getConnectionSlotState(
  pending: ReturnType<typeof useFactoryStore.getState>["pendingResourceConnection"],
  nodeId: string,
  side: "input" | "output",
  kind: string,
  resourceId: string,
  alternatives: Recipe["inputs"][number]["alternatives"],
  handleId: string,
): ConnectionSlotState {
  if (!pending) {
    return "idle";
  }

  if (pending.nodeId === nodeId && pending.handleId === handleId) {
    return "selected";
  }

  if (pending.nodeId !== nodeId && pending.side !== side && pending.kind === kind) {
    const pendingResource = {
      kind: pending.kind,
      id: pending.resourceId,
      alternatives: pending.alternatives,
    };
    const slotResource = { kind, id: resourceId, alternatives };
    const input = side === "input" ? slotResource : pendingResource;
    const output = side === "output" ? slotResource : pendingResource;

    if (resourceMatchesInput(output, input)) {
      return "compatible";
    }
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
  onOptimize,
}: {
  machineCount: number;
  suggestedMachineCount: number;
  onChange: (machineCount: number) => void;
  onOptimize: () => void;
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
            onOptimize();
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
