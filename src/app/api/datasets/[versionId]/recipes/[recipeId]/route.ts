import { NextResponse } from "next/server";
import { getDatasetRecipe } from "@/lib/server/dataset-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string; recipeId: string }> },
) {
  try {
    const { versionId, recipeId } = await params;
    const recipe = await getDatasetRecipe(versionId, recipeId);
    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found." }, { status: 404 });
    }

    return NextResponse.json(recipe, {
      headers: datasetCacheHeaders(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Recipe load failed." },
      { status: 500 },
    );
  }
}

function datasetCacheHeaders() {
  return {
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
  };
}
