import type { ResourceAmount, ResourceKind } from "@/lib/model/types";

export type ResourceHandleSide = "input" | "output";

export interface ResourceHandlePayload {
  side: ResourceHandleSide;
  kind: ResourceKind;
  resourceId: string;
}

export function makeResourceHandleId(
  side: ResourceHandleSide,
  resource: Pick<ResourceAmount, "kind" | "id">,
  slotIndex?: number,
): string {
  return `${side}:${resource.kind}:${encodeURIComponent(resource.id)}${slotIndex === undefined ? "" : `:${slotIndex}`}`;
}

export function parseResourceHandleId(handleId?: string | null): ResourceHandlePayload | undefined {
  if (!handleId) {
    return undefined;
  }

  const [side, kind, encodedResourceId] = handleId.split(":");
  if (
    (side !== "input" && side !== "output") ||
    (kind !== "item" && kind !== "fluid") ||
    !encodedResourceId
  ) {
    return undefined;
  }

  return {
    side,
    kind,
    resourceId: decodeURIComponent(encodedResourceId),
  };
}
