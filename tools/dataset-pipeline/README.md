# Dataset Pipeline

This directory contains the CI-side GTNH dataset pipeline. It detects GTNH stable/daily
versions, invokes a real GTNH build/exporter runner, validates the normalized output, and
publishes only real generated datasets.

Responsibilities:

- Detect GTNH stable and daily versions.
- Download or locate a clean GTNH client/server build.
- Run NESQL Exporter, RecEx, or NERD outside the browser and outside the deployed app.
- Normalize raw exporter output into the internal `RecipeDataset` model.
- Compress and checksum generated JSON.
- Publish datasets to `/public/datasets/gtnh/<version>/`.
- Generate diffs between dataset versions.

The web app automatically reads `/datasets/gtnh/datasets.manifest.json` or the URL from
`NEXT_PUBLIC_GTNH_DATASET_MANIFEST_URL`. Private GitHub repositories are suitable for
pipeline source code and CI artifacts, but browser-readable datasets must be published to
a public/static location or served through an authenticated backend.

## GitHub Action

The repository includes `.github/workflows/gtnh-dataset-pipeline.yml`.

It currently:

- Detects the latest stable release from `GTNewHorizons/GT-New-Horizons-Modpack`.
- Detects the latest successful daily build from `GTNewHorizons/DreamAssemblerXXL`.
- Creates one build job per detected channel.
- Installs a headless runtime with Xvfb for exporters that need a Minecraft client GUI.
- Runs `tools/dataset-pipeline/scripts/run-gtnh-recex-export.sh` by default.
- Expects the exporter to write `recipes.json` to `$GTNH_DATASET_OUT_DIR`.
- Extracts matched real PNG textures from the selected GTNH mods into
  `$GTNH_DATASET_OUT_DIR/textures`.
- Rebuilds `public/datasets/gtnh/datasets.manifest.json` from generated datasets.

`GTNH_CLIENT_EXPORT_COMMAND` can override the default runner. The override must run the
real selected GTNH build/exporter and produce a normalized `RecipeDataset`, not raw
exporter output and not a public dump.

The command receives:

- `GTNH_DATASET_OUT_DIR` - write normalized `recipes.json` here.
- `GTNH_RAW_EXPORT_DIR` - optional raw NESQL/RecEx/NERD output staging directory.
- `GTNH_INSTANCE_DIR` - optional GTNH client instance/cache directory.
- `GTNH_DATASET_VERSION_ID` - normalized id such as `stable-2.8.4`.
- `GTNH_DATASET_VERSION_LABEL` - upstream GTNH version label.
- `GTNH_DATASET_CHANNEL` - `stable` or `daily`.
- `GTNH_SOURCE_KIND`, `GTNH_SOURCE_REF`, `GTNH_SOURCE_URL` - detected upstream source.

If the runner fails or produces no recipes, the workflow fails before publishing. This is
deliberate: the site must not expose empty placeholder datasets as GTNH versions.

## RecEx Notes

RecEx is a GTNH recipe exporter mod. Its README states that export happens while a
world/server is loaded, and that exported files are placed in `RecEx-Records/` at the
Minecraft instance root. The default CI runner builds a patched RecEx jar that auto-runs
the existing exporter entry point, launches the selected GTNH build, then normalizes
`RecEx-Records/` into `$GTNH_DATASET_OUT_DIR/recipes.json`.

## Texture Icons

`apply-texture-icons.mjs` scans the selected instance's mod jars and uses only real PNG
assets from `assets/<modid>/textures/items`, `blocks`, and `fluids`. Matched icons are
copied under `/datasets/gtnh/<version>/textures/` and referenced through `iconPath`.

The script does not synthesize missing icons. GregTech metaitems and NBT-dependent stacks
often need Minecraft client-side rendering instead of a static PNG lookup; those resources
stay iconless until the pipeline has a dedicated item-stack render exporter.
