import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip, gunzipSync } from "node:zlib";
import { writeDatasetJson } from "./dataset-json-writer.mjs";

const RESOURCE_ARRAY_KEYS = new Set(["resources", "resourceIndex"]);
const RECIPE_ARRAY_KEYS = new Set(["recipes"]);

/**
 * Thrown when a dataset file does not follow the line-delimited layout emitted by
 * dataset-json-writer.mjs. Callers fall back to a whole-file parse, which only works for
 * datasets below Node's max string length.
 */
class MalformedDatasetLineError extends Error {}

/**
 * Reads a dataset without ever materialising the whole file as a single string.
 *
 * A real GTNH recipes.json is ~930 MB, well above Node's MAX_STRING_LENGTH (~512 MB), so
 * `fs.readFile(path, "utf8")` throws ERR_STRING_TOO_LONG before JSON.parse is ever reached.
 * `writeDatasetJson` emits one array element (and one large-object entry) per line, so the
 * file can be parsed a line at a time instead.
 */
export async function readDataset(filePath) {
  try {
    return await readLineDelimitedDataset(filePath);
  } catch (error) {
    if (!(error instanceof MalformedDatasetLineError)) {
      throw error;
    }
    return readWholeFileDataset(filePath);
  }
}

/**
 * Streams every resource in a dataset file without retaining the parsed dataset.
 *
 * Use this instead of `readDataset` + `forEachResource` when only the resources matter, so
 * peak memory stays proportional to what the callback keeps rather than to the file size.
 * Resolves to the dataset's scalar top-level fields (schemaVersion, datasetVersionId, ...).
 */
export async function forEachResourceInFile(filePath, callback) {
  try {
    return await streamResources(filePath, callback);
  } catch (error) {
    if (!(error instanceof MalformedDatasetLineError)) {
      throw error;
    }
    const dataset = await readWholeFileDataset(filePath);
    forEachResource(dataset, callback);
    return dataset;
  }
}

export async function writeDataset(filePath, dataset) {
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

export function forEachResource(dataset, callback) {
  for (const resource of dataset.resources ?? []) {
    callback(resource);
  }
  for (const resource of dataset.resourceIndex ?? []) {
    callback(resource);
  }
  for (const recipe of dataset.recipes ?? []) {
    forEachRecipeResource(recipe, callback);
  }
}

function forEachRecipeResource(recipe, callback) {
  for (const resource of recipe.inputs ?? []) {
    callback(resource);
  }
  for (const resource of recipe.outputs ?? []) {
    callback(resource);
  }
}

function createDatasetLineReader(filePath) {
  const input = filePath.endsWith(".gz")
    ? createReadStream(filePath).pipe(createGunzip())
    : createReadStream(filePath, { encoding: "utf8" });

  return readline.createInterface({ input, crlfDelay: Infinity });
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

async function streamResources(filePath, callback) {
  const meta = {};

  await forEachDatasetLine(filePath, {
    onScalar(key, value) {
      meta[key] = value;
    },
    beginArray(key) {
      if (RESOURCE_ARRAY_KEYS.has(key)) {
        return (value) => callback(value);
      }
      if (RECIPE_ARRAY_KEYS.has(key)) {
        return (value) => forEachRecipeResource(value, callback);
      }
      return undefined;
    },
    beginObject() {
      return undefined;
    },
  });

  return meta;
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

export function isRenderedIconPath(iconPath) {
  return typeof iconPath === "string" && iconPath.includes("/textures/rendered/");
}

export function publicPathToFile(publicPath) {
  const normalized = String(publicPath).replace(/^\/+/, "");
  const resolvedRoot = path.resolve(process.cwd(), "public");
  const resolvedFile = path.resolve(resolvedRoot, normalized);

  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Public path escapes /public: ${publicPath}`);
  }

  return resolvedFile;
}

export function getDominantOpaqueColor(icon) {
  const buckets = new Map();

  for (let y = 0; y < icon.height; y += 1) {
    for (let x = 0; x < icon.width; x += 1) {
      const index = (y * icon.width + x) * 4;
      const alpha = icon.data[index + 3];
      if (alpha < 24) {
        continue;
      }

      const red = icon.data[index];
      const green = icon.data[index + 1];
      const blue = icon.data[index + 2];
      const { hue, saturation, lightness } = rgbToHsl(red, green, blue);
      if (lightness < 0.05 || lightness > 0.96) {
        continue;
      }

      const bucket = Math.round(hue / 12) * 12;
      const weight = (alpha / 255) * (0.35 + saturation * 1.65);
      const current = buckets.get(bucket) ?? { weight: 0, red: 0, green: 0, blue: 0 };
      current.weight += weight;
      current.red += red * weight;
      current.green += green * weight;
      current.blue += blue * weight;
      buckets.set(bucket, current);
    }
  }

  const dominant = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!dominant || dominant.weight <= 0) {
    return "#6b7280";
  }

  return rgbToHex(
    Math.round(dominant.red / dominant.weight),
    Math.round(dominant.green / dominant.weight),
    Math.round(dominant.blue / dominant.weight),
  );
}

function rgbToHsl(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness };
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  return { hue: hue * 60, saturation, lightness };
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;
}
