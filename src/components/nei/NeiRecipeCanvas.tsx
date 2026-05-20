"use client";

import type { ReactNode } from "react";
import type { Recipe } from "@/lib/model/types";
import {
  getNeiRecipeLayout,
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
  onSlotClick?: (slot: NeiPositionedSlot) => void;
}

export function NeiRecipeCanvas({
  recipe,
  scale = 2,
  className = "",
  renderHandle,
  onSlotClick,
}: NeiRecipeCanvasProps) {
  const layout = getNeiRecipeLayout(recipe);
  const width = layout.canvas.width * scale;
  const height = layout.canvas.height * scale;
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

      {layout.frames.map((frame) => (
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
          <NeiSlotFrameView frame={frame} renderHandle={renderHandle} onSlotClick={onSlotClick} />
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

function NeiSlotFrameView({
  frame,
  renderHandle,
  onSlotClick,
}: {
  frame: NeiSlotFrame;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
  onSlotClick?: (slot: NeiPositionedSlot) => void;
}) {
  const slot = frame.resource ? (frame as NeiPositionedSlot) : undefined;

  return (
    <button
      type="button"
      tabIndex={slot ? 0 : -1}
      onClick={(event) => {
        if (!slot || !onSlotClick) {
          return;
        }

        event.stopPropagation();
        onSlotClick(slot);
      }}
      className={[
        "relative h-full w-full border-0 bg-transparent p-0 text-left",
        slot && onSlotClick ? "cursor-pointer hover:ring-2 hover:ring-cyan-300" : "",
      ].join(" ")}
      style={{
        backgroundImage: `url('${getSlotTexture(frame)}')`,
        backgroundSize: "100% 100%",
        imageRendering: "pixelated",
      }}
    >
      {slot ? renderHandle?.(slot) : null}
      {slot ? (
        <ResourceIcon
          resource={slot.resource}
          size="md"
          showName={false}
          className="!h-full !w-full"
          bare
        />
      ) : (
        <EmptySlotFrame kind={frame.kind} />
      )}
    </button>
  );
}

function EmptySlotFrame({ kind }: { kind: NeiSlotFrame["kind"] }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundColor: kind === "fluid" ? "#3d3d3d" : "#8d8d8d",
        boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.5), inset -2px -2px 0 rgba(0,0,0,0.45)",
        imageRendering: "pixelated",
      }}
    />
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
