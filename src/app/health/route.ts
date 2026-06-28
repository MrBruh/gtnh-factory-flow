import { NextResponse } from "next/server";
import { getLatestDatasetVersionId } from "@/lib/server/dataset-query";
import pkg from "../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight liveness/readiness probe for the self-hosted deploy gate and uptime
 * checks. Confirms the Node server booted and Next is routing; the dataset version is
 * reported best-effort (null in proxy mode) and never gates the 200 response.
 *
 * `commit` reflects the build the running server was produced from, when deploy.sh
 * injects NEXT_PUBLIC_GIT_SHA at build time (inlined, so it freezes to that build).
 */
export async function GET() {
  const datasetVersionId = await getLatestDatasetVersionId();

  return NextResponse.json(
    {
      status: "ok",
      version: pkg.version,
      commit: process.env.NEXT_PUBLIC_GIT_SHA ?? null,
      datasetVersionId,
      uptimeSeconds: Math.round(process.uptime()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
