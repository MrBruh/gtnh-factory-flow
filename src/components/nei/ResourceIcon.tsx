"use client";

import type { ResourceAmount, ResourceKind } from "@/lib/model/types";
import { MinecraftTooltip } from "./MinecraftTooltip";

interface ResourceIconProps {
  resource?: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "iconAtlas" | "tooltip"
  > & { consumed?: boolean; chance?: number };
  size?: "sm" | "md" | "lg";
  showAmount?: boolean;
  showName?: boolean;
  bare?: boolean;
  className?: string;
  tooltip?: boolean;
  iconPixelSize?: number;
}

const sizeClasses = {
  sm: "h-9 w-9",
  md: "h-12 w-12",
  lg: "h-14 w-14",
};

const renderedIconSize = {
  sm: 64,
  md: 88,
  lg: 104,
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
}: ResourceIconProps) {
  const title = resource?.tooltip?.join("\n") ?? resource?.displayName ?? resource?.id;
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
      <IconImage resource={resource} size={size} iconPixelSize={iconPixelSize} />

      {resource && showAmount ? <AmountLabel resource={resource} /> : null}
      {resource?.chance !== undefined ? <ChanceLabel chance={resource.chance} /> : null}

      {resource?.consumed === false ? (
        <span className="absolute left-0 top-0 font-mono text-[8px] font-black leading-none text-[#ffff55] drop-shadow-[1px_1px_0_#000]">
          NC
        </span>
      ) : null}

      {resource && showName ? (
        <span className="absolute left-0.5 top-0.5 max-w-[calc(100%-4px)] truncate font-mono text-[8px] leading-none text-white drop-shadow-[1px_1px_0_#000]">
          {resource.displayName ?? resource.id}
        </span>
      ) : null}
    </div>
  );

  if (!tooltip) {
    return icon;
  }

  return <MinecraftTooltip label={title}>{icon}</MinecraftTooltip>;
}

function ChanceLabel({ chance }: { chance: number }) {
  if (!Number.isFinite(chance) || chance >= 1) {
    return null;
  }

  const label = `${trimAmount(chance * 100)}%`;
  return (
    <span className="absolute right-0.5 top-0 max-w-[95%] truncate font-mono text-[9px] font-black leading-none text-[#ffff55] drop-shadow-[1px_1px_0_#000]">
      {label}
    </span>
  );
}

function IconImage({
  resource,
  size,
  iconPixelSize,
}: {
  resource?: Pick<ResourceAmount, "id" | "displayName" | "iconPath" | "iconAtlas">;
  size: "sm" | "md" | "lg";
  iconPixelSize?: number;
}) {
  if (!resource) {
    return null;
  }

  const displaySize = iconPixelSize ?? renderedIconSize[size];

  if (resource.iconAtlas) {
    const scale = displaySize / resource.iconAtlas.width;
    return (
      <span
        role="img"
        aria-label={resource.displayName ?? resource.id}
        className="pixelated-image absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 bg-no-repeat"
        style={{
          width: displaySize,
          height: displaySize,
          backgroundImage: `url(${resource.iconAtlas.imagePath})`,
          backgroundSize: `${resource.iconAtlas.atlasWidth * scale}px ${
            resource.iconAtlas.atlasHeight * scale
          }px`,
          backgroundPosition: `-${resource.iconAtlas.x * scale}px -${
            resource.iconAtlas.y * scale
          }px`,
          imageRendering: "pixelated",
        }}
      />
    );
  }

  if (!resource.iconPath || isLegacyRenderedIconPath(resource.iconPath)) {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resource.iconPath}
      alt={resource.displayName ?? resource.id}
      className={
        iconPixelSize
          ? "pixelated-image max-w-none object-contain"
          : "pixelated-image h-[calc(200%-8px)] w-[calc(200%-8px)] max-w-none object-contain"
      }
      style={{
        imageRendering: "pixelated",
        ...(iconPixelSize ? { width: iconPixelSize, height: iconPixelSize } : undefined),
      }}
    />
  );
}

function isLegacyRenderedIconPath(iconPath: string): boolean {
  return iconPath.includes("/textures/rendered/");
}

function AmountLabel({ resource }: { resource: Pick<ResourceAmount, "kind" | "amount"> }) {
  const label = formatMinecraftAmount(resource.amount, resource.kind);
  if (!label) {
    return null;
  }

  const position =
    resource.kind === "fluid" ? "bottom-0 left-0.5" : "bottom-0 right-0.5 text-right";

  return (
    <span
      className={[
        "absolute max-w-[95%] truncate font-mono text-[10px] font-black leading-none text-white drop-shadow-[1px_1px_0_#000]",
        position,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function formatMinecraftAmount(amount: number, kind: ResourceKind): string | undefined {
  if (kind === "item") {
    if (amount === 1) {
      return undefined;
    }

    return Number.isInteger(amount) ? String(amount) : trimAmount(amount);
  }

  return `${trimAmount(amount)}L`;
}

function trimAmount(amount: number): string {
  if (Number.isInteger(amount)) {
    return String(amount);
  }

  return amount.toFixed(2).replace(/\.?0+$/, "");
}
