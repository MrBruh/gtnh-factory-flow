import { NextResponse } from "next/server";
import { queryDatasetRecipes } from "@/lib/server/dataset-query";
import type { MachineTier } from "@/lib/model/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TierFilter = "all" | Exclude<MachineTier, "DEMO">;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const url = new URL(request.url);
    const resourceKind = url.searchParams.get("resourceKind");
    const resourceId = url.searchParams.get("resourceId");
    const result = await queryDatasetRecipes(versionId, {
      query: url.searchParams.get("query") ?? "",
      resource:
        resourceKind && resourceId && (resourceKind === "item" || resourceKind === "fluid")
          ? { kind: resourceKind, id: resourceId }
          : undefined,
      mode: url.searchParams.get("mode") === "uses" ? "uses" : "recipes",
      recipeMap: url.searchParams.get("recipeMap") || undefined,
      maxTier: parseTierFilter(url.searchParams.get("maxTier")),
      offset: parseOffset(url.searchParams.get("offset")),
      limit: parseLimit(url.searchParams.get("limit")),
    });
    return NextResponse.json(result, {
      headers: datasetCacheHeaders(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Recipe query failed." },
      { status: 500 },
    );
  }
}

function parseOffset(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.max(0, parsed) : 0;
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(120, parsed)) : 48;
}

function parseTierFilter(value: string | null): TierFilter {
  return (value || "all") as TierFilter;
}

function datasetCacheHeaders() {
  return {
    "Cache-Control": "no-store",
  };
}
