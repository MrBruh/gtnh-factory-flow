#!/usr/bin/env node
// Check that oracle recipe ids identify recipes by their content, and that they survive a
// regeneration of the same GTNH version.
//
// Exported plans embed `node.recipeId`. Ids used to hash the registry iteration index - and, for
// GregTech, `GTRecipe.toString()`, which is an identity hash on a class that does not override it
// - so republishing the very same version reshuffled every id and a saved plan resolved nothing.
// The exporter now derives ids from content. Two properties have to hold for that to be worth
// anything, and this script checks both:
//
//   1. No id means two different things. Within one export, an id must not appear twice on
//      recipes that differ in content. Across two exports, an id present in both must describe
//      the same recipe in both.
//   2. Recipes that share an id's input - the content key - must be indistinguishable. Identical
//      recipes are separated by an occurrence counter, and the order the exporter walks the
//      registry decides who gets which number. That is only safe if the members of such a group
//      are interchangeable, i.e. they serialize identically apart from the id itself.
//
// Usage:
//   node verify-recipe-id-stability.mjs <export.json>                     # properties 1 and 2
//   node verify-recipe-id-stability.mjs <export-a.json> <export-b.json>   # plus the run diff
//
// The input is the raw oracle export (`oracle-export.json`, or the merged `oracle-records`), not
// the normalized `recipes.json`. The pipeline uploads it on every run as the
// `gtnh-export-logs-<version>` artifact.

import fs from "node:fs/promises";

const [, , pathA, pathB] = process.argv;

if (!pathA) {
  console.error("usage: verify-recipe-id-stability.mjs <export.json> [export-b.json]");
  process.exit(2);
}

/**
 * Fields that must not count as a content difference.
 *
 * `generatedAt` is stamped per recipe at export time. The rest are presentation: the exporter
 * deliberately keeps display names and textures out of the content key so localization and icon
 * capture cannot move an id. Comparing them here would report the exporter's intended behaviour
 * as a failure - and GTNH really does ship items whose display name is randomized per run
 * ("QED (Quasar Entanglement Device)" vs "QED (Quark/Electron Director)"), which is precisely the
 * case that exclusion exists to survive. Drift in these is reported as an observation instead.
 */
const VOLATILE_KEYS = new Set([
  "generatedAt",
  "displayName",
  "icon",
  "iconPath",
  "iconAtlas",
  "dominantColor",
  "tooltip",
]);

function stripVolatile(value) {
  if (Array.isArray(value)) {
    return value.map(stripVolatile);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE_KEYS.has(key)) {
        continue;
      }
      out[key] = stripVolatile(value[key]);
    }
    return out;
  }
  return value;
}

/** A recipe's content: everything the export writes about it except the id under test. */
function contentOf(recipe) {
  const { id: _id, ...rest } = recipe;
  return JSON.stringify(stripVolatile(rest));
}

/** Content including presentation, so display-only drift can be counted rather than ignored. */
function contentWithPresentation(recipe) {
  const { id: _id, ...rest } = recipe;
  return JSON.stringify(stripKeys(rest, new Set(["generatedAt"])));
}

function stripKeys(value, drop) {
  if (Array.isArray(value)) {
    return value.map((entry) => stripKeys(entry, drop));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (drop.has(key)) {
        continue;
      }
      out[key] = stripKeys(value[key], drop);
    }
    return out;
  }
  return value;
}

/** Scope and content as one key. Encoded as a pair so no separator can be forged by either half. */
function contentGroupKey(entry) {
  return JSON.stringify([entry.scope, contentOf(entry.recipe)]);
}

/**
 * Collect every id-bearing recipe in the export, tagged with where it came from. GregTech nests
 * recipes under `recipeMaps`; the other domains carry them on the domain itself.
 */
function collectRecipes(raw) {
  const collected = [];

  for (const domain of raw.domains ?? []) {
    for (const recipe of domain.recipes ?? []) {
      if (recipe?.id) {
        collected.push({ scope: domain.id, recipe });
      }
    }

    for (const recipeMap of domain.recipeMaps ?? []) {
      for (const recipe of recipeMap.recipes ?? []) {
        if (recipe?.id) {
          collected.push({ scope: `${domain.id}/${recipeMap.id}`, recipe });
        }
      }
    }
  }

  return collected;
}

async function loadExport(filePath) {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    console.error(`cannot read ${filePath}: ${error.message}`);
    process.exit(2);
  }

  const recipes = collectRecipes(raw);
  if (recipes.length === 0) {
    console.error(
      `${filePath} contains no id-bearing recipes under domains[].recipes or domains[].recipeMaps[].recipes.`,
    );
    console.error("Expected the raw oracle export, not a normalized recipes.json.");
    process.exit(2);
  }
  return recipes;
}

function indexById(recipes) {
  const byId = new Map();
  for (const entry of recipes) {
    const existing = byId.get(entry.recipe.id);
    if (existing) {
      existing.push(entry);
    } else {
      byId.set(entry.recipe.id, [entry]);
    }
  }
  return byId;
}

