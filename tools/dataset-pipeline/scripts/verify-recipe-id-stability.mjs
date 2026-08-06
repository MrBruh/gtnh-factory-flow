#!/usr/bin/env node
// Check that oracle recipe ids identify recipes by their content, and that they survive a
// regeneration of the same GTNH version.
//
// Exported plans embed `node.recipeId`. Ids used to hash the registry iteration index - and, for
// GregTech, `GTRecipe.toString()`, which is an identity hash on a class that does not override it
// - so republishing the very same version reshuffled every id and a saved plan resolved nothing.
// The exporter now derives ids from content. Three properties have to hold, and this checks them:
//
//   1. No id means two different things. Within one export, an id must not appear twice on
//      recipes that differ; across two exports, an id present in both must describe the same
//      recipe in both.
//   2. The recipes an occurrence counter separates must be indistinguishable. Identical recipes
//      are numbered by registry walk order, so that order is only safe if the rows it numbers are
//      byte-identical - otherwise which row takes which number, and so which id, is luck.
//   3. Both exports produce the same set of ids.
//
// Identity is compared the way the exporter's key computes it: resource lists as sorted
// multisets, display and texture fields excluded. Comparing them any other way would report the
// exporter's deliberate design as a failure. Order and presentation still drift for real - GTNH
// registers some recipes by walking a hash-ordered collection, and randomizes a few display names
// per run - so both are counted and reported as observations rather than silently dropped.
//
// Usage:
//   node verify-recipe-id-stability.mjs <export.json>                     # properties 1 and 2
//   node verify-recipe-id-stability.mjs <export-a.json> <export-b.json>   # plus 3
//
// The input is the raw oracle export (`oracle-export.json`), not the normalized `recipes.json`.
// The pipeline uploads it on every run as the `gtnh-export-logs-<version>` artifact.

import fs from "node:fs/promises";

const [, , pathA, pathB] = process.argv;

if (!pathA) {
  console.error("usage: verify-recipe-id-stability.mjs <export.json> [export-b.json]");
  process.exit(2);
}

/** Stamped per recipe at export time; never an identity difference. */
const VOLATILE = new Set(["generatedAt"]);

/**
 * Presentation. The exporter keeps these out of the content key so localization and icon capture
 * cannot move an id - GTNH really does randomize some display names per run
 * ("QED (Quasar Entanglement Device)" vs "QED (Quark/Electron Director)").
 */
const PRESENTATION = new Set([
  "displayName",
  "icon",
  "iconPath",
  "iconAtlas",
  "dominantColor",
  "tooltip",
]);

/** Every list the exporter hashes through `resourceContentKeys`, which sorts before hashing. */
const RESOURCE_LISTS = [
  "itemInputs",
  "itemOutputs",
  "fluidInputs",
  "fluidOutputs",
  "nonConsumedInputs",
  "inputs",
  "outputs",
  "components",
  "aspects",
];

const IDENTITY_DROP = new Set([...VOLATILE, ...PRESENTATION]);

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

function withoutId(recipe, drop) {
  const { id: _id, ...rest } = recipe;
  return stripKeys(rest, drop);
}

function sortResourceLists(normalized) {
  for (const key of RESOURCE_LISTS) {
    if (Array.isArray(normalized[key])) {
      normalized[key] = normalized[key].map((entry) => JSON.stringify(entry)).sort();
    }
  }
  return normalized;
}

/** What the id is supposed to pin down: content, order-insensitive, presentation excluded. */
function identityOf(recipe) {
  return JSON.stringify(sortResourceLists(withoutId(recipe, IDENTITY_DROP)));
}

/** Identity plus list order, to detect ordering drift that identity deliberately ignores. */
function orderedOf(recipe) {
  return JSON.stringify(withoutId(recipe, IDENTITY_DROP));
}

/** Identity plus presentation, to detect display drift that identity deliberately ignores. */
function presentationOf(recipe) {
  return JSON.stringify(sortResourceLists(withoutId(recipe, VOLATILE)));
}

