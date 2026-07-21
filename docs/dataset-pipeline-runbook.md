# Dataset Pipeline Runbook

How to rebuild the GTNH dataset: locally for verification, and on a deployed server that
publishes for real.

[`dataset-pipeline.md`](dataset-pipeline.md) describes what the pipeline _is_ and the
contract it honours. This file is the operational counterpart: what to run, what it needs,
and what to do when the pipeline is not wired up.

## Why you may have no pipeline at all

`.github/workflows/gtnh-dataset-pipeline.yml` is the entry point. GitHub does **not** copy
`.github/workflows/` into a fork, so a forked clone starts with no pipeline, no deploy
workflow, and no runs — even though every script under `tools/dataset-pipeline/scripts/`
came across intact.

Restoring the file is not enough to make it run. All four jobs (`detect`, `build`,
`publish`, `deploy`) target a self-hosted runner and write to that machine's filesystem:

```yaml
runs-on: [self-hosted, Linux, X64, gtnh-export]
```

With no matching runner the jobs queue until GitHub times them out. Check what you actually
have before assuming the pipeline works:

```bash
gh api repos/<owner>/<repo>/actions/workflows --jq '.total_count'
gh api repos/<owner>/<repo>/actions/runners   --jq '.total_count'
gh api repos/<owner>/<repo>/actions/secrets   --jq '.total_count'
```

The workflow has been restored here, with one deliberate change from upstream: its
`schedule:` triggers are commented out. Upstream runs `*/30 * * * *` and a daily
`35 5 * * *`. Scheduled workflows fire only from the **default branch**, so those crons are
inert on a feature branch and go live the moment the file lands on `main` — where, with no
runner, each run queues until GitHub expires it at 24h and marks it failed. The
`concurrency` group keeps at most one run active and one pending, so the cost is a stream
of cancelled run entries and failure notifications rather than exhausted capacity.

`workflow_dispatch` and `repository_dispatch` are untouched, so a manual run works the
moment a runner exists. Restore the crons in the same change that registers the runner.

## Run locally (verification only, publishes nothing)

Use this to confirm a normalizer change lands in the generated dataset. Output goes to
`public/datasets/gtnh/`, which is gitignored. Nothing reaches a server — the `publish`
argument to `run-dataset-in-docker.sh` only prints a reminder.

Needs Docker, ~10 GB RAM available to the engine, and tens of GB of disk. The client pass
downloads the GTNH pack and renders item icons in a headless Forge 1.7.10 client under
Xvfb, so budget hours, not minutes.

The wrapper runs every detected version for a channel:

```bash
GTNH_DATASET_DOCKER_CPUS=4 \
  ./tools/dataset-pipeline/scripts/run-dataset-in-docker.sh stable false
```

`run-dataset-in-docker.sh` defaults to `--cpus=8`. Override `GTNH_DATASET_DOCKER_CPUS` to
your real core count or Docker rejects the run.

To drive the stages by hand — useful when you want to inspect between them — build the
image once, then run `detect` and `generate` separately:

```bash
docker build -t gtnh-factory-flow-dataset:java21 -f tools/dataset-pipeline/docker/Dockerfile .

docker run --rm \
  -e CHANNEL=stable -e "GITHUB_TOKEN=$(gh auth token)" \
  -e GTNH_DATASETS_ROOT=/datasets -e HOME=/tmp \
  -v "$PWD/public/datasets/gtnh:/datasets" -v "$PWD:/workspace" -w /workspace \
  gtnh-factory-flow-dataset:java21 \
  node tools/dataset-pipeline/scripts/detect-gtnh-versions.mjs
```

`detect` writes `.pipeline/detected-versions.json` and prints a `matrix=` line. Feed the
chosen version's fields into `generate-dataset.mjs` as `GTNH_VERSION_ID`,
`GTNH_VERSION_LABEL`, `GTNH_SOURCE_KIND`, `GTNH_SOURCE_REF`, and `GTNH_SOURCE_URL`,
matching the `build` job in the workflow.