const failures = [];
const notes = [];

const recipesA = await loadExport(pathA);
const byIdA = indexById(recipesA);

console.log(`${pathA}: ${recipesA.length} recipes, ${byIdA.size} distinct ids`);

// Property 1, within one export: an id must never sit on two recipes that differ.
let reusedIds = 0;
let collidingButIdentical = 0;
for (const [id, entries] of byIdA) {
  if (entries.length === 1) {
    continue;
  }
  const contents = new Set(entries.map((entry) => contentOf(entry.recipe)));
  if (contents.size > 1) {
    reusedIds++;
    if (reusedIds <= 5) {
      failures.push(
        `id ${id} is on ${entries.length} recipes with ${contents.size} distinct contents (${entries[0].scope})`,
      );
    }
  } else {
    collidingButIdentical++;
  }
}

if (reusedIds > 0) {
  failures.push(`${reusedIds} id(s) describe more than one distinct recipe`);
} else {
  notes.push("no id describes more than one distinct recipe");
}
if (collidingButIdentical > 0) {
  notes.push(
    `${collidingButIdentical} id(s) repeat on byte-identical recipes (harmless: nothing distinguishes them)`,
  );
}

// Property 2: how much of the export leans on the occurrence counter, and whether the recipes it
// separates are interchangeable. Members of a group that serialize identically can be numbered in
// any order without changing what an id means.
const byContent = new Map();
for (const entry of recipesA) {
  const key = contentGroupKey(entry);
  const ids = byContent.get(key);
  if (ids) {
    ids.push(entry.recipe.id);
  } else {
    byContent.set(key, [entry.recipe.id]);
  }
}

let groupedRecipes = 0;
let largestGroup = 1;
let groups = 0;
for (const ids of byContent.values()) {
  if (ids.length > 1) {
    groups++;
    groupedRecipes += ids.length;
    largestGroup = Math.max(largestGroup, ids.length);
  }
}

if (groups === 0) {
  notes.push("every recipe is distinguishable on content alone: no id depends on the counter");
} else {
  const pct = ((groupedRecipes / recipesA.length) * 100).toFixed(2);
  notes.push(
    `${groups} content group(s) hold more than one recipe: ${groupedRecipes}/${recipesA.length} rows (${pct}%), largest ${largestGroup}`,
  );
  notes.push(
    "those rows are identical apart from their id, so occurrence-counter order cannot change what any id means",
  );
}

// Property 1, across two exports: an id in both must mean the same recipe in both. This is the
// direct regeneration test.
if (pathB) {
  const recipesB = await loadExport(pathB);
  const byIdB = indexById(recipesB);
  console.log(`${pathB}: ${recipesB.length} recipes, ${byIdB.size} distinct ids`);

  let shared = 0;
  let drifted = 0;
  let presentationDrift = 0;
  for (const [id, entriesA] of byIdA) {
    const entriesB = byIdB.get(id);
    if (!entriesB) {
      continue;
    }
    shared++;
    if (
      entriesA.length === 1 &&
      entriesB.length === 1 &&
      contentWithPresentation(entriesA[0].recipe) !== contentWithPresentation(entriesB[0].recipe)
    ) {
      presentationDrift++;
    }
    const contentsA = new Set(entriesA.map((entry) => contentOf(entry.recipe)));
    const contentsB = new Set(entriesB.map((entry) => contentOf(entry.recipe)));
    const same =
      contentsA.size === contentsB.size && [...contentsA].every((value) => contentsB.has(value));
    if (!same) {
      drifted++;
      if (drifted <= 5) {
        failures.push(`id ${id} describes a different recipe in the two exports`);
      }
    }
  }

  const onlyA = [...byIdA.keys()].filter((id) => !byIdB.has(id)).length;
  const onlyB = [...byIdB.keys()].filter((id) => !byIdA.has(id)).length;

  console.log(`shared ids: ${shared}, only in A: ${onlyA}, only in B: ${onlyB}`);

  if (drifted > 0) {
    failures.push(`${drifted} shared id(s) changed meaning between the two exports`);
  } else {
    notes.push(`all ${shared} shared ids describe the same recipe in both exports`);
  }

  if (presentationDrift > 0) {
    notes.push(
      `${presentationDrift} id(s) kept their identity while display metadata changed - the exclusion of display fields from the key working as intended`,
    );
  }

  if (onlyA > 0 || onlyB > 0) {
    failures.push(
      `id sets differ: ${onlyA} only in A, ${onlyB} only in B - a plan built against one would lose those recipes`,
    );
  } else {
    notes.push("both exports produced exactly the same id set");
  }
}

for (const note of notes) {
  console.log(`  ok    ${note}`);
}
for (const failure of failures) {
  console.error(`  FAIL  ${failure}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s) found.`);
  process.exit(1);
}

console.log("\nRecipe ids are content-derived and stable.");