function collectRecipes(raw) {
  const collected = [];
  for (const domain of raw.domains ?? []) {
    for (const recipe of domain.recipes ?? []) {
      if (recipe?.id) collected.push({ scope: domain.id, recipe });
    }
    for (const recipeMap of domain.recipeMaps ?? []) {
      for (const recipe of recipeMap.recipes ?? []) {
        if (recipe?.id) collected.push({ scope: `${domain.id}/${recipeMap.id}`, recipe });
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
    if (existing) existing.push(entry);
    else byId.set(entry.recipe.id, [entry]);
  }
  return byId;
}

const failures = [];
const notes = [];

const recipesA = await loadExport(pathA);
const byIdA = indexById(recipesA);

console.log(`${pathA}: ${recipesA.length} recipes, ${byIdA.size} distinct ids`);

// Property 1, within one export.
let reusedIds = 0;
for (const [id, entries] of byIdA) {
  if (entries.length === 1) continue;
  if (new Set(entries.map((entry) => identityOf(entry.recipe))).size > 1) {
    reusedIds++;
    if (reusedIds <= 5) {
      failures.push(`id ${id} is on ${entries.length} recipes that differ (${entries[0].scope})`);
    }
  }
}
if (reusedIds > 0) failures.push(`${reusedIds} id(s) describe more than one distinct recipe`);
else notes.push("no id describes more than one distinct recipe");

// Property 2. Group the way the key groups, then ask whether the rows a counter separates are
// truly indistinguishable - including the list order the key ignores. A group whose members
// differ in order would make the counter, and so the id, depend on registry walk order.
const byIdentity = new Map();
for (const entry of recipesA) {
  const key = JSON.stringify([entry.scope, identityOf(entry.recipe)]);
  const group = byIdentity.get(key);
  if (group) group.push(entry);
  else byIdentity.set(key, [entry]);
}

let groups = 0;
let groupedRecipes = 0;
let largestGroup = 1;
let orderDependentGroups = 0;
for (const entries of byIdentity.values()) {
  if (entries.length < 2) continue;
  groups++;
  groupedRecipes += entries.length;
  largestGroup = Math.max(largestGroup, entries.length);
  const strict = new Set(entries.map((entry) => orderedOf(entry.recipe)));
  if (strict.size > 1) orderDependentGroups++;
}

if (groups === 0) {
  notes.push("every recipe is distinguishable on content alone: no id depends on the counter");
} else {
  const pct = ((groupedRecipes / recipesA.length) * 100).toFixed(2);
  notes.push(
    `${groups} content group(s) hold more than one recipe: ${groupedRecipes}/${recipesA.length} rows (${pct}%), largest ${largestGroup}`,
  );
  if (orderDependentGroups > 0) {
    failures.push(
      `${orderDependentGroups} counter group(s) hold rows that differ in list order, so which row takes which id depends on registry walk order`,
    );
  } else {
    notes.push(
      "every such row is byte-identical to its group, so occurrence-counter order cannot change what any id means",
    );
  }
}

// Property 3.
if (pathB) {
  const recipesB = await loadExport(pathB);
  const byIdB = indexById(recipesB);
  console.log(`${pathB}: ${recipesB.length} recipes, ${byIdB.size} distinct ids`);

  let shared = 0;
  let drifted = 0;
  let orderingDrift = 0;
  let presentationDrift = 0;

  for (const [id, entriesA] of byIdA) {
    const entriesB = byIdB.get(id);
    if (!entriesB) continue;
    shared++;

    const identA = new Set(entriesA.map((entry) => identityOf(entry.recipe)));
    const identB = new Set(entriesB.map((entry) => identityOf(entry.recipe)));
    const same = identA.size === identB.size && [...identA].every((value) => identB.has(value));
    if (!same) {
      drifted++;
      if (drifted <= 5) failures.push(`id ${id} describes a different recipe in the two exports`);
      continue;
    }

    if (entriesA.length === 1 && entriesB.length === 1) {
      if (orderedOf(entriesA[0].recipe) !== orderedOf(entriesB[0].recipe)) orderingDrift++;
      if (presentationOf(entriesA[0].recipe) !== presentationOf(entriesB[0].recipe))
        presentationDrift++;
    }
  }

  const onlyA = [...byIdA.keys()].filter((id) => !byIdB.has(id)).length;
  const onlyB = [...byIdB.keys()].filter((id) => !byIdA.has(id)).length;
  console.log(`shared ids: ${shared}, only in A: ${onlyA}, only in B: ${onlyB}`);

  if (drifted > 0) failures.push(`${drifted} shared id(s) changed meaning between the two exports`);
  else notes.push(`all ${shared} shared ids describe the same recipe in both exports`);

  if (orderingDrift > 0) {
    notes.push(
      `${orderingDrift} id(s) kept their identity while their exported list order changed - the sort in the content key absorbing a registry walk that is not stable between runs`,
    );
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

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.error(`  FAIL  ${failure}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s) found.`);
  process.exit(1);
}

console.log("\nRecipe ids are content-derived and stable.");
