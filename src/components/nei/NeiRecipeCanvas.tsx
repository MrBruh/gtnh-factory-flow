"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Recipe } from "@/lib/model/types";
import {
  getNeiRecipeLayout,
  type NeiOverflowGroup,
  type NeiPositionedSlot,
  type NeiProgressTexture,
  type NeiSlotFrame,
} from "@/lib/nei/layout";
import { ResourceIcon } from "./ResourceIcon";

interface NeiRecipeCanvasProps {
  recipe: Recipe;
  scale?: number;
  className?: string;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
  onSlotClick?: (slot: NeiPositionedSlot, mode: "recipes" | "uses") => void;
}

export function NeiRecipeCanvas({
  recipe,
  scale = 2,
  className = "",
  renderHandle,
  onSlotClick,
}: NeiRecipeCanvasProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const layout = getNeiRecipeLayout(recipe);
  const renderFrames = useMemo(
    () => getRenderFrames(layout.frames, layout.overflowGroups, expandedGroups),
    [expandedGroups, layout.frames, layout.overflowGroups],
  );
  const width = layout.canvas.width * scale;
  const height = getCanvasHeight(renderFrames, layout.logo.y) * scale;
  const slotSize = layout.slotSize * scale;

  return (
    <div
      className={["relative overflow-hidden border border-transparent", className].join(" ")}
      style={{
        width,
        height,
        backgroundImage: "url('/nei/gregtech/gui/background/nei_single_recipe.png')",
        backgroundSize: "100% 100%",
        imageRendering: "pixelated",
      }}
    >
      {layout.progressBars.slice(0, 1).map((bar, index) => (
        <ProgressTexture key={`${bar.x}-${bar.y}-${index}`} bar={bar} scale={scale} />
      ))}

      {renderFrames.map((frame) => (
        <div
          key={`${frame.side}-${frame.kind}-${frame.slotIndex}`}
          className="nodrag absolute"
          style={{
            left: frame.x * scale,
            top: frame.y * scale,
            width: slotSize,
            height: slotSize,
          }}
        >
          <NeiSlotFrameView
            frame={frame}
            renderHandle={renderHandle}
            onSlotClick={onSlotClick}
            onOverflowClick={
              frame.overflowCount
                ? () =>
                    setExpandedGroups((current) => {
                      const next = new Set(current);
                      next.add(getGroupKey(frame));
                      return next;
                    })
                : undefined
            }
          />
        </div>
      ))}

      <div
        className="absolute"
        style={{
          left: layout.logo.x * scale,
          top: layout.logo.y * scale,
          width: 17 * scale,
          height: 17 * scale,
          backgroundImage: "url('/nei/gregtech/gui/picture/gt_logo_17x17_transparent.png')",
          backgroundSize: "100% 100%",
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
}

type RenderFrame = NeiSlotFrame & { overflowCount?: number };

function getRenderFrames(
  frames: NeiSlotFrame[],
  overflowGroups: NeiOverflowGroup[],
  expandedGroups: Set<string>,
): RenderFrame[] {
  if (overflowGroups.length === 0) {
    return frames;
  }

  const groupsByKey = new Map(overflowGroups.map((group) => [getGroupKey(group), group]));

  return frames.flatMap((frame): RenderFrame[] => {
    const group = groupsByKey.get(getGroupKey(frame));
    if (!group || expandedGroups.has(getGroupKey(frame))) {
      return [frame];
    }

    if (frame.slotIndex >= group.capacity) {
      return [];
    }

    if (frame.slotIndex === group.capacity - 1) {
      return [
        {
          ...frame,
          resource: undefined,
          resourceIndex: undefined,
          overflowCount: group.resourceCount - group.capacity + 1,
        },
      ];
    }

    return [frame];
  });
}

function getCanvasHeight(frames: RenderFrame[], logoY: number) {
  const maxSlotBottom = Math.max(0, ...frames.map((frame) => frame.y + 20));
  return Math.max(82, logoY + 19, maxSlotBottom + 2);
}

function getGroupKey(group: Pick<NeiSlotFrame, "side" | "kind">) {
  return `${group.side}:${group.kind}`;
}

function NeiSlotFrameView({
  frame,
  renderHandle,
  onSlotClick,
  onOverflowClick,
}: {
  frame: RenderFrame;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
  onSlotClick?: (slot: NeiPositionedSlot, mode: "recipes" | "uses") => void;
  onOverflowClick?: () => void;
}) {
  const slot = frame.resource ? (frame as NeiPositionedSlot) : undefined;
  const isOverflow = Boolean(frame.overflowCount);

  return (
    <button
      type="button"
      tabIndex={slot || isOverflow ? 0 : -1}
      onClick={(event) => {
        if (isOverflow && onOverflowClick) {
          event.stopPropagation();
          onOverflowClick();
          return;
        }

        if (!slot || !onSlotClick) {
          return;
        }

        event.stopPropagation();
        onSlotClick(slot, "recipes");
      }}
      onContextMenu={(event) => {
        if (isOverflow) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (!slot || !onSlotClick) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onSlotClick(slot, "uses");
      }}
      className={[
        "relative h-full w-full border-0 bg-transparent p-0 text-left",
        (slot && onSlotClick) || isOverflow
          ? "cursor-pointer hover:ring-2 hover:ring-cyan-300"
          : "",
      ].join(" ")}
      style={{
        backgroundImage: `url('${getSlotTexture(frame)}')`,
        backgroundSize: "100% 100%",
        imageRendering: "pixelated",
      }}
    >
      {slot ? renderHandle?.(slot) : null}
      {isOverflow ? (
        <span className="flex h-full w-full items-center justify-center text-[13px] font-bold leading-none text-white [text-shadow:1px_1px_0_#000]">
          ...
        </span>
      ) : null}
      {slot ? (
        <ResourceIcon
          resource={slot.resource}
          size="md"
          showName={false}
          className="!h-full !w-full"
          bare
        />
      ) : null}
    </button>
  );
}

function ProgressTexture({
  bar,
  scale,
}: {
  bar: {
    x: number;
    y: number;
    width: number;
    height: number;
    direction: string;
    texture: NeiProgressTexture;
  };
  scale: number;
}) {
  return (
    <div
      className="absolute"
      style={{
        left: bar.x * scale,
        top: bar.y * scale,
        width: bar.width * scale,
        height: bar.height * scale,
        backgroundImage: "url('/nei/gregtech/gui/progressbar/arrow.png')",
        backgroundPosition: "top left",
        backgroundSize: "100% 200%",
        imageRendering: "pixelated",
      }}
    />
  );
}

function getSlotTexture(frame: NeiSlotFrame) {
  return `/nei/modularui/gui/slot/${frame.kind}.png`;
}
