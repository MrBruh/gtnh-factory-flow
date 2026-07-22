// Run with `npm run test`; vitest.config.ts includes tools/**/*.test.mjs.
//
// These cover the streaming dataset reader/writer in icon-utils.mjs. A real GTNH
// recipes.json is ~930 MB, past Node's MAX_STRING_LENGTH (~512 MB), so the icon stages
// cannot materialise it as a single string. Round-tripping matters as much as reading:
// every icon stage writes the dataset back, so anything the reader silently drops is
// permanently lost from the published dataset.
//
// The assertions stay on node:assert/strict rather than vitest's expect: they throw on
// failure, which is all a runner needs, and it keeps the diff to the runner import.

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { gunzipSync } from "node:zlib";

import { writeDatasetJson } from "./dataset-json-writer.mjs";
import { forEachResourceInFile, readDataset, writeDataset } from "./icon-utils.mjs";

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "icon-utils-test-"));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function bigObject(size) {
  return Object.fromEntries(
    Array.from({ length: size }, (_, index) => [`key${index}`, [`value${index}`]]),
  );
}

const sampleDataset = {
  schemaVersion: 1,
  datasetVersionId: "test-1.0.0",
  sourceInfo: { sourceId: "gtnh-oracle", notes: "small inline object stays on one line" },
  resources: [
    { id: "minecraft:stone", kind: "item", displayName: "Stone" },
    { id: "minecraft:water", kind: "fluid", displayName: "Water" },
  ],
  recipes: [
    {
      id: "r1",
      inputs: [{ id: "minecraft:stone", kind: "item" }],
      outputs: [{ id: "minecraft:water", kind: "fluid" }],
    },
  ],
  recipeMaps: [],
  recipeMapIcons: [],
  // Over dataset-json-writer's 32-key threshold, so this is emitted one entry per line.
  oreDictionary: bigObject(64),
  generatedAt: "2026-07-22T00:00:00.000Z",
  resourceIndex: [{ id: "minecraft:stone", kind: "item", recipeCount: 1 }],
};

test("round-trips a line-delimited dataset without losing keys", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "recipes.json");
    await writeDatasetJson(filePath, sampleDataset);

    const read = await readDataset(filePath);
    assert.deepEqual(read, sampleDataset);
    // The 450 MB gate hid a reader that dropped large objects; oreDictionary is the one
    // that actually goes missing, so assert it explicitly rather than trusting deepEqual.
    assert.equal(Object.keys(read.oreDictionary).length, 64);
    assert.deepEqual(Object.keys(read), Object.keys(sampleDataset));
  });
});

test("round-trips empty and single-element containers", async () => {
  await withTempDir(async (dir) => {
    const dataset = {
      schemaVersion: 1,
      resources: [],
      recipes: [{ id: "only", inputs: [], outputs: [] }],
      emptyObject: {},
      smallObject: { a: 1 },
      nullValue: null,
      falseValue: false,
      zero: 0,
      emptyString: "",
    };

    const filePath = path.join(dir, "recipes.json");
    await writeDatasetJson(filePath, dataset);
    assert.deepEqual(await readDataset(filePath), dataset);
  });
});

test("does not mistake JSON string content for structure", async () => {
  await withTempDir(async (dir) => {
    const dataset = {
      schemaVersion: 1,
      resources: [
        // Trailing commas are stripped as separators; a comma *inside* a string must survive.
        { id: "trailing-comma-in-value", displayName: "Ends with a comma," },
        { id: "brackets", displayName: "]," },
        { id: "braces", displayName: "}," },
        { id: "closing-array", displayName: "]" },
        { id: "newline", displayName: "line one\nline two" },
        { id: "quote-colon", displayName: '"key": value' },
        { id: "backslash", displayName: "back\\slash" },
        { id: "unicode", displayName: "Ünïcøde ✦ 日本語" },
      ],
      'key with "quotes" and : colon': "kept",
    };

    const filePath = path.join(dir, "recipes.json");
    await writeDatasetJson(filePath, dataset);

    const read = await readDataset(filePath);
    assert.deepEqual(read, dataset);
    assert.equal(read.resources.length, 8);
  });
});

test("round-trips through gzip and keeps the payload line-delimited", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "recipes.json.gz");
    await writeDataset(filePath, sampleDataset);

    assert.deepEqual(await readDataset(filePath), sampleDataset);

    // A single-line gzip payload would force whole-string reads back onto every consumer,
    // which is exactly the failure this change removes.
    const lines = gunzipSync(await fs.readFile(filePath))
      .toString("utf8")
      .trimEnd()
      .split("\n");
    assert.ok(lines.length > 10, `expected line-delimited gzip payload, got ${lines.length} lines`);
    assert.equal(lines[0], "{");
    assert.equal(lines.at(-1), "}");

    // No staging file is left behind next to the gzip output.
    assert.deepEqual(await fs.readdir(dir), ["recipes.json.gz"]);
  });
});

test("falls back to a whole-file parse for non line-delimited JSON", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "recipes.json");
    // Datasets written by older code, or by hand, are a single line.
    await fs.writeFile(filePath, `${JSON.stringify(sampleDataset)}\n`);

    assert.deepEqual(await readDataset(filePath), sampleDataset);
  });
});

test("propagates real errors instead of falling back", async () => {
  await withTempDir(async (dir) => {
    const missing = path.join(dir, "nope.json");
    await assert.rejects(() => readDataset(missing), { code: "ENOENT" });

    const truncated = path.join(dir, "truncated.json");
    await fs.writeFile(truncated, '{\n  "schemaVersion": 1,\n  "resources": [\n');
    await assert.rejects(() => readDataset(truncated));
  });
});

test("streams resources without retaining the dataset", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "recipes.json");
    await writeDatasetJson(filePath, sampleDataset);

    const seen = [];
    const meta = await forEachResourceInFile(filePath, (resource) => seen.push(resource.id));

    // resources (2) + recipe inputs/outputs (2) + resourceIndex (1)
    assert.deepEqual(seen, [
      "minecraft:stone",
      "minecraft:water",
      "minecraft:stone",
      "minecraft:water",
      "minecraft:stone",
    ]);
    assert.equal(meta.datasetVersionId, "test-1.0.0");
    assert.equal(meta.schemaVersion, 1);
    // Container keys are skipped rather than accumulated: that is the point of streaming.
    assert.equal(meta.resources, undefined);
    assert.equal(meta.oreDictionary, undefined);
  });
});

test("streams resources from a gzipped dataset", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "recipes.json.gz");
    await writeDataset(filePath, sampleDataset);

    const seen = [];
    const meta = await forEachResourceInFile(filePath, (resource) => seen.push(resource.id));

    assert.equal(seen.length, 5);
    assert.equal(meta.datasetVersionId, "test-1.0.0");
  });
});

test("streams resources from non line-delimited JSON via the fallback", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "recipes.json");
    await fs.writeFile(filePath, `${JSON.stringify(sampleDataset)}\n`);

    const seen = [];
    const meta = await forEachResourceInFile(filePath, (resource) => seen.push(resource.id));

    assert.equal(seen.length, 5);
    assert.equal(meta.datasetVersionId, "test-1.0.0");
  });
});
