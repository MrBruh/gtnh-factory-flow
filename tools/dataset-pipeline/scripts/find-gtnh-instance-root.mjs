import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root) {
  throw new Error("Usage: find-gtnh-instance-root.mjs <extracted-pack-root>");
}

const candidates = [];
walk(root, 0);

const best = candidates.sort((a, b) => b.score - a.score)[0];
if (!best) {
  throw new Error(`Could not locate GTNH instance root below ${root}.`);
}

console.log(best.dir);

function walk(dir, depth) {
  if (depth > 5) {
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));
  let score = 0;

  if (names.has("mods")) score += 5;
  if (names.has("config")) score += 5;
  if (names.has("scripts")) score += 3;
  if ([...names].some((name) => /start.*server|serverstart/i.test(name))) score += 8;
  if ([...names].some((name) => /^forge.*\.jar$/i.test(name))) score += 4;

  if (score > 0) {
    candidates.push({ dir, score });
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === "mods" || entry.name === "config" || entry.name === ".git") {
      continue;
    }
    walk(path.join(dir, entry.name), depth + 1);
  }
}
