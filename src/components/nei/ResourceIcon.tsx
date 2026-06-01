"use client";

import type { CSSProperties } from "react";
import type { ResourceAmount, ResourceIconAtlasRef, ResourceKind } from "@/lib/model/types";
import {
  formatNumberWithThousands,
  resourceLabel,
  stripOreDictionaryPrefix,
  trimTrailingDecimalZeros,
} from "@/lib/model/resources";
import { MinecraftTooltip } from "./MinecraftTooltip";

type DisplayResourceAmount = Pick<
  ResourceAmount,
  "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "tooltip" | "alternatives"
> & {
  consumed?: boolean;
  chance?: number;
};

interface ResourceIconProps {
  resource?: DisplayResourceAmount;
  size?: "sm" | "md" | "lg" | "xl";
  showAmount?: boolean;
  showName?: boolean;
  bare?: boolean;
  className?: string;
  tooltip?: boolean;
  iconPixelSize?: number;
  showConsumedState?: boolean;
}

const sizeClasses = {
  sm: "h-9 w-9",
  md: "h-12 w-12",
  lg: "h-14 w-14",
  xl: "h-20 w-20",
};

export function ResourceIcon({
  resource,
  size = "md",
  showAmount = true,
  showName = false,
  bare = false,
  className = "",
  tooltip = true,
  iconPixelSize,
  showConsumedState = true,
}: ResourceIconProps) {
  const title = buildTooltipLabel(resource);
  const icon = (
    <div
      className={[
        "relative flex shrink-0 items-center justify-center overflow-hidden",
        bare
          ? ""
          : "border border-[#373737] bg-[#8d8d8d] shadow-[inset_2px_2px_0_#cfcfcf,inset_-2px_-2px_0_#4d4d4d]",
        sizeClasses[size],
        resource || bare
          ? ""
          : "bg-[#3a3a3a] opacity-100 shadow-[inset_1px_1px_0_#5d5d5d,inset_-1px_-1px_0_#1f1f1f]",
        className,
      ].join(" ")}
    >
      <IconImage resource={resource} iconPixelSize={iconPixelSize} />

      {resource && showAmount ? <AmountLabel resource={resource} /> : null}
      {resource?.chance !== undefined ? <ChanceLabel chance={resource.chance} /> : null}

      {showConsumedState && resource?.consumed === false ? (
        <span
          title="Not consumed"
          className="absolute left-0 top-0 font-mono text-[8px] font-black leading-none text-[#ffff55] drop-shadow-[1px_1px_0_#000]"
        >
          NC
        </span>
      ) : null}

      {resource && shouldShowAlternativeMarker(resource) ? (
        <span className="absolute left-0 bottom-0 font-mono text-[9px] font-black leading-none text-[#55ffff] drop-shadow-[1px_1px_0_#000]">
          +
        </span>
      ) : null}

      {resource && showName ? (
        <span className="absolute left-0.5 top-0.5 max-w-[calc(100%-4px)] truncate font-mono text-[8px] leading-none text-white drop-shadow-[1px_1px_0_#000]">
          {resourceLabel(resource)}
        </span>
      ) : null}
    </div>
  );

  if (!tooltip) {
    return icon;
  }

  return <MinecraftTooltip label={title}>{icon}</MinecraftTooltip>;
}

function shouldShowAlternativeMarker(resource: DisplayResourceAmount): boolean {
  return Boolean(
    resource.alternatives?.some((alternative) => !isFluidCellAlternative(resource, alternative)),
  );
}

function isFluidCellAlternative(
  resource: DisplayResourceAmount,
  alternative: NonNullable<DisplayResourceAmount["alternatives"]>[number],
): boolean {
  return (
    (resource.kind === "item" && alternative.kind === "fluid") ||
    (resource.kind === "fluid" && alternative.kind === "item")
  );
}

function buildTooltipLabel(resource: ResourceIconProps["resource"]) {
  if (!resource) {
    return undefined;
  }

  const baseLines = resource.tooltip?.length
    ? [
        resourceLabel(resource),
        ...resource.tooltip.filter(
          (line) => stripOreDictionaryPrefix(line) && !isNbtTooltipLine(line),
        ),
      ]
    : [resourceLabel(resource)].filter(Boolean);
  const chanceLine =
    resource.chance !== undefined && Number.isFinite(resource.chance) && resource.chance < 1
      ? `Chance: ${trimAmount(resource.chance * 100)}%`
      : undefined;
  const consumedLine =
    resource.consumed === false && !resource.tooltip?.some(isNotConsumedTooltipLine)
      ? "Not consumed"
      : undefined;
  const visibleAlternatives =
    resource.alternatives?.filter(
      (alternative) => !isFluidCellAlternative(resource, alternative),
    ) ?? [];
  const alternativesLine = visibleAlternatives.length
    ? `Accepts: ${visibleAlternatives
        .slice(0, 12)
        .map((alternative) => resourceLabel(alternative))
        .join(
          ", ",
        )}${visibleAlternatives.length > 12 ? `, +${visibleAlternatives.length - 12} more` : ""}`
    : undefined;

  return [...baseLines, alternativesLine, chanceLine, consumedLine].filter(Boolean).join("\n");
}

