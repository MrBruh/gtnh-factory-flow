export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  try {
    const { prewarmLatestDatasetVersions } = await import("@/lib/server/dataset-query");
    await prewarmLatestDatasetVersions();
    console.info("GTNH dataset cache prewarmed.");
  } catch (error) {
    console.error("GTNH dataset cache prewarm failed.", error);
  }
}
