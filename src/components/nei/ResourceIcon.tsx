"use client";

import Image from "next/image";
import type { ResourceAmount, ResourceKind } from "@/lib/model/types";

interface ResourceIconProps {
  resource?: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "tooltip"
  > & { consumed?: boolean };
  size?: "sm" | "md" | "lg";
  showAmount?: boolean;
  showName?: boolean;
  bare?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "h-9 w-9",
  md: "h-12 w-12",
  lg: "h-14 w-14",
};

export function ResourceIcon({
  resource,
  size = "md",
  showAmount = true,
  showName = false,
  bare = false,
  className = "",
}: ResourceIconProps) {
  const title = resource?.tooltip?.join("\n") ?? resource?.displayName ?? resource?.id;

  return (
    <div
      title={title}
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
      {resource?.iconPath ? (
        <Image
          src={resource.iconPath}
          alt={resource.displayName ?? resource.id}
          width={32}
          height={32}
          className="pixelated-image h-[calc(200%-8px)] w-[calc(200%-8px)] max-w-none object-contain"
          style={{ imageRendering: "pixelated" }}
          unoptimized
        />
      ) : null}

      {resource && showAmount ? (
        <AmountLabel resource={resource} />
      ) : null}

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
}

function AmountLabel({
  resource,
}: {
  resource: Pick<ResourceAmount, "kind" | "amount">;
}) {
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
