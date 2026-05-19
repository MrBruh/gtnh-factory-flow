"use client";

import type { ReactNode } from "react";
import type { Recipe } from "@/lib/model/types";
import { getNeiRecipeLayout, type NeiPositionedSlot } from "@/lib/nei/layout";
import { ResourceIcon } from "./ResourceIcon";

interface NeiRecipeCanvasProps {
  recipe: Recipe;
  scale?: number;
  className?: string;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
}

export function NeiRecipeCanvas({
  recipe,
  scale = 2,
  className = "",
  renderHandle,
}: NeiRecipeCanvasProps) {
  const layout = getNeiRecipeLayout(recipe);
  const width = layout.canvas.width * scale;
  const height = layout.canvas.height * scale;
  const slotSize = layout.slotSize * scale;

  return (
    <div
      className={[
        "relative overflow-hidden border-2 border-[#a2a2a2] bg-[#d0d0d0]",
        "shadow-[inset_2px_2px_0_#efefef,inset_-2px_-2px_0_#9a9a9a]",
        className,
      ].join(" ")}
      style={{ width, height }}
    >
      {layout.progressBars.map((bar, index) => (
        <ProgressGlyph key={`${bar.x}-${bar.y}-${index}`} bar={bar} scale={scale} />
      ))}

      {layout.slots.map((slot) => (
        <div
          key={`${slot.side}-${slot.kind}-${slot.resource.id}-${slot.resourceIndex}`}
          className="nodrag absolute"
          style={{
            left: slot.x * scale,
            top: slot.y * scale,
            width: slotSize,
            height: slotSize,
          }}
        >
          {renderHandle?.(slot)}
          <ResourceIcon
            resource={slot.resource}
            size="md"
            showName={false}
            className="!h-full !w-full"
          />
        </div>
      ))}

      <div
        className="absolute rounded-full border-[6px] border-yellow-300 border-b-transparent"
        style={{
          left: layout.logo.x * scale,
          top: layout.logo.y * scale,
          width: 17 * scale,
          height: 17 * scale,
        }}
      />
    </div>
  );
}

function ProgressGlyph({
  bar,
  scale,
}: {
  bar: { x: number; y: number; width: number; height: number; direction: string };
  scale: number;
}) {
  const width = bar.width * scale;
  const height = bar.height * scale;

  if (bar.direction === "up") {
    return (
      <div
        className="absolute grid place-items-center font-mono font-black leading-none text-[#efefef] [text-shadow:2px_0_0_#8f8f8f,0_2px_0_#8f8f8f]"
        style={{
          left: bar.x * scale,
          top: bar.y * scale,
          width,
          height,
          fontSize: Math.max(16, 14 * scale),
        }}
      >
        ^
      </div>
    );
  }

  return (
    <div
      className="absolute grid place-items-center font-mono font-black leading-none text-[#efefef] [text-shadow:2px_0_0_#8f8f8f,0_2px_0_#8f8f8f]"
      style={{
        left: (bar.x - 4) * scale,
        top: (bar.y - 2) * scale,
        width: width + 8 * scale,
        height: height + 4 * scale,
        fontSize: Math.max(22, 18 * scale),
      }}
    >
      =&gt;
    </div>
  );
}
