# Versioned Dataset Pipeline

The browser MVP must not parse a live GTNH modpack. Large GTNH recipe data should be
generated offline, normalized, compressed, versioned, and then served as static dataset
artifacts.

## Goals

- Track stable and daily GTNH versions.
- Preserve source metadata for NESQL Exporter, RecEx, and NERD.
- Normalize raw exporter output into the internal `RecipeDataset` model.
- Publish immutable datasets under `/public/datasets/gtnh/<version>/`.
- Compare recipe and resource changes between versions.

## Stages

1. Detect GTNH versions
   - Read stable releases and daily builds from the upstream GTNH repositories.
   - Store channel, version id, source URL, and timestamp.

2. Download or locate GTNH build
   - Fetch or mount a clean GTNH client/server build outside the web app.
   - Record pack version, mod list checksum, and exporter versions.

3. Run exporters
   - Execute NESQL Exporter, RecEx, or NERD in a controlled offline/headless
     environment.
   - Store raw output as build artifacts, not as app runtime data.

4. Normalize
   - Convert raw recipe maps, items, fluids, ore dictionary entries, circuits, chances,
     byproducts, and machine metadata into internal JSON.
   - Preserve NEI image paths, slot positions, recipe-map names, and additional machine
     metadata when the exporter provides them.
   - Extract matching real Minecraft PNG textures from the selected GTNH instance/mod
     jars and attach `iconPath` only when an actual asset was found.
   - Validate the normalized output with dataset schemas.

5. Extract real icons
   - Scan `assets/<modid>/textures/items`, `blocks`, and `fluids` inside the selected
     GTNH mods.
   - Copy only matched PNGs into `/public/datasets/gtnh/<version>/textures/`.
   - Render item-stack icons in a headless GTNH client when the exporter runs with
     `GTNH_RENDER_STACK_ICONS=true`. These PNGs are written under
     `/public/datasets/gtnh/<version>/textures/rendered/`, finalized to
     `/public/datasets/gtnh/<version>/textures/icons/`, and take priority over static jar
     texture matches.
   - Never generate substitute icons. If a stack cannot be rendered by the real client
     and no exact PNG exists, leave the icon blank.

6. Compress and hash
   - Write `recipes.json` and optional compressed variants.
   - Generate SHA-256 checksums for every published artifact.

7. Publish only real generated datasets
   - Place artifacts under `/public/datasets/gtnh/<version>/`.
   - Update `/public/datasets/gtnh/datasets.manifest.json`.
   - If artifacts are hosted elsewhere, set
     `NEXT_PUBLIC_GTNH_DATASET_MANIFEST_URL` to the public manifest URL.
   - Do not point the browser at a private GitHub raw URL that requires a token.
   - Do not publish placeholder versions when the client export fails.

8. Diff versions
   - Compare recipe ids, recipe maps, inputs, outputs, durations, EU/t, circuits, and
     source metadata.
   - Emit machine-readable diffs for UI inspection later.

## Manifest Shape

Dataset types live in `src/lib/datasets/types.ts`:

- `DatasetManifest`
- `DatasetVersion`
- `RecipeDataset`
- `DatasetSourceInfo`

The manifest points to immutable dataset versions. The UI should select a dataset version
from the manifest and load normalized JSON only. The planner UI should never offer manual
recipe creation as a substitute for missing GTNH data.

## GitHub Actions Contract

`.github/workflows/gtnh-dataset-pipeline.yml` detects the current stable and daily GTNH
targets, then calls the exporter runner.

The default runner is `tools/dataset-pipeline/scripts/run-gtnh-recex-export.sh`. It:

- Downloads the official selected GTNH client build by default.
- Downloads/builds RecEx from the upstream repository.
- Patches RecEx to auto-run the existing exporter entry point in CI and to render real
  `ItemStack` icons from the Minecraft client renderer.
- Prepares a Forge 1.7.10 client launch from the GTNH Prism/MultiMC instance metadata,
  Minecraft launcher metadata, and Xvfb when no display is available.
- Launches the pack headlessly as a client unless `GTNH_EXPORT_PACK_KIND=server` is set.
- Uses the real runtime recipe registry from the GTNH build/exporter.
- Normalize raw output into the internal `RecipeDataset` shape.
- Stores rendered client stack icons first, publishes them as standalone `textures/icons`
  PNGs, then extracts real matching texture PNGs from the selected GTNH mods for resources
  that still do not have an icon.
- Write `$GTNH_DATASET_OUT_DIR/recipes.json`.

`GTNH_CLIENT_EXPORT_COMMAND` can still override this default with another private runner,
for example a Prism + NESQL Exporter path once account/cache handling is available.

The command receives these directories:

- `GTNH_INSTANCE_DIR` for the client instance/cache.
- `GTNH_RAW_EXPORT_DIR` for raw exporter output.
- `GTNH_DATASET_OUT_DIR` for normalized app artifacts.

It also receives version metadata through `GTNH_DATASET_VERSION_ID`,
`GTNH_DATASET_VERSION_LABEL`, `GTNH_DATASET_CHANNEL`, `GTNH_SOURCE_KIND`,
`GTNH_SOURCE_REF`, and `GTNH_SOURCE_URL`.

If the runner fails or produces no recipes, the workflow fails and publishes nothing. This
prevents fake GTNH versions from appearing in the hosted UI.

## RecEx Integration Notes

The official GTNH RecEx repository describes RecEx as a recipe exporter mod for
Minecraft that exports recipes during runtime to JSON. Its README also notes that the
export runs while a world/server is loaded and writes files to `RecEx-Records/` at the
Minecraft instance root. The CI runner patches RecEx to call `RecipeExporter.run()`
automatically and then normalizes the raw output.

## Non-Goals For MVP

- No in-browser modpack parsing.
- No direct dependency on raw NESQL, RecEx, or NERD output in the planner UI.
- No claim that demo data is authoritative.
- No public dump import as a substitute for running a client/exporter.
