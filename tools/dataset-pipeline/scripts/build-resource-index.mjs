import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip, gunzipSync } from "node:zlib";
import { writeDatasetJson } from "./dataset-json-writer.mjs";

/**
 * Thrown when a dataset file does not follow the line-delimited layout emitted by
 * dataset-json-writer.mjs. Callers fall back to a whole-file parse, which only works for
 * datasets below Node's max string length.
 *
 * Declared before the top-level await below: unlike function declarations, a class binding
 * is not hoisted, so readDataset would hit its temporal dead zone.
 */
class MalformedDatasetLineError extends Error {}

const datasetPath = process.argv[2];

if (!datasetPath) {
  throw new Error("Usage: build-resource-index.mjs <recipes.json|recipes.json.gz>");
}

const dataset = await readDataset(datasetPath);
dataset.resourceIndex = buildResourceIndex(dataset);
await writeDataset(datasetPath, dataset);

console.log(`Wrote resourceIndex with ${dataset.resourceIndex.length} resources.`);

/**
 * Reads a dataset without ever materialising the whole file as a single string.
 *
 * A real GTNH recipes.json is ~930 MB, well above Node's MAX_STRING_LENGTH (~512 MB), so
 * `fs.readFile(path, "utf8")` throws ERR_STRING_TOO_LONG before JSON.parse is ever reached.
 * `writeDatasetJson` emits one array element (and one large-object entry) per line, so the
 * file can be parsed a line at a time instead.
 *
 * Every top-level key is retained. This script rewrites the whole dataset back to disk to
 * add `resourceIndex`, so anything the reader drops is deleted from the published dataset --
 * that is how `oreDictionary`, the only top-level object big enough to be written multi-line,
 * disappeared from every published dataset.
 */
async function readDataset(filePath) {
  try {
    return await readLineDelimitedDataset(filePath);
  } catch (error) {
    if (!(error instanceof MalformedDatasetLineError)) {
      throw error;
    }
    return readWholeFileDataset(filePath);
  }
}

async function readLineDelimitedDataset(filePath) {
  const dataset = {};

  await forEachDatasetLine(filePath, {
    onScalar(key, value) {
      dataset[key] = value;
    },
    beginArray(key) {
      const values = [];
      dataset[key] = values;
      return (value) => values.push(value);
    },
    beginObject(key) {
      const entries = {};
      dataset[key] = entries;
      return (entryKey, entryValue) => {
        entries[entryKey] = entryValue;
      };
    },
  });

  return dataset;
}

function createDatasetLineReader(filePath) {
  const input = filePath.endsWith(".gz")
    ? createReadStream(filePath).pipe(createGunzip())
    : createReadStream(filePath, { encoding: "utf8" });

  return readline.createInterface({ input, crlfDelay: Infinity });
}

/**
 * Walks the line-delimited layout produced by dataset-json-writer.mjs.
 *
 * `beginArray`/`beginObject` return a per-entry consumer, or undefined to discard that
 * container's contents without ever parsing them.
 */
async function forEachDatasetLine(filePath, handlers) {
  let opened = false;
  let closed = false;
  let pushArrayValue;
  let setObjectEntry;
  let inArray = false;
  let inObject = false;

  for await (const rawLine of createDatasetLineReader(filePath)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (!opened) {
      if (line !== "{") {
        throw new MalformedDatasetLineError(
          `Expected "{" as the first line, got: ${preview(line)}`,
        );
      }
      opened = true;
      continue;
    }

    if (closed) {
      throw new MalformedDatasetLineError(`Unexpected trailing content: ${preview(line)}`);
    }

    if (inArray) {
      if (line === "]" || line === "],") {
        inArray = false;
        pushArrayValue = undefined;
        continue;
      }
      if (pushArrayValue) {
        pushArrayValue(parseJsonLineValue(line));
      }
      continue;
    }

    if (inObject) {
      if (line === "}" || line === "},") {
        inObject = false;
        setObjectEntry = undefined;
        continue;
      }
      if (setObjectEntry) {
        const entry = splitKeyedLine(line);
        setObjectEntry(entry.key, parseJsonLineValue(entry.value));
      }
      continue;
    }

    if (line === "}") {
      closed = true;
      continue;
    }

    const { key, value } = splitKeyedLine(line);
    if (value === "[") {
      inArray = true;
      pushArrayValue = handlers.beginArray(key);
      continue;
    }
    if (value === "{") {
      inObject = true;
      setObjectEntry = handlers.beginObject(key);
      continue;
    }

    handlers.onScalar(key, parseJsonLineValue(value));
  }

  if (!opened || !closed) {
    throw new MalformedDatasetLineError("Dataset ended before its top-level object was closed.");
  }
}

