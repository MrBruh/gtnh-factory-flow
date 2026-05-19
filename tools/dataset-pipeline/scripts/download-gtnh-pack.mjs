import fs from "node:fs/promises";
import path from "node:path";

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("Usage: download-gtnh-pack.mjs <output.zip>");
}

const channel = requiredEnv("GTNH_DATASET_CHANNEL");
const versionLabel = requiredEnv("GTNH_DATASET_VERSION_LABEL");
const sourceKind = requiredEnv("GTNH_SOURCE_KIND");
const sourceRef = requiredEnv("GTNH_SOURCE_REF");
const packKind = process.env.GTNH_EXPORT_PACK_KIND ?? "server";
const githubToken = process.env.GITHUB_TOKEN;

const download = await resolveDownload();
await fs.mkdir(path.dirname(outputPath), { recursive: true });
console.log(`Downloading GTNH ${packKind} pack for ${versionLabel}: ${download.url}`);
await downloadFile(download.url, outputPath, download.headers);

async function resolveDownload() {
  if (channel === "daily" || sourceKind === "github-actions-run") {
    return resolveDailyArtifact();
  }

  const stableUrl = stableDownloadUrl(versionLabel, packKind);
  if (await canHead(stableUrl)) {
    return { url: stableUrl, headers: {} };
  }

  return {
    url:
      process.env.GTNH_SOURCE_URL ||
      `https://github.com/GTNewHorizons/GT-New-Horizons-Modpack/releases/download/${sourceRef}/${versionLabel}.zip`,
    headers: {},
  };
}

async function resolveDailyArtifact() {
  const artifactKind = packKind === "client" ? "mmcprism-java17-25" : "server-java17-25";
  const artifactsUrl = `https://api.github.com/repos/GTNewHorizons/DreamAssemblerXXL/actions/runs/${sourceRef}/artifacts`;
  const body = await githubJson(artifactsUrl);
  const artifact = body.artifacts?.find(
    (entry) => !entry.expired && entry.name.toLowerCase().includes(artifactKind),
  );

  if (!artifact) {
    throw new Error(`No non-expired daily artifact matching ${artifactKind} for run ${sourceRef}.`);
  }

  return {
    url: artifact.archive_download_url,
    headers: authHeaders(),
  };
}

function stableDownloadUrl(version, kind) {
  const encoded = encodeURIComponent(version);
  if (kind === "client") {
    return `https://downloads.gtnewhorizons.com/Multi_mc_downloads/GT_New_Horizons_${encoded}_Java_17-25.zip`;
  }
  return `https://downloads.gtnewhorizons.com/ServerPacks/GT_New_Horizons_${encoded}_Server_Java_17-25.zip`;
}

async function canHead(url) {
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  return response.ok;
}

async function downloadFile(url, filePath, headers = {}) {
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await fs.writeFile(filePath, bytes);
}

async function githubJson(url) {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${url}`);
  }
  return response.json();
}

function authHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}
