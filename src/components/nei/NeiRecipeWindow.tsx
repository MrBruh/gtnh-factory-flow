"use client";

import type { ReactNode } from "react";
import type { Recipe } from "@/lib/model/types";
import { formatRate, getRecipePowerTier } from "@/lib/model";
import type { NeiPositionedSlot } from "@/lib/nei/layout";
import { NeiRecipeCanvas } from "./NeiRecipeCanvas";

const QUICK_SLOT_PIXEL_SIZE = 40;
const QUICK_SLOT_ICON_PIXEL_SIZE = 64;

interface NeiRecipeWindowProps {
  recipe: Recipe;
  scale?: number;
  className?: string;
  compact?: boolean;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
  getSlotConnectionAttributes?: (slot: NeiPositionedSlot) => Record<string, string> | undefined;
  onSlotClick?: (slot: NeiPositionedSlot, mode: "recipes" | "uses") => void;
}

export function NeiRecipeWindow({
  recipe,
  scale = 2,
  className = "",
  compact = false,
  renderHandle,
  getSlotConnectionAttributes,
  onSlotClick,
}: NeiRecipeWindowProps) {
  const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
  const totalEu = recipe.eut * recipe.durationTicks;
  const seconds = recipe.durationTicks / 20;
  const powerTier = getRecipePowerTier(recipe);

  return (
    <div
      className={[
        "relative inline-block bg-[#c6c6c6] p-1 font-mono text-[#111] shadow-[inset_2px_2px_0_#fff,inset_-2px_-2px_0_#555]",
        compact ? "text-[10px]" : "text-[14px]",
        className,
      ].join(" ")}
      style={{ imageRendering: "pixelated" }}
    >
      <div className="border-2 border-[#f7f7f7] bg-[#c6c6c6] shadow-[inset_-2px_-2px_0_#6f6f6f]">
        {!compact ? (
          <>
            <NeiTitleBar label={recipeMap} compact={compact} />
            <NeiPageBar compact={compact} />
          </>
        ) : null}
        <div className={compact ? "p-1" : "p-2"}>
          <NeiRecipeCanvas
            recipe={recipe}
            scale={scale}
            slotPixelSize={compact ? QUICK_SLOT_PIXEL_SIZE : undefined}
            iconPixelSize={compact ? QUICK_SLOT_ICON_PIXEL_SIZE : undefined}
            renderHandle={renderHandle}
            getSlotConnectionAttributes={getSlotConnectionAttributes}
            onSlotClick={onSlotClick}
          />
        </div>
      </div>

      <div
        className={["mt-1 leading-tight text-black", compact ? "text-[10px]" : "text-[16px]"].join(
          " ",
        )}
      >
        <div>Total: {formatRate(totalEu, 0)} EU</div>
        <div>
          Usage: {formatRate(recipe.eut, 0)} EU/t ({powerTier})
        </div>
        <div>Time: {formatRate(seconds, seconds >= 10 ? 0 : 1)} seconds</div>
      </div>
    </div>
  );
}

function NeiTitleBar({ label, compact }: { label: string; compact: boolean }) {
  return (
    <div
      className={[
        "grid grid-cols-[22px_minmax(0,1fr)_22px] items-center bg-[#8f8f8f] text-center text-white [text-shadow:2px_2px_0_#3f3f3f]",
        compact ? "h-6 text-[12px]" : "h-8 text-[18px]",
      ].join(" ")}
    >
      <NeiArrowButton label="<" />
      <div className="truncate border-y-2 border-[#555] bg-[#9f9f9f] px-2 leading-[1.3] shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a]">
        {label}
      </div>
      <NeiArrowButton label=">" />
    </div>
  );
}

function NeiPageBar({ compact }: { compact: boolean }) {
  return (
    <div
      className={[
        "grid grid-cols-[22px_minmax(0,1fr)_22px] items-center bg-[#8f8f8f] text-center text-white [text-shadow:2px_2px_0_#3f3f3f]",
        compact ? "h-6 text-[12px]" : "h-8 text-[18px]",
      ].join(" ")}
    >
      <NeiArrowButton label="<" />
      <div className="truncate border-b-2 border-[#555] bg-[#a9a9a9] px-2 leading-[1.3] shadow-[inset_2px_0_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a]">
        Page 1/1
      </div>
      <NeiArrowButton label=">" />
    </div>
  );
}

function NeiArrowButton({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center border-2 border-[#252525] bg-[#8f8f8f] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] [text-shadow:1px_1px_0_#000]">
      {label}
    </div>
  );
}
