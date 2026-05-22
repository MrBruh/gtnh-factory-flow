import { appendFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const channelInput = process.env.CHANNEL ?? "both";
const forceRebuild = process.env.FORCE_REBUILD === "true";
const githubToken = process.env.GITHUB_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
};

const selectedChannels =
  channelInput === "both" ? new Set(["stable", "daily"]) : new Set([channelInput]);
const datasetsRoot = process.env.GTNH_DATASETS_ROOT ?? path.join("public", "datasets", "gtnh");
const detected = [];
const currentManifest = await readCurrentManifest();

if (selectedChannels.has("stable")) {
  const stable = await detectStableRelease();
  if (stable && shouldBuildVersion(stable, currentManifest)) {
    detected.push(stable);
  } else if (stable) {
    console.log(`Stable ${stable.id} already published; skipping.`);
  }
}

if (selectedChannels.has("daily")) {
  const daily = await detectDailyBuild();
  if (daily && shouldBuildVersion(daily, currentManifest)) {
    detected.push(daily);
  } else if (daily) {
    console.log(`Daily ${daily.id} already published; skipping.`);
  }
}

await fs.mkdir(".pipeline", { recursive: true });
await fs.writeFile(
  ".pipeline/detected-versions.json",
  `${JSON.stringify({ schemaVersion: 1, detected }, null, 2)}\n`,
);

const matrix = {
  include: detected,
};

writeOutput("matrix", JSON.stringify(matrix));
writeOutput("has_versions", detected.length > 0 ? "true" : "false");

async function readCurrentManifest() {
  try {
    const rawManifest = await fs.readFile(
      path.join(datasetsRoot, "datasets.manifest.json"),
      "utf8",
    );
    return JSON.parse(rawManifest);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function shouldBuildVersion(version, manifest) {
  if (forceRebuild) {
    return true;
  }

  if (!manifest?.versions?.length) {
    return true;
  }

  if (version.channel === "stable") {
    return !manifest.versions.some((entry) => entry.id === version.id);
  }

  if (version.channel === "daily") {
    const latestDaily = manifest.versions.find((entry) => entry.channel === "daily");
    return latestDaily?.id !== version.id;
  }

  return true;
}

async function detectStableRelease() {
  let release;

  for (let page = 1; page <= 10; page += 1) {
    const releases = await githubJson(
      `https://api.github.com/repos/GTNewHorizons/GT-New-Horizons-Modpack/releases?per_page=100&page=${page}`,
    );
    release = releases.find(
      (entry) =>
        !entry.draft &&
        !entry.prerelease &&
        !/beta|alpha|rc|pre|nightly|daily|dev/i.test(`${entry.tag_name} ${entry.name}`),
    );

    if (release || releases.length === 0) {
      break;
    }
  }

  if (!release) {
    return undefined;
  }

  const versionLabel = normalizeVersionLabel(release.tag_name || release.name);
  return {
    id: `stable-${slug(versionLabel)}`,
    channel: "stable",
    gtnhVersion: versionLabel,
    sourceKind: "github-release",
    sourceRef: release.tag_name,
    sourceUrl: release.html_url,
    publishedAt: release.published_at,
  };
}

async function detectDailyBuild() {
  const runs = await githubJson(
    "https://api.github.com/repos/GTNewHorizons/DreamAssemblerXXL/actions/workflows/daily-modpack-build.yml/runs?status=success&per_page=10",
  );
  const run = runs.workflow_runs?.find((entry) => entry.conclusion === "success");

  if (!run) {
    return undefined;
  }

  return {
    id: `daily-${run.run_number}`,
    channel: "daily",
    gtnhVersion: `daily-${run.run_number}`,
    sourceKind: "github-actions-run",
    sourceRef: String(run.id),
    sourceUrl: run.html_url,
    publishedAt: run.updated_at,
  };
}

async function githubJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${url}`);
  }
  return response.json();
}

function normalizeVersionLabel(value) {
  return String(value)
    .replace(/^GT-New-Horizons-/i, "")
    .replace(/^v/i, "")
    .trim();
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-");
}

function writeOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    console.log(`${name}=${value}`);
    return;
  }

  appendFileSync(outputFile, `${name}=${value}\n`);
}
