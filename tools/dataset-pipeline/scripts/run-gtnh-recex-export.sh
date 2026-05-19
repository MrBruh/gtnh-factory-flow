#!/usr/bin/env bash
set -euo pipefail

: "${GTNH_DATASET_OUT_DIR:?GTNH_DATASET_OUT_DIR is required}"
: "${GTNH_RAW_EXPORT_DIR:?GTNH_RAW_EXPORT_DIR is required}"
: "${GTNH_INSTANCE_DIR:?GTNH_INSTANCE_DIR is required}"
: "${GTNH_DATASET_VERSION_ID:?GTNH_DATASET_VERSION_ID is required}"
: "${GTNH_DATASET_VERSION_LABEL:?GTNH_DATASET_VERSION_LABEL is required}"
: "${GTNH_DATASET_CHANNEL:?GTNH_DATASET_CHANNEL is required}"

export GTNH_EXPORT_PACK_KIND="${GTNH_EXPORT_PACK_KIND:-server}"
export GTNH_EXPORT_TIMEOUT_SECONDS="${GTNH_EXPORT_TIMEOUT_SECONDS:-7200}"
export GTNH_EXPORT_MAX_MEMORY="${GTNH_EXPORT_MAX_MEMORY:-8G}"

mkdir -p "$GTNH_DATASET_OUT_DIR" "$GTNH_RAW_EXPORT_DIR" "$GTNH_INSTANCE_DIR"

pack_archive="$GTNH_RAW_EXPORT_DIR/gtnh-pack.zip"
recex_work="$GTNH_RAW_EXPORT_DIR/recex-autostart"

node tools/dataset-pipeline/scripts/download-gtnh-pack.mjs "$pack_archive"

rm -rf "$GTNH_INSTANCE_DIR/pack"
mkdir -p "$GTNH_INSTANCE_DIR/pack"
unzip -q "$pack_archive" -d "$GTNH_INSTANCE_DIR/pack"

if ! instance_root="$(node tools/dataset-pipeline/scripts/find-gtnh-instance-root.mjs "$GTNH_INSTANCE_DIR/pack" 2>/tmp/gtnh-find-root.err)"; then
  nested_pack="$(find "$GTNH_INSTANCE_DIR/pack" -maxdepth 3 -type f -name '*.zip' | sort | head -n 1)"
  if [[ -z "$nested_pack" ]]; then
    cat /tmp/gtnh-find-root.err >&2
    exit 1
  fi

  rm -rf "$GTNH_INSTANCE_DIR/pack-content"
  mkdir -p "$GTNH_INSTANCE_DIR/pack-content"
  unzip -q "$nested_pack" -d "$GTNH_INSTANCE_DIR/pack-content"
  instance_root="$(node tools/dataset-pipeline/scripts/find-gtnh-instance-root.mjs "$GTNH_INSTANCE_DIR/pack-content")"
fi
mkdir -p "$instance_root/mods"

rm -rf "$recex_work"
git clone --depth 1 https://github.com/GTNewHorizons/RecEx.git "$recex_work"
node tools/dataset-pipeline/scripts/patch-recex-autorun.mjs "$recex_work"

chmod +x "$recex_work/gradlew"
(cd "$recex_work" && ./gradlew --no-daemon build -x spotlessJavaCheck)
recex_jar="$(find "$recex_work/build/libs" -maxdepth 1 -type f -name 'RecEx-*.jar' ! -name '*sources*' ! -name '*dev*' | sort | tail -n 1)"
cp "$recex_jar" "$instance_root/mods/"

cat > "$instance_root/eula.txt" <<'EOF'
eula=true
EOF

if [[ -f "$instance_root/server.properties" ]]; then
  sed -i 's/^online-mode=.*/online-mode=false/' "$instance_root/server.properties"
fi

start_script="$(find "$instance_root" -maxdepth 2 -type f \( -iname '*start*server*.sh' -o -iname 'startserver*.sh' -o -iname 'ServerStart*.sh' \) | sort | head -n 1)"

if [[ -z "$start_script" ]]; then
  echo "No GTNH server start script found in $instance_root" >&2
  exit 1
fi

chmod +x "$start_script"
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Drecex.autorun=true -Xmx${GTNH_EXPORT_MAX_MEMORY}"

set +e
timeout "$GTNH_EXPORT_TIMEOUT_SECONDS" bash -lc "cd '$instance_root' && bash '$start_script'"
exit_code=$?
set -e

if [[ "$exit_code" != "0" && "$exit_code" != "124" ]]; then
  echo "GTNH export process exited with code $exit_code" >&2
  exit "$exit_code"
fi

raw_recex_json="$(find "$instance_root/RecEx-Records" -type f -name '*.json' 2>/dev/null | sort | tail -n 1)"

if [[ -z "$raw_recex_json" ]]; then
  echo "RecEx did not produce a JSON export under $instance_root/RecEx-Records" >&2
  exit 1
fi

cp "$raw_recex_json" "$GTNH_RAW_EXPORT_DIR/recex-export.json"
node tools/dataset-pipeline/scripts/normalize-recex-export.mjs "$raw_recex_json" "$GTNH_DATASET_OUT_DIR/recipes.json"
