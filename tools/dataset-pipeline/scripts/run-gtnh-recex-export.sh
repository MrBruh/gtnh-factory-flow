#!/usr/bin/env bash
set -euo pipefail

: "${GTNH_DATASET_OUT_DIR:?GTNH_DATASET_OUT_DIR is required}"
: "${GTNH_RAW_EXPORT_DIR:?GTNH_RAW_EXPORT_DIR is required}"
: "${GTNH_INSTANCE_DIR:?GTNH_INSTANCE_DIR is required}"
: "${GTNH_DATASET_VERSION_ID:?GTNH_DATASET_VERSION_ID is required}"
: "${GTNH_DATASET_VERSION_LABEL:?GTNH_DATASET_VERSION_LABEL is required}"
: "${GTNH_DATASET_CHANNEL:?GTNH_DATASET_CHANNEL is required}"

export GTNH_EXPORT_PACK_KIND="${GTNH_EXPORT_PACK_KIND:-server}"
export GTNH_EXPORT_TIMEOUT_SECONDS="${GTNH_EXPORT_TIMEOUT_SECONDS:-2700}"
export GTNH_EXPORT_MAX_MEMORY="${GTNH_EXPORT_MAX_MEMORY:-12G}"

mkdir -p "$GTNH_DATASET_OUT_DIR" "$GTNH_RAW_EXPORT_DIR" "$GTNH_INSTANCE_DIR"

pack_archive="$GTNH_RAW_EXPORT_DIR/gtnh-pack.zip"
recex_work="$GTNH_RAW_EXPORT_DIR/recex-autostart"
runner_log="$GTNH_RAW_EXPORT_DIR/export-runner.log"
server_log="$GTNH_RAW_EXPORT_DIR/gtnh-server.log"

exec > >(tee -a "$runner_log") 2>&1

echo "GTNH export runner started at $(date -u --iso-8601=seconds)"
echo "Dataset: $GTNH_DATASET_VERSION_ID ($GTNH_DATASET_CHANNEL $GTNH_DATASET_VERSION_LABEL)"
echo "Memory: $GTNH_EXPORT_MAX_MEMORY"
echo "Timeout: ${GTNH_EXPORT_TIMEOUT_SECONDS}s"

node tools/dataset-pipeline/scripts/download-gtnh-pack.mjs "$pack_archive"

rm -rf "$GTNH_INSTANCE_DIR/pack"
mkdir -p "$GTNH_INSTANCE_DIR/pack"
unzip -q "$pack_archive" -d "$GTNH_INSTANCE_DIR/pack"
chmod -R u+rwX "$GTNH_INSTANCE_DIR/pack"

if ! instance_root="$(node tools/dataset-pipeline/scripts/find-gtnh-instance-root.mjs "$GTNH_INSTANCE_DIR/pack" 2>/tmp/gtnh-find-root.err)"; then
  nested_pack="$(find "$GTNH_INSTANCE_DIR/pack" -maxdepth 3 -type f -name '*.zip' 2>/dev/null | sort | head -n 1)"
  if [[ -z "$nested_pack" ]]; then
    cat /tmp/gtnh-find-root.err >&2
    exit 1
  fi

  rm -rf "$GTNH_INSTANCE_DIR/pack-content"
  mkdir -p "$GTNH_INSTANCE_DIR/pack-content"
  unzip -q "$nested_pack" -d "$GTNH_INSTANCE_DIR/pack-content"
  chmod -R u+rwX "$GTNH_INSTANCE_DIR/pack-content"
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
start_script="$(realpath "$start_script")"
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Drecex.autorun=true"
export _JAVA_OPTIONS="${_JAVA_OPTIONS:-} -Xms4G -Xmx${GTNH_EXPORT_MAX_MEMORY}"

setsid bash -lc "cd '$instance_root' && bash '$start_script'" >"$server_log" 2>&1 &
server_pid=$!
tail -n +1 -f "$server_log" &
tail_pid=$!

raw_recex_json=""
deadline=$((SECONDS + GTNH_EXPORT_TIMEOUT_SECONDS))

while (( SECONDS < deadline )); do
  raw_recex_json="$(find "$instance_root/RecEx-Records" -type f -name '*.json' 2>/dev/null | sort | tail -n 1 || true)"
  if [[ -n "$raw_recex_json" ]]; then
    current_size="$(stat -c%s "$raw_recex_json")"
    sleep 5
    next_size="$(stat -c%s "$raw_recex_json")"
    if [[ "$current_size" == "$next_size" ]]; then
      echo "Detected completed RecEx export: $raw_recex_json"
      break
    fi
  fi

  if ! kill -0 "$server_pid" 2>/dev/null; then
    wait "$server_pid"
    server_exit=$?
    echo "GTNH server process exited with code $server_exit before producing a RecEx export." >&2
    exit "$server_exit"
  fi

  sleep 5
done

kill "$tail_pid" 2>/dev/null || true
kill -TERM "-$server_pid" 2>/dev/null || true
sleep 5
kill -KILL "-$server_pid" 2>/dev/null || true

if [[ -z "$raw_recex_json" ]]; then
  echo "RecEx did not produce a JSON export under $instance_root/RecEx-Records" >&2
  exit 1
fi

cp "$raw_recex_json" "$GTNH_RAW_EXPORT_DIR/recex-export.json"
node tools/dataset-pipeline/scripts/normalize-recex-export.mjs "$raw_recex_json" "$GTNH_DATASET_OUT_DIR/recipes.json"