function splitKeyedLine(line) {
  const match = /^("(?:\\.|[^"\\])*")\s*:\s*([\s\S]*)$/.exec(line);
  if (!match) {
    throw new MalformedDatasetLineError(`Expected a "key": value line, got: ${preview(line)}`);
  }
  return { key: parseJsonLineValue(match[1]), value: match[2] };
}

function parseJsonLineValue(value) {
  // A well-formed JSON value never ends in a comma, so a trailing one is always a separator.
  const json = value.endsWith(",") ? value.slice(0, -1) : value;
  try {
    return JSON.parse(json);
  } catch {
    throw new MalformedDatasetLineError(`Expected a JSON value, got: ${preview(json)}`);
  }
}

function preview(line) {
  return line.length > 120 ? `${line.slice(0, 120)}...` : line;
}

async function readWholeFileDataset(filePath) {
  const data = await fs.readFile(filePath);
  const source = filePath.endsWith(".gz")
    ? gunzipSync(data).toString("utf8")
    : data.toString("utf8");
  return JSON.parse(source);
}

async function writeDataset(filePath, dataset) {
  if (!filePath.endsWith(".gz")) {
    await writeDatasetJson(filePath, dataset);
    return;
  }

  // Serialising to a string first would hit the same ERR_STRING_TOO_LONG ceiling as reading
  // did, so stage the line-delimited JSON on disk and gzip it as a stream. This keeps the
  // gzipped payload line-delimited too, matching the pipeline's own gzip step.
  const stagingPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeDatasetJson(stagingPath, dataset);
    await pipeline(
      createReadStream(stagingPath),
      createGzip({ level: 9 }),
      createWriteStream(filePath),
    );
  } finally {
    await fs.rm(stagingPath, { force: true });
  }
}

function buildResourceIndex(dataset) {
  const resourcesByKey = new Map(
    (dataset.resources ?? []).map((resource) => [resourceKey(resource), resource]),
  );
  const index = new Map();

  for (const recipe of dataset.recipes ?? []) {
    for (const resource of [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])]) {
      const key = resourceKey(resource);
      const existing = index.get(key);
      if (existing) {
        existing.recipeCount += 1;
        mergeResourceIcon(existing, resource, resourcesByKey.get(key));
        continue;
      }

      const indexed = resourcesByKey.get(key);
      index.set(key, {
        kind: resource.kind,
        id: resource.id,
        displayName: resource.displayName ?? indexed?.displayName,
        iconPath: currentIconPath(resource.iconPath, indexed?.iconPath),
        iconAtlas: indexed?.iconAtlas ?? resource.iconAtlas,
        dominantColor:
          indexed?.dominantColor ??
          resource.dominantColor ??
          indexed?.iconAtlas?.dominantColor ??
          resource.iconAtlas?.dominantColor,
        recipeCount: 1,
        tooltip: resource.tooltip ?? indexed?.tooltip,
        oreDictionary: resource.oreDictionary ?? indexed?.oreDictionary,
        alternatives: resource.alternatives ?? indexed?.alternatives,
      });
    }
  }

  addFluidCellAlternatives(index, dataset.recipes ?? []);

  return [...index.values()].sort((left, right) => right.recipeCount - left.recipeCount);
}

