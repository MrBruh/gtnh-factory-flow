import { NextResponse } from "next/server";
import { getDatasetCatalog, prewarmDatasetVersion } from "@/lib/server/dataset-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const catalog = await getDatasetCatalog(versionId);
    void prewarmDatasetVersion(versionId).catch((error) => {
      console.error(`Failed to prewarm dataset ${versionId}`, error);
    });
    return NextResponse.json(catalog, {
      headers: datasetCacheHeaders(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dataset catalog failed." },
      { status: 500 },
    );
  }
}

function datasetCacheHeaders() {
  return {
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
  };
}
