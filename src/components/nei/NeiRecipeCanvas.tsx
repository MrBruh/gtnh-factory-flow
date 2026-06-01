"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Recipe, ResourceAmount } from "@/lib/model/types";
import {
  getNeiRecipeLayout,
  type NeiDecoration,
  type NeiOverflowGroup,
  type NeiPositionedSlot,
  type NeiProgressTexture,
  type NeiSlotFrame,
} from "@/lib/nei/layout";
import { ResourceIcon } from "./ResourceIcon";

const SLOT_SIZE = 18;

interface NeiRecipeCanvasProps {
  recipe: Recipe;
  scale?: number;
  slotPixelSize?: number;
  iconPixelSize?: number;
  className?: string;
  hideCollapseControls?: boolean;
  contextResource?: Pick<ResourceAmount, "kind" | "id">;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
  getSlotConnectionAttributes?: (slot: NeiPositionedSlot) => Record<string, string> | undefined;
  onSlotClick?: (slot: NeiPositionedSlot, mode: "recipes" | "uses") => void;
  suppressSlotHover?: (slot: NeiPositionedSlot) => boolean;
  suppressConsumedState?: (slot: NeiPositionedSlot) => boolean;
  getSlotZIndex?: (slot: NeiPositionedSlot) => number | undefined;
  slotTooltip?: boolean;
}