Point the cache directories at persistent paths outside the repo so a retry does not
re-download the pack:

| variable                        | holds                                           |
| ------------------------------- | ----------------------------------------------- |
| `GTNH_PACK_CACHE_DIR`           | downloaded GTNH pack                            |
| `GTNH_ORACLE_BUILD_CACHE_DIR`   | built oracle mod                                |
| `GTNH_CLIENT_RUNTIME_CACHE_DIR` | Forge/Minecraft runtime                         |
| `GTNH_ICON_CACHE_DIR`           | rendered icons, keyed by `GTNH_ATLAS_ICON_SIZE` |

On Windows, run from Git Bash with `MSYS_NO_PATHCONV=1` and build mount paths from
`$(pwd -W)`; otherwise MSYS rewrites the container-side path and the mount lands in the
wrong place.

The container mounts the repo read-write and runs `npm install`, so its npm rewrites your
`package-lock.json` in place. If the image's npm is older than yours the diff is real but
unwanted — npm 10 drops the `libc` fields npm 11+ writes. Check `git status` after a run and
`git checkout -- package-lock.json` if it moved.

Line endings are the other Windows trap. The container runs the repo's own
`gtnh-calc-oracle/gradlew`, and a CRLF checkout turns its shebang into `/bin/sh\r`:

```
./gradlew: /bin/sh^M: bad interpreter: No such file or directory
Error: server oracle export failed with exit code 126.
```

`.gitattributes` already pins everything to `eol=lf`, but Git does not renormalize files
that were checked out before it was added, so a long-lived Windows clone can still hold
CRLF. The committed blobs are fine — only the working tree is stale. Confirm, then
re-materialize the affected subtree:

```bash
git ls-files | while read -r f; do
  [ -f "$f" ] && case "$(file -b "$f")" in *CRLF*) echo "$f";; esac
done

git ls-files tools/dataset-pipeline/gtnh-calc-oracle | while read -r f; do rm -f "$f"; done
git checkout -- tools/dataset-pipeline/gtnh-calc-oracle
```

Re-checkout only paths with no uncommitted work; the delete-and-restore step discards
local modifications.

## Verify a normalizer change without running the pipeline

Reach for this first. `normalize-oracle-export.mjs` is a plain CLI over JSON —
`node normalize-oracle-export.mjs <input> <output>` — so a change to it can be proven
against a hand-written oracle export in seconds. No Docker, no pack download, no Minecraft.
This is the "targeted synthetic dataset check" `AGENTS.md` asks for on normalizer changes,
and it isolates the normalizer from every unrelated way the client export can fail.

Write an export containing only what the change touches. The shape is
`{ format, domains: [{ id, ... }] }`, where `findDomain` selects by `id` — `gregtech` holds
`recipeMaps: [{ id, name, icon, catalysts, recipes }]`. Cover the negative cases too; the
guards are usually where the bug is:

```bash
GTNH_DATASET_VERSION_ID=synthetic-test \
GTNH_DATASET_VERSION_LABEL=synthetic \
GTNH_ORACLE_STRICT=false \
  node tools/dataset-pipeline/scripts/normalize-oracle-export.mjs \
    /tmp/synthetic-oracle-export.json /tmp/out/recipes.json
```

`GTNH_DATASET_VERSION_ID` and `GTNH_DATASET_VERSION_LABEL` are required. Leave
`GTNH_ORACLE_STRICT` off, or strict mode rejects a synthetic recipe for lacking computed
runtime variants.

Per-recipe provenance lands under **`source`**, not `machine` — `machine` is the app-side
name in `recipeSchema`, and confusing the two makes a working field read as missing:

```bash
node -e '
  const d = require("/tmp/out/recipes.json");
  for (const r of d.recipes) {
    console.log((r.source?.recipeMap ?? "?").padEnd(24), "->",
      r.source?.machineBlock?.id ?? "none");
  }'
```

### Confirming a change reached a generated dataset

After a real run the dataset is gzipped. Check the field rather than trusting exit zero:

```bash
gunzip -c public/datasets/gtnh/stable-<version>/recipes.json.gz \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const r=JSON.parse(s).recipes;
      const n=r.filter(x=>x.source?.machineBlock).length;
      console.log(`${n}/${r.length} recipes carry source.machineBlock`);
      console.log(JSON.stringify(r.find(x=>x.source?.machineBlock)?.source,null,2));
    })'
```

`AGENTS.md` says to verify the published `recipes.json.gz` or indexes after a publish, not
only CI status. Same applies locally.

## Make a deployed server able to rebuild

The published pipeline expects the runner and the production host to be **the same
machine** — `publish` writes the dataset volume and `deploy` restarts the site container
from that volume. Wire it up in this order.

### 1. Register the runner

Install a GitHub Actions self-hosted runner on the server, as the same user that owns the
app, with all four labels:

```
self-hosted, Linux, X64, gtnh-export
```

Install it as a service so it survives reboots. Confirm with:

```bash
gh api repos/<owner>/<repo>/actions/runners --jq '.runners[] | {name, status, labels: [.labels[].name]}'
```

### 2. Give it Docker and headroom

Every job shells out to `docker build` / `docker run`, so the runner user needs a working
Docker daemon. The `build` job asks for `--memory=10g --memory-swap=12g --cpus=8
--shm-size=2g` and allows up to 6 hours (`GTNH_EXPORT_TIMEOUT_SECONDS: 21600`, job
`timeout-minutes: 360`). A host that cannot satisfy those needs the values lowered in the
workflow, not silently clamped.

### 3. Create the directory layout

Under the runner user's `$HOME`:

```
data/gtnh-factory-flow/datasets/gtnh/     # published datasets + datasets.manifest.json
data/gtnh-factory-flow/staging/           # per-run staging, cleaned up after publish
data/gtnh-factory-flow/pipeline-cache/    # pack, oracle, client-runtime caches
data/gtnh-factory-flow/icon-cache/        # keyed by icon size
apps/gtnh-factory-flow/releases/          # deploy job builds releases here
apps/gtnh-factory-flow/analytics.env      # env-file for the site container (may be empty)
```

`deploy` symlinks the dataset volume into each release at
`public/datasets/gtnh`, so the browser keeps reading `/datasets/gtnh/...`.

### 4. Add the secret if you override the exporter

`GTNH_CLIENT_EXPORT_COMMAND` is optional. Unset, the pipeline uses the in-repo default
runner `tools/dataset-pipeline/scripts/run-gtnh-oracle-export.sh`. Set it only to point at
a different private runner.

### 5. Restore the workflow

If the file is missing and an upstream repo still has it, take it from there rather than
rewriting:

```bash
gh api repos/<upstream>/<repo>/contents/.github/workflows/gtnh-dataset-pipeline.yml \
  --jq '.content' | base64 -d > .github/workflows/gtnh-dataset-pipeline.yml
```

`deploy-site.yml` and `deploy-umami.yml` live beside it and are also `gtnh-export`-only. A
fork missing `deploy-site.yml` does not deploy on push, whatever the branch — worth
checking before treating a merge to `main` as a release.

### 6. Trigger a run

```bash
gh workflow run "GTNH dataset pipeline" --ref develop \
  -f channel=both -f publish=true -f force_rebuild=true

gh run watch <run-id> --exit-status
```

`publish` only runs for a schedule, a `repository_dispatch`, or when `publish`/
`force_rebuild` is true, and it refuses to publish a version whose staged output is missing
any of `recipes.json.gz`, `resource-index.json.gz`, `recipe-index.json.gz`, or
`recipe-lookup-index.json.gz`. A partial export is skipped with a warning rather than
published.

## If the server is not yours

Datasets are published to whichever host runs the pipeline. When the deployment belongs to
an upstream repo, a change to `tools/dataset-pipeline/scripts/` only reaches the live
dataset once it lands **upstream** and upstream runs the pipeline. Merging inside a fork
rebuilds nothing. Use the local run above to prove the change is correct, then send it
upstream.
