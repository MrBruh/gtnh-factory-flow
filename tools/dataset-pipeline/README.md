# Dataset Pipeline

This directory contains the CI-side GTNH dataset pipeline. It detects GTNH stable/daily
versions, invokes a private client/exporter command, validates the normalized output, and
publishes only real generated datasets.

Responsibilities:

- Detect GTNH stable and daily versions.
- Download or locate a clean GTNH client instance.
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
- Runs an exporter command from the repository secret `GTNH_CLIENT_EXPORT_COMMAND`.
- Expects the exporter to write `recipes.json` to `$GTNH_DATASET_OUT_DIR`.
- Rebuilds `public/datasets/gtnh/datasets.manifest.json` from generated datasets.

`GTNH_CLIENT_EXPORT_COMMAND` is intentionally private because the exact client bootstrap
depends on launcher credentials, cache layout, Java version, exporter jar, and which
exporter is selected. The command must run the real selected GTNH client/exporter and
produce a normalized `RecipeDataset`, not raw exporter output and not a public dump.

The command receives:

- `GTNH_DATASET_OUT_DIR` - write normalized `recipes.json` here.
- `GTNH_RAW_EXPORT_DIR` - optional raw NESQL/RecEx/NERD output staging directory.
- `GTNH_INSTANCE_DIR` - optional GTNH client instance/cache directory.
- `GTNH_DATASET_VERSION_ID` - normalized id such as `stable-2.8.4`.
- `GTNH_DATASET_VERSION_LABEL` - upstream GTNH version label.
- `GTNH_DATASET_CHANNEL` - `stable` or `daily`.
- `GTNH_SOURCE_KIND`, `GTNH_SOURCE_REF`, `GTNH_SOURCE_URL` - detected upstream source.

If the secret is missing, the workflow fails before publishing. This is deliberate: the
site must not expose empty placeholder datasets as GTNH versions.

## RecEx Notes

RecEx is a GTNH recipe exporter mod. Its README states that export happens while a
world/server is loaded, and that exported files are placed in `RecEx-Records/` at the
Minecraft instance root. A private client command can therefore install the selected GTNH
pack, add RecEx, launch the client under Xvfb, trigger the exporter, then normalize
`RecEx-Records/` into `$GTNH_DATASET_OUT_DIR/recipes.json`.
