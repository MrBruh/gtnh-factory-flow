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

2. Download or locate client instance
   - Fetch or mount a clean GTNH client instance outside the web app.
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
   - Validate the normalized output with dataset schemas.

5. Compress and hash
   - Write `recipes.json` and optional compressed variants.
   - Generate SHA-256 checksums for every published artifact.

6. Publish only real generated datasets
   - Place artifacts under `/public/datasets/gtnh/<version>/`.
   - Update `/public/datasets/gtnh/datasets.manifest.json`.
   - If artifacts are hosted elsewhere, set
     `NEXT_PUBLIC_GTNH_DATASET_MANIFEST_URL` to the public manifest URL.
   - Do not point the browser at a private GitHub raw URL that requires a token.
   - Do not publish placeholder versions when the client export fails.

7. Diff versions
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
targets, then calls the private command stored in the repository secret
`GTNH_CLIENT_EXPORT_COMMAND`.

That command must:

- Download or reuse the selected GTNH client instance.
- Install and run the selected exporter, such as RecEx, NESQL Exporter, or NERD.
- Use the real runtime recipe registry from the client/exporter.
- Normalize raw output into the internal `RecipeDataset` shape.
- Write `$GTNH_DATASET_OUT_DIR/recipes.json`.

The command receives these directories:

- `GTNH_INSTANCE_DIR` for the client instance/cache.
- `GTNH_RAW_EXPORT_DIR` for raw exporter output.
- `GTNH_DATASET_OUT_DIR` for normalized app artifacts.

It also receives version metadata through `GTNH_DATASET_VERSION_ID`,
`GTNH_DATASET_VERSION_LABEL`, `GTNH_DATASET_CHANNEL`, `GTNH_SOURCE_KIND`,
`GTNH_SOURCE_REF`, and `GTNH_SOURCE_URL`.

If `GTNH_CLIENT_EXPORT_COMMAND` is absent, the workflow fails and publishes nothing. This
prevents fake GTNH versions from appearing in the hosted UI.

## RecEx Integration Notes

The official GTNH RecEx repository describes RecEx as a recipe exporter mod for
Minecraft that exports recipes during runtime to JSON. Its README also notes that the
export runs while a world/server is loaded and writes files to `RecEx-Records/` at the
Minecraft instance root. A private CI command should therefore launch the selected GTNH
client under Xvfb, trigger RecEx or the chosen exporter, then normalize the raw output.

## Non-Goals For MVP

- No in-browser modpack parsing.
- No direct dependency on raw NESQL, RecEx, or NERD output in the planner UI.
- No claim that demo data is authoritative.
- No public dump import as a substitute for running a client/exporter.