function addFluidCellAlternatives(index, recipes) {
  for (const recipe of recipes) {
    if (!isFluidCannerRecipe(recipe)) {
      continue;
    }

    const fillFluid = (recipe.inputs ?? []).find((resource) => resource.kind === "fluid");
    const fillCell = (recipe.outputs ?? []).find((resource) => isFilledCell(resource));
    if (fillFluid && fillCell && hasEmptyCell(recipe.inputs ?? [])) {
      linkAlternatives(index, fillCell, fillFluid);
    }

    const emptyFluid = (recipe.outputs ?? []).find((resource) => resource.kind === "fluid");
    const emptyCell = (recipe.inputs ?? []).find((resource) => isFilledCell(resource));
    if (emptyFluid && emptyCell && hasEmptyCell(recipe.outputs ?? [])) {
      linkAlternatives(index, emptyCell, emptyFluid);
    }
  }
}

function linkAlternatives(index, cell, fluid) {
  const cellEntry = index.get(resourceKey(cell));
  const fluidEntry = index.get(resourceKey(fluid));
  if (!cellEntry || !fluidEntry) {
    return;
  }

  addAlternative(cellEntry, fluidEntry, getAlternativeUnitAmount(cell, fluid));
  addAlternative(fluidEntry, cellEntry, getAlternativeUnitAmount(fluid, cell));
}

function addAlternative(resource, alternative, amount) {
  const alternatives = resource.alternatives ?? [];
  if (
    alternatives.some((entry) => entry.kind === alternative.kind && entry.id === alternative.id)
  ) {
    return;
  }

  resource.alternatives = [
    ...alternatives,
    {
      kind: alternative.kind,
      id: alternative.id,
      displayName: alternative.displayName,
      iconPath: alternative.iconPath,
      iconAtlas: alternative.iconAtlas,
      dominantColor: alternative.dominantColor ?? alternative.iconAtlas?.dominantColor,
      tooltip: alternative.tooltip,
      amount,
    },
  ];
}

function getAlternativeUnitAmount(resource, alternative) {
  if (!(resource.amount > 0) || !(alternative.amount > 0)) {
    return undefined;
  }
  return alternative.amount / resource.amount;
}

function isFluidCannerRecipe(recipe) {
  return (recipe.source?.recipeMap ?? recipe.recipeMap ?? recipe.machineType) === "Fluid Canner";
}

function isFilledCell(resource) {
  return resource.kind === "item" && /(^|\s)Cell$/i.test(resource.displayName ?? "");
}

function hasEmptyCell(resources) {
  return resources.some(
    (resource) => resource.kind === "item" && /^Empty Cell$/i.test(resource.displayName ?? ""),
  );
}

function mergeResourceIcon(target, resource, indexed) {
  if (!target.displayName) {
    target.displayName = resource.displayName ?? indexed?.displayName;
  }
  if (!target.iconPath) {
    target.iconPath = currentIconPath(resource.iconPath, indexed?.iconPath);
  }
  if (!target.iconAtlas) {
    target.iconAtlas = indexed?.iconAtlas ?? resource.iconAtlas;
  }
  if (!target.dominantColor) {
    target.dominantColor =
      indexed?.dominantColor ??
      resource.dominantColor ??
      indexed?.iconAtlas?.dominantColor ??
      resource.iconAtlas?.dominantColor;
  }
  if (!target.oreDictionary) {
    target.oreDictionary = resource.oreDictionary ?? indexed?.oreDictionary;
  }
  if (!target.tooltip) {
    target.tooltip = resource.tooltip ?? indexed?.tooltip;
  }
  if (!target.alternatives) {
    target.alternatives = resource.alternatives ?? indexed?.alternatives;
  }
}

function currentIconPath(resourceIconPath, indexedIconPath) {
  if (isLegacyRenderedIconPath(resourceIconPath)) {
    return indexedIconPath;
  }

  return indexedIconPath ?? resourceIconPath;
}

function isLegacyRenderedIconPath(iconPath) {
  return typeof iconPath === "string" && iconPath.includes("/textures/rendered/");
}

function resourceKey(resource) {
  return `${resource.kind}:${resource.id}`;
}