function isNotConsumedTooltipLine(line: string) {
  const normalized = line.toLowerCase();
  return normalized.includes("not consumed") || normalized.includes("does not get consumed");
}

function isNbtTooltipLine(line: string) {
  return line.trim().toLowerCase().startsWith("nbt:");
}

function ChanceLabel({ chance }: { chance: number }) {
  if (!Number.isFinite(chance) || chance >= 1) {
    return null;
  }

  const label = `${trimAmount(chance * 100)}%`;
  return (
    <span className="absolute left-0 top-0 max-w-[95%] truncate font-mono text-[8px] font-black leading-none text-[#ffff55] drop-shadow-[1px_1px_0_#000]">
      {label}
    </span>
  );
}

function IconImage({
  resource,
  iconPixelSize,
}: {
  resource?: Pick<ResourceAmount, "id" | "displayName" | "iconPath" | "iconAtlas">;
  iconPixelSize?: number;
}) {
  if (!resource) {
    return null;
  }

  const atlas = resource.iconAtlas;
  if (atlas) {
    return <AtlasIconImage resource={resource} atlas={atlas} iconPixelSize={iconPixelSize} />;
  }

  if (!resource.iconPath) {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resource.iconPath}
      alt={resourceLabel(resource)}
      className={
        iconPixelSize
          ? "minecraft-pixel-art max-w-none object-contain"
          : "minecraft-pixel-art h-[calc(200%-8px)] w-[calc(200%-8px)] max-w-none object-contain"
      }
      style={{
        ...(iconPixelSize ? { width: iconPixelSize, height: iconPixelSize } : undefined),
      }}
    />
  );
}

function AtlasIconImage({
  resource,
  atlas,
  iconPixelSize,
}: {
  resource: Pick<ResourceAmount, "id" | "displayName">;
  atlas: ResourceIconAtlasRef;
  iconPixelSize?: number;
}) {
  const positionX = getAtlasBackgroundPosition(atlas.x, atlas.atlasWidth, atlas.width);
  const positionY = getAtlasBackgroundPosition(atlas.y, atlas.atlasHeight, atlas.height);

  return (
    <span
      role="img"
      aria-label={resourceLabel(resource)}
      className={
        iconPixelSize
          ? "minecraft-pixel-art block max-w-none bg-no-repeat"
          : "minecraft-pixel-art block h-[calc(200%-8px)] w-[calc(200%-8px)] max-w-none bg-no-repeat"
      }
      style={{
        ...(iconPixelSize ? { width: iconPixelSize, height: iconPixelSize } : undefined),
        backgroundImage: `url('${atlas.imagePath}')`,
        backgroundSize: `${(atlas.atlasWidth / atlas.width) * 100}% ${
          (atlas.atlasHeight / atlas.height) * 100
        }%`,
        backgroundPosition: `${positionX} ${positionY}`,
      }}
    />
  );
}

function getAtlasBackgroundPosition(offset: number, atlasSize: number, iconSize: number) {
  const travel = atlasSize - iconSize;
  if (travel <= 0) {
    return "0%";
  }

  return `${(offset / travel) * 100}%`;
}

function AmountLabel({ resource }: { resource: Pick<ResourceAmount, "kind" | "amount"> }) {
  const label = formatMinecraftAmount(resource.amount, resource.kind);
  if (!label) {
    return null;
  }

  const position =
    resource.kind === "fluid" ? "bottom-0 left-0.5" : "bottom-0 right-0.5 text-right";
  const style = getAmountLabelStyle(label, resource.kind);

  return (
    <span
      className={[
        "absolute max-w-[95%] whitespace-nowrap font-mono font-black text-white drop-shadow-[1px_1px_0_#000]",
        position,
      ].join(" ")}
      style={style}
    >
      {label}
    </span>
  );
}

function getAmountLabelStyle(label: string, kind: ResourceKind): CSSProperties {
  const length = label.length;
  const fontSize = length <= 4 ? 10 : length <= 6 ? 8 : length <= 9 ? 6 : 5;
  const scaleX = length <= 9 ? 1 : length <= 12 ? 0.9 : 0.78;
  return {
    fontSize,
    lineHeight: `${fontSize}px`,
    transform: scaleX === 1 ? undefined : `scaleX(${scaleX})`,
    transformOrigin: kind === "fluid" ? "bottom left" : "bottom right",
  };
}

function formatMinecraftAmount(amount: number, kind: ResourceKind): string | undefined {
  if (kind === "item") {
    if (amount === 1) {
      return undefined;
    }

    return Number.isInteger(amount) ? formatNumberWithThousands(amount) : trimAmount(amount);
  }

  if (kind === "aspect") {
    return trimAmount(amount);
  }

  return `${trimAmount(amount)}L`;
}

function trimAmount(amount: number): string {
  if (Number.isInteger(amount)) {
    return formatNumberWithThousands(amount);
  }

  return formatNumberWithThousands(trimTrailingDecimalZeros(amount.toFixed(2)));
}