export function NeiRecipeCanvas({
  recipe,
  scale = 2,
  slotPixelSize,
  iconPixelSize,
  className = "",
  hideCollapseControls = false,
  contextResource,
  renderHandle,
  getSlotConnectionAttributes,
  onSlotClick,
  suppressSlotHover,
  suppressConsumedState,
  getSlotZIndex,
  slotTooltip = true,
}: NeiRecipeCanvasProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const layout = useMemo(() => getNeiRecipeLayout(recipe), [recipe]);
  const renderLayout = useMemo(
    () =>
      getRenderLayout(
        layout.frames,
        layout.logo.y,
        layout.overflowGroups,
        expandedGroups,
        hideCollapseControls,
        contextResource,
      ),
    [
      contextResource,
      expandedGroups,
      hideCollapseControls,
      layout.frames,
      layout.logo.y,
      layout.overflowGroups,
    ],
  );
  const renderScale = slotPixelSize ? slotPixelSize / layout.slotSize : scale;
  const width = layout.canvas.width * renderScale;
  const height =
    getCanvasHeight(renderLayout.frames, renderLayout.logoY, layout.canvas.height) * renderScale;
  const slotSize = layout.slotSize * renderScale;
  const renderedIconPixelSize = iconPixelSize ?? slotSize;
  return (
    <div
      className={[
        "minecraft-pixel-art relative overflow-visible border border-transparent",
        className,
      ].join(" ")}
      style={{
        width,
        height,
        backgroundImage: "url('/nei/gregtech/gui/background/nei_single_recipe.png')",
        backgroundSize: "100% 100%",
      }}
    >
      {layout.progressBars.map((bar, index) => (
        <ProgressTexture key={`${bar.x}-${bar.y}-${index}`} bar={bar} scale={renderScale} />
      ))}

      {layout.decorations.map((decoration, index) => (
        <DecorationView
          key={`${decoration.x}-${decoration.y}-${decoration.width}-${decoration.height}-${index}`}
          decoration={decoration}
          scale={renderScale}
        />
      ))}

      {renderLayout.frames.map((frame) => {
        const slot = frame.resource ? (frame as NeiPositionedSlot) : undefined;
        return (
          <div
            key={`${frame.side}-${frame.kind}-${frame.slotIndex}-${frame.x}-${frame.y}-${frame.action ?? "slot"}`}
            className="nodrag absolute"
            style={{
              left: frame.x * renderScale,
              top: frame.y * renderScale,
              width: slotSize,
              height: slotSize,
              zIndex: slot ? getSlotZIndex?.(slot) : undefined,
            }}
          >
            <NeiSlotFrameView
              frame={frame}
              iconPixelSize={renderedIconPixelSize}
              renderHandle={renderHandle}
              getSlotConnectionAttributes={getSlotConnectionAttributes}
              onSlotClick={onSlotClick}
              suppressSlotHover={suppressSlotHover}
              suppressConsumedState={suppressConsumedState}
              slotTooltip={slotTooltip}
              onOverflowClick={
                frame.action === "overflow"
                  ? () =>
                      setExpandedGroups((current) => {
                        const next = new Set(current);
                        next.add(getGroupKey(frame));
                        return next;
                      })
                  : undefined
              }
              onCollapseClick={
                frame.action === "collapse"
                  ? () =>
                      setExpandedGroups((current) => {
                        const next = new Set(current);
                        next.delete(getGroupKey(frame));
                        return next;
                      })
                  : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}

type RenderAction = "overflow" | "collapse";

type RenderFrame = NeiSlotFrame & {
  action?: RenderAction;
  overflowCount?: number;
};

interface VerticalShift {
  thresholdY: number;
  deltaY: number;
}

function getRenderLayout(
  frames: NeiSlotFrame[],
  logoY: number,
  overflowGroups: NeiOverflowGroup[],
  expandedGroups: Set<string>,
  hideCollapseControls: boolean,
  contextResource: Pick<ResourceAmount, "kind" | "id"> | undefined,
): { frames: RenderFrame[]; logoY: number } {
  if (overflowGroups.length === 0 || hideCollapseControls) {
    return { frames, logoY };
  }

  const groupsByKey = new Map(overflowGroups.map((group) => [getGroupKey(group), group]));
  const groupInfos = new Map(
    overflowGroups.map((group) => [getGroupKey(group), getOverflowGroupInfo(frames, group)]),
  );
  const shifts: VerticalShift[] = [];

  for (const group of overflowGroups) {
    const info = groupInfos.get(getGroupKey(group));
    if (!info || !expandedGroups.has(getGroupKey(group))) {
      continue;
    }

    const deltaY = info.expandedBottomY - info.collapsedBottomY;
    if (deltaY > 0) {
      shifts.push({ thresholdY: info.collapsedBottomY, deltaY });
    }
  }

  const renderFrames = frames.flatMap((frame): RenderFrame[] => {
    const group = groupsByKey.get(getGroupKey(frame));
    const groupKey = getGroupKey(frame);
    const info = groupInfos.get(groupKey);

    if (!group || !info) {
      return [{ ...frame, y: applyVerticalShifts(frame.y, shifts) }];
    }

    if (expandedGroups.has(groupKey)) {
      if (frame.slotIndex === group.resourceCount - 1) {
        return hideCollapseControls
          ? [frame]
          : [
              frame,
              {
                ...getCollapseFrame(frame, info.collapsePosition),
              },
            ];
      }

      return [frame];
    }

    if (frame.slotIndex >= group.capacity) {
      return [];
    }

    if (frame.slotIndex === group.capacity - 1) {
      const contextFrame = findContextFrame(frames, group, contextResource);
      return [
        contextFrame
          ? { ...contextFrame, x: frame.x, y: frame.y, slotIndex: frame.slotIndex }
          : {
              ...frame,
              resource: undefined,
              resourceIndex: undefined,
              action: "overflow",
              overflowCount: group.resourceCount - group.capacity + 1,
            },
      ];
    }

    return [frame];
  });

  return {
    frames: renderFrames,
    logoY: applyVerticalShifts(logoY, shifts),
  };
}

function findContextFrame(
  frames: NeiSlotFrame[],
  group: NeiOverflowGroup,
  contextResource: Pick<ResourceAmount, "kind" | "id"> | undefined,
): NeiPositionedSlot | undefined {
  if (!contextResource) {
    return undefined;
  }

  return frames
    .filter((frame): frame is NeiPositionedSlot =>
      Boolean(
        frame.resource &&
        getGroupKey(frame) === getGroupKey(group) &&
        frame.resource.kind === contextResource.kind &&
        resourceIdsAreCompatible(frame.resource.id, contextResource.id),
      ),
    )
    .sort((left, right) => left.slotIndex - right.slotIndex)[0];
}

function resourceIdsAreCompatible(candidateId: string, selectedId: string): boolean {
  if (candidateId === selectedId) {
    return true;
  }

  if (!candidateId.endsWith("@32767")) {
    return false;
  }

  const wildcardBaseId = candidateId.slice(0, -"@32767".length);
  return selectedId === wildcardBaseId || selectedId.startsWith(`${wildcardBaseId}@`);
}

function getOverflowGroupInfo(frames: NeiSlotFrame[], group: NeiOverflowGroup) {
  const groupFrames = frames
    .filter((frame) => getGroupKey(frame) === getGroupKey(group))
    .sort((left, right) => left.slotIndex - right.slotIndex);
  const visibleFrames = groupFrames.slice(0, group.capacity);
  const collapsePosition = getNextGridPosition(groupFrames);
  const collapsedBottomY = Math.max(0, ...visibleFrames.map((frame) => frame.y + SLOT_SIZE));
  const expandedBottomY = Math.max(
    0,
    ...groupFrames.map((frame) => frame.y + SLOT_SIZE),
    collapsePosition.y + SLOT_SIZE,
  );

  return { collapsedBottomY, expandedBottomY, collapsePosition };
}

function getCollapseFrame(
  previousFrame: NeiSlotFrame,
  position: Pick<NeiSlotFrame, "x" | "y" | "slotIndex">,
): RenderFrame {
  return {
    side: previousFrame.side,
    kind: previousFrame.kind,
    slotIndex: position.slotIndex,
    x: position.x,
    y: position.y,
    action: "collapse",
  };
}

function getNextGridPosition(frames: NeiSlotFrame[]): Pick<NeiSlotFrame, "x" | "y" | "slotIndex"> {
  const sortedFrames = [...frames].sort((left, right) => left.slotIndex - right.slotIndex);
  const lastFrame = sortedFrames.at(-1);
  if (!lastFrame) {
    return { x: 0, y: 0, slotIndex: 0 };
  }

  const rowXs = sortedFrames
    .filter((frame) => frame.y === lastFrame.y)
    .map((frame) => frame.x)
    .sort((left, right) => left - right);
  const columns = Math.max(
    1,
    new Set(sortedFrames.filter((frame) => frame.y === sortedFrames[0]?.y).map((frame) => frame.x))
      .size,
  );
  const firstX = Math.min(...sortedFrames.map((frame) => frame.x));
  const nextColumn = rowXs.length % columns;

  return {
    x: firstX + nextColumn * SLOT_SIZE,
    y: rowXs.length >= columns ? lastFrame.y + SLOT_SIZE : lastFrame.y,
    slotIndex: lastFrame.slotIndex + 1,
  };
}

function applyVerticalShifts(y: number, shifts: VerticalShift[]) {
  return shifts.reduce((nextY, shift) => {
    if (y >= shift.thresholdY) {
      return nextY + shift.deltaY;
    }

    return nextY;
  }, y);
}

function getCanvasHeight(frames: RenderFrame[], logoY: number, canvasHeight: number) {
  const maxSlotBottom = Math.max(0, ...frames.map((frame) => frame.y + SLOT_SIZE + 2));
  return Math.max(canvasHeight, 82, logoY + 19, maxSlotBottom + 2);
}

function getGroupKey(group: Pick<NeiSlotFrame, "side" | "kind">) {
  return `${group.side}:${group.kind}`;
}

function NeiSlotFrameView({
  frame,
  iconPixelSize,
  renderHandle,
  getSlotConnectionAttributes,
  onSlotClick,
  suppressSlotHover,
  suppressConsumedState,
  slotTooltip,
  onOverflowClick,
  onCollapseClick,
}: {
  frame: RenderFrame;
  iconPixelSize: number;
  renderHandle?: (slot: NeiPositionedSlot) => ReactNode;
  getSlotConnectionAttributes?: (slot: NeiPositionedSlot) => Record<string, string> | undefined;
  onSlotClick?: (slot: NeiPositionedSlot, mode: "recipes" | "uses") => void;
  suppressSlotHover?: (slot: NeiPositionedSlot) => boolean;
  suppressConsumedState?: (slot: NeiPositionedSlot) => boolean;
  slotTooltip: boolean;
  onOverflowClick?: () => void;
  onCollapseClick?: () => void;
}) {
  const slot = frame.resource ? (frame as NeiPositionedSlot) : undefined;
  const isOverflow = frame.action === "overflow";
  const isCollapse = frame.action === "collapse";
  const shouldSuppressSlotHover = slot ? suppressSlotHover?.(slot) : false;
  const shouldSuppressConsumedState = slot ? suppressConsumedState?.(slot) : false;
  const connectionAttributes = slot ? getSlotConnectionAttributes?.(slot) : undefined;
  const backgroundStyle = {
    backgroundImage: `url('${getSlotTexture(frame)}')`,
    backgroundSize: "100% 100%",
  };

  if (!slot && !isOverflow && !isCollapse) {
    return <div className="h-full w-full" style={backgroundStyle} />;
  }

  return (
    <button
      type="button"
      tabIndex={slot || isOverflow || isCollapse ? 0 : -1}
      {...connectionAttributes}
      onClick={(event) => {
        if (isOverflow && onOverflowClick) {
          event.stopPropagation();
          onOverflowClick();
          return;
        }

        if (isCollapse && onCollapseClick) {
          event.stopPropagation();
          onCollapseClick();
          return;
        }

        if (!slot || !onSlotClick) {
          return;
        }

        event.stopPropagation();
        onSlotClick(slot, "recipes");
      }}
      onContextMenu={(event) => {
        if (isOverflow || isCollapse) {
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
        (slot && onSlotClick && !shouldSuppressSlotHover) || isOverflow || isCollapse
          ? "cursor-pointer hover:ring-2 hover:ring-cyan-300"
          : "",
      ].join(" ")}
      style={backgroundStyle}
    >
      {slot ? renderHandle?.(slot) : null}
      {isOverflow || isCollapse ? (
        <span className="grid h-full w-full place-items-center text-center text-[13px] font-bold leading-none text-white [text-shadow:1px_1px_0_#000]">
          {isOverflow ? "..." : "-"}
        </span>
      ) : null}
      {slot ? (
        <ResourceIcon
          resource={slot.resource}
          size="md"
          showName={false}
          className="!h-full !w-full"
          iconPixelSize={iconPixelSize}
          tooltip={slotTooltip}
          showConsumedState={!shouldSuppressConsumedState}
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
    frame?: number;
  };
  scale: number;
}) {
  const frameOffset = bar.frame === undefined ? undefined : bar.frame * bar.height * scale;
  return (
    <div
      className="absolute"
      style={{
        left: bar.x * scale,
        top: bar.y * scale,
        width: bar.width * scale,
        height: bar.height * scale,
        backgroundImage: `url('/nei/gregtech/gui/progressbar/${bar.texture}.png')`,
        backgroundPosition: frameOffset === undefined ? "top left" : `0 -${frameOffset}px`,
        backgroundSize: frameOffset === undefined ? "100% 200%" : "100% auto",
      }}
    />
  );
}

function DecorationView({ decoration, scale }: { decoration: NeiDecoration; scale: number }) {
  if (decoration.kind === "texture") {
    const scaleX = (decoration.width * scale) / decoration.sourceWidth;
    const scaleY = (decoration.height * scale) / decoration.sourceHeight;
    return (
      <div
        className="pointer-events-none absolute bg-no-repeat"
        style={{
          left: decoration.x * scale,
          top: decoration.y * scale,
          width: decoration.width * scale,
          height: decoration.height * scale,
          opacity: decoration.opacity,
          backgroundImage: `url('${decoration.imagePath}')`,
          backgroundSize: `${decoration.textureWidth * scaleX}px ${
            decoration.textureHeight * scaleY
          }px`,
          backgroundPosition: `-${decoration.sourceX * scaleX}px -${decoration.sourceY * scaleY}px`,
        }}
      />
    );
  }

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: decoration.x * scale,
        top: decoration.y * scale,
        width: decoration.width * scale,
        height: decoration.height * scale,
        backgroundColor: decoration.color,
      }}
    />
  );
}

function getSlotTexture(frame: NeiSlotFrame) {
  return `/nei/modularui/gui/slot/${frame.kind}.png`;
}
