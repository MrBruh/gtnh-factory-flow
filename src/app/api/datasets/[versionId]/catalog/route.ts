import { NextResponse } from "next/server";
import { getDatasetCatalog } from "@/lib/server/dataset-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    return NextResponse.json(await getDatasetCatalog(versionId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dataset catalog failed." },
      { status: 500 },
    );
  }
}
