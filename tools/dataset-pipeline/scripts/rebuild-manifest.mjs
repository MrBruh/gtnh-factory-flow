import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";

const rootDir = path.join("public", "datasets", "gtnh");
const entries = existsSync(rootDir) ? await fs.readdir(rootDir, { withFileTypes: true }) : [];
const versions = [];

for (const entry of entries) {
  if (!entry.isDirectory()) {
    continue;
  }

  await removeIfExists(path.join(rootDir, entry.name, ".pipeline-status.json"));

  const recipesPath = getRecipeDatasetPath(entry.name);
  if (!recipesPath) {
    continue;
  }

  const dataset = await readRecipeDataset(recipesPath);
  const checksumSha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(recipesPath))
    .digest("hex");

  versions.push({
    id: dataset.datasetVersionId,
    gtnhVersion: dataset.gtnhVersion,
    channel: inferChannel(dataset.datasetVersionId),
    publishedAt: dataset.generatedAt,
    manifestPath: "/datasets/gtnh/datasets.manifest.json",
    recipeDatasetPath: `/datasets/gtnh/${dataset.datasetVersionId}/${path.basename(recipesPath)}`,
    checksumSha256,
    sourceInfo: dataset.sourceInfo,
  });
}

versions.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

const latestStableVersion = versions.find((version) => version.channel === "stable")?.id;
const latestDailyVersion = versions.find((version) => version.channel === "daily")?.id;
const manifest = {
  schemaVersion: 1,
  ...(latestStableVersion ? { latestStableVersion } : {}),
  ...(latestDailyVersion ? { latestDailyVersion } : {}),
  versions,
};

await fs.mkdir(rootDir, { recursive: true });
await fs.writeFile(
  path.join(rootDir, "datasets.manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

function inferChannel(versionId) {
  if (versionId.startsWith("daily-")) {
    return "daily";
  }
  if (versionId.startsWith("stable-")) {
    return "stable";
  }
  return "experimental";
}

async function removeIfExists(filePath) {
  if (existsSync(filePath)) {
    await fs.rm(filePath, { force: true });
  }
}

function getRecipeDatasetPath(versionId) {
  const gzipPath = path.join(rootDir, versionId, "recipes.json.gz");
  if (existsSync(gzipPath)) {
    return gzipPath;
  }

  const jsonPath = path.join(rootDir, versionId, "recipes.json");
  if (existsSync(jsonPath)) {
    return jsonPath;
  }

  return undefined;
}

async function readRecipeDataset(filePath) {
  const data = await fs.readFile(filePath);
  const source = filePath.endsWith(".gz") ? gunzipSync(data).toString("utf8") : data.toString("utf8");
  return JSON.parse(source);
}
