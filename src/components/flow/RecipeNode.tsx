"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Cable, Paintbrush, X } from "lucide-react";
import type {
  FactoryNode,
  FactoryNodeColorTag,
  NodeThroughputResult,
  Recipe,
} from "@/lib/model/types";
import { formatRate, isRecipeInputConsumed, resourceLabel } from "@/lib/model";
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
  const recipeSearch = useFactoryStore((state) => state.recipeSearch);
  const autoConnectNode = useFactoryStore((state) => state.autoConnectNode);
  const deleteNode = useFactoryStore((state) => state.deleteNode);
  const nodeColorPaintMode = useFactoryStore((state) => state.nodeColorPaintMode);
  const setNodeColorPaintMode = useFactoryStore((state) => state.setNodeColorPaintMode);
  const pendingResourceConnection = useFactoryStore((state) => state.pendingResourceConnection);
  const selectResourceConnectionSlot = useFactoryStore(
    (state) => state.selectResourceConnectionSlot,
  );
  const utilization = result?.utilization ?? 0;
  const utilizationPercent = Number.isFinite(utilization) ? utilization * 100 : 999;
  const status = result?.status ?? "underutilized";
  const color = getStatusColor(status);
  const isSearchHighlighted = recipeContainsSearchResource(recipe, recipeSearch);
  const nodeColor = projectNode.colorTag ? GT_NODE_COLORS[projectNode.colorTag] : undefined;

  return (
    <div
      className={[
        "group w-[368px] border-2 border-[#f4f4f4] bg-[#c6c6c6] font-mono text-[#202020] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555]",
        nodeColorPaintMode !== undefined ? "cursor-crosshair" : "",
        selected ? "ring-2 ring-cyan-300" : "",
        isSearchHighlighted ? "ring-4 ring-sky-300" : "",
        nodeColor ? "" : color.ring,
      ].join(" ")}
      style={
        nodeColor
          ? {
              borderColor: nodeColor.border,
              boxShadow: `inset 2px 2px 0 #ffffff, inset -2px -2px 0 #555, 0 0 0 2px ${nodeColor.shadow}`,
            }
          : undefined
      }
    >
      <div className="px-2 pb-2 pt-1">
        <div className="mb-1 grid grid-cols-[24px_minmax(0,1fr)_24px_24px] items-center">
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
          <ColorPickerButton
            activeTag={projectNode.colorTag}
            paintTag={nodeColorPaintMode}
            onPaintModeChange={setNodeColorPaintMode}
          />
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

function ColorPickerButton({
  activeTag,
  paintTag,
  onPaintModeChange,
}: {
  activeTag?: FactoryNodeColorTag;
  paintTag?: FactoryNodeColorTag | null;
  onPaintModeChange: (tag: FactoryNodeColorTag | null | undefined) => void;
}) {
  return (
    <div className="nodrag relative h-6 w-6">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
        }}
        className={[
          "peer h-6 w-6 border-2 border-[#252525] bg-[#7d7d7d] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] hover:bg-[#9b9b9b]",
          paintTag !== undefined ? "bg-[#4f8f4f]" : "",
        ].join(" ")}
        title="Paint recipe nodes"
        aria-label="Paint recipe nodes"
      >
        <Paintbrush className="mx-auto h-3.5 w-3.5" />
      </button>
      <div
        className="absolute right-0 top-6 z-50 hidden w-[156px] grid-cols-5 gap-1 border-2 border-[#252525] bg-[#c6c6c6] p-1 shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555] peer-focus-within:grid hover:grid"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onPaintModeChange(null)}
          className={[
            "flex h-7 w-7 items-center justify-center border-2 bg-[#7d7d7d] text-white shadow-[inset_1px_1px_0_#d8d8d8,inset_-1px_-1px_0_#404040]",
            paintTag === null ? "border-white" : "border-[#252525]",
          ].join(" ")}
          title="Erase colors"
          aria-label="Erase colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {GT_NODE_COLOR_PALETTE.map((entry) => (
          <button
            key={entry.tag}
            type="button"
            onClick={() => onPaintModeChange(entry.tag)}
            className={[
              "h-7 w-7 border-2 shadow-[inset_1px_1px_0_rgba(255,255,255,0.45),inset_-1px_-1px_0_rgba(0,0,0,0.45)]",
              paintTag === entry.tag
                ? "border-white"
                : activeTag === entry.tag
                  ? "border-cyan-200"
                  : "border-[#252525]",
            ].join(" ")}
            style={{ backgroundColor: entry.color.swatch }}
            title={entry.tag}
            aria-label={`Color ${entry.tag}`}
          />
        ))}
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

const GT_NODE_COLORS: Record<
  FactoryNodeColorTag,
  { swatch: string; header: string; border: string; shadow: string }
> = {
  white: { swatch: "#f0f0f0", header: "#d8d8d8", border: "#9f9f9f", shadow: "#f0f0f0" },
  orange: { swatch: "#f9801d", header: "#c96b1e", border: "#914811", shadow: "#f9801d" },
  magenta: { swatch: "#c74ebd", header: "#a8439f", border: "#7d2c76", shadow: "#c74ebd" },
  light_blue: { swatch: "#3ab3da", header: "#3294b5", border: "#1d708e", shadow: "#3ab3da" },
  yellow: { swatch: "#fed83d", header: "#c8a929", border: "#957912", shadow: "#fed83d" },
  lime: { swatch: "#80c71f", header: "#68a31c", border: "#487612", shadow: "#80c71f" },
  pink: { swatch: "#f38baa", header: "#c66f89", border: "#955168", shadow: "#f38baa" },
  gray: { swatch: "#474f52", header: "#565e61", border: "#33383a", shadow: "#474f52" },
  light_gray: { swatch: "#9d9d97", header: "#85857f", border: "#62625e", shadow: "#9d9d97" },
  cyan: { swatch: "#169c9c", header: "#168282", border: "#0e6262", shadow: "#169c9c" },
  purple: { swatch: "#8932b8", header: "#74309a", border: "#562172", shadow: "#8932b8" },
  blue: { swatch: "#3c44aa", header: "#38408c", border: "#252b68", shadow: "#3c44aa" },
  brown: { swatch: "#835432", header: "#70482d", border: "#50331f", shadow: "#835432" },
  green: { swatch: "#5e7c16", header: "#536c16", border: "#394b0d", shadow: "#5e7c16" },
  red: { swatch: "#b02e26", header: "#962a24", border: "#6f1c18", shadow: "#b02e26" },
  black: { swatch: "#1d1d21", header: "#303033", border: "#111114", shadow: "#1d1d21" },
};

const GT_NODE_COLOR_TAGS = [
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black",
] satisfies FactoryNodeColorTag[];

const GT_NODE_COLOR_PALETTE: Array<{
  tag: FactoryNodeColorTag;
  color: (typeof GT_NODE_COLORS)[FactoryNodeColorTag];
}> = GT_NODE_COLOR_TAGS.map((tag) => ({
  tag,
  color: GT_NODE_COLORS[tag],
}));
