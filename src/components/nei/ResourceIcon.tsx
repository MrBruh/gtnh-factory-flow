"use client";

import Image from "next/image";
import type { ResourceAmount, ResourceKind } from "@/lib/model/types";
import { formatRate } from "@/lib/model";

interface ResourceIconProps {
  resource?: Pick<
    ResourceAmount,
    "kind" | "id" | "amount" | "displayName" | "iconPath" | "tooltip"
  >;
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
          className="pixelated-image h-[calc(100%-4px)] w-[calc(100%-4px)] object-contain"
          style={{ imageRendering: "pixelated" }}
          unoptimized
        />
      ) : null}

      {resource && showAmount ? (
        <span className="absolute bottom-0 right-0.5 max-w-[90%] truncate font-mono text-[10px] font-black leading-none text-white drop-shadow-[1px_1px_0_#000]">
          {formatAmount(resource.amount, resource.kind)}
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

function formatAmount(amount: number, kind: ResourceKind): string {
  if (kind === "fluid") {
    return `${formatRate(amount, amount >= 100 ? 0 : 1)}L`;
  }

  return formatRate(amount, amount >= 10 ? 0 : 2);
}
