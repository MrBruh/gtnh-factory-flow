import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeDatasetJson } from "./dataset-json-writer.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(scriptDir, "build-resource-index.mjs");

let workDir;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "build-resource-index-"));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

/**
 * dataset-json-writer only streams an object across multiple lines once it has more than 32
 * keys. Anything smaller is written inline on a single line and is therefore read back by
 * the trivial scalar path, so a small object cannot reproduce the key loss this suite guards.
 */
function buildOreDictionary() {
  const oreDictionary = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `oreEntry${index}`,
      [`item:thing_${index}`, `item:other_${index}`],
    ]),
  );
  oreDictionary.logWood = ["item:spruce_log", "item:oak_log"];
  return oreDictionary;
}

function buildDataset(overrides = {}) {
  return {
    schemaVersion: 1,
    datasetVersionId: "stable-test",
    gtnhVersion: "2.8.4",
    sourceInfo: { sourceId: "gtnh-oracle", sourceVersion: "v1", generatedAt: "2026-01-01" },
    resources: [
      { kind: "item", id: "spruce_log", displayName: "Spruce Log", oreDictionary: ["logWood"] },
      { kind: "item", id: "planks", displayName: "Planks" },
    ],
    recipes: [
      {
        id: "r1",
        name: "Saw Planks",
        machineType: "Cutting Machine",
        inputs: [{ kind: "item", id: "spruce_log", amount: 1 }],
        outputs: [{ kind: "item", id: "planks", amount: 4 }],
      },
    ],
    oreDictionary: buildOreDictionary(),
    recipeMaps: ["Cutting Machine"],
    recipeMapIcons: [{ recipeMap: "Cutting Machine", resource: { kind: "item", id: "planks" } }],
    generatedAt: "2026-01-01",
    ...overrides,
  };
}

async function runBuildResourceIndex(datasetPath) {
  await execFileAsync(process.execPath, [scriptPath, datasetPath]);
}

async function readDatasetFile(datasetPath) {
  const data = await fs.readFile(datasetPath);
  const source = datasetPath.endsWith(".gz")
    ? gunzipSync(data).toString("utf8")
    : data.toString("utf8");
  return JSON.parse(source);
}

describe("build-resource-index", () => {
  it("writes oreDictionary across multiple lines, the condition that triggered the loss", async () => {
    const datasetPath = path.join(workDir, "recipes.json");
    await writeDatasetJson(datasetPath, buildDataset());

    const raw = await fs.readFile(datasetPath, "utf8");
    const oreDictionaryLine = raw
      .split("\n")
      .find((line) => line.trimStart().startsWith('"oreDictionary":'));

    expect(oreDictionaryLine?.trimEnd()).toMatch(/"oreDictionary": \{$/);
  });

  it("preserves oreDictionary through the index step", async () => {
    const datasetPath = path.join(workDir, "recipes.json");
    const dataset = buildDataset();
    await writeDatasetJson(datasetPath, dataset);

    await runBuildResourceIndex(datasetPath);

    const written = await readDatasetFile(datasetPath);
    expect(written.oreDictionary).toEqual(dataset.oreDictionary);
    expect(written.oreDictionary.logWood).toEqual(["item:spruce_log", "item:oak_log"]);
  });

  it("preserves unrecognised top-level keys through the index step", async () => {
    const datasetPath = path.join(workDir, "recipes.json");
    const dataset = buildDataset({
      // Neither key is known to the index step. A future normalizer field must survive it
      // rather than being silently deleted from the published dataset.
      futureBigObject: Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [`key${index}`, { nested: index }]),
      ),
      futureArray: [{ id: "a" }, { id: "b" }],
      futureScalar: "keep me",
    });
    await writeDatasetJson(datasetPath, dataset);

    await runBuildResourceIndex(datasetPath);

    const written = await readDatasetFile(datasetPath);
    expect(written.futureBigObject).toEqual(dataset.futureBigObject);
    expect(written.futureArray).toEqual(dataset.futureArray);
    expect(written.futureScalar).toBe("keep me");
  });

  it("adds resourceIndex without dropping any other top-level key", async () => {
    const datasetPath = path.join(workDir, "recipes.json");
    const dataset = buildDataset();
    await writeDatasetJson(datasetPath, dataset);

    await runBuildResourceIndex(datasetPath);

    const written = await readDatasetFile(datasetPath);
    expect(Object.keys(written)).toEqual([...Object.keys(dataset), "resourceIndex"]);
    expect(written.resourceIndex.map((resource) => resource.id).sort()).toEqual([
      "planks",
      "spruce_log",
    ]);
  });

  it("is idempotent across repeated runs", async () => {
    const datasetPath = path.join(workDir, "recipes.json");
    await writeDatasetJson(datasetPath, buildDataset());

    await runBuildResourceIndex(datasetPath);
    const firstRun = await fs.readFile(datasetPath, "utf8");
    await runBuildResourceIndex(datasetPath);
    const secondRun = await fs.readFile(datasetPath, "utf8");

    expect(secondRun).toBe(firstRun);
  });

  it("preserves every top-level key for a gzipped dataset", async () => {
    const plainPath = path.join(workDir, "recipes.json");
    const datasetPath = path.join(workDir, "recipes.json.gz");
    const dataset = buildDataset();
    await writeDatasetJson(plainPath, dataset);
    await fs.writeFile(datasetPath, gzipSync(await fs.readFile(plainPath), { level: 9 }));

    await runBuildResourceIndex(datasetPath);

    const written = await readDatasetFile(datasetPath);
    expect(written.oreDictionary).toEqual(dataset.oreDictionary);
    expect(Object.keys(written)).toEqual([...Object.keys(dataset), "resourceIndex"]);
  });

  it("falls back to a whole-file parse for a dataset that is not line-delimited", async () => {
    const datasetPath = path.join(workDir, "recipes.json");
    const dataset = buildDataset();
    await fs.writeFile(datasetPath, JSON.stringify(dataset));

    await runBuildResourceIndex(datasetPath);

    const written = await readDatasetFile(datasetPath);
    expect(written.oreDictionary).toEqual(dataset.oreDictionary);
    expect(written.resourceIndex).toHaveLength(2);
  });
});
