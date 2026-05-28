#!/usr/bin/env bash
set -euo pipefail

: "${GTNH_DATASET_OUT_DIR:?GTNH_DATASET_OUT_DIR is required}"
: "${GTNH_RAW_EXPORT_DIR:?GTNH_RAW_EXPORT_DIR is required}"
: "${GTNH_INSTANCE_DIR:?GTNH_INSTANCE_DIR is required}"
: "${GTNH_DATASET_VERSION_ID:?GTNH_DATASET_VERSION_ID is required}"
: "${GTNH_DATASET_VERSION_LABEL:?GTNH_DATASET_VERSION_LABEL is required}"
: "${GTNH_DATASET_CHANNEL:?GTNH_DATASET_CHANNEL is required}"

export GTNH_EXPORT_PACK_KIND="${GTNH_EXPORT_PACK_KIND:-client}"
export GTNH_EXPORT_TIMEOUT_SECONDS="${GTNH_EXPORT_TIMEOUT_SECONDS:-21600}"
export GTNH_EXPORT_MAX_MEMORY="${GTNH_EXPORT_MAX_MEMORY:-6G}"
export GTNH_RENDER_STACK_ICONS="${GTNH_RENDER_STACK_ICONS:-true}"
export GTNH_ICON_EXPORT_BATCH_SIZE="${GTNH_ICON_EXPORT_BATCH_SIZE:-64}"
export GTNH_ATLAS_ICON_SIZE="${GTNH_ATLAS_ICON_SIZE:-256}"
export GTNH_ICON_CACHE_DIR="${GTNH_ICON_CACHE_DIR:-$HOME/.cache/gtnh-factory-flow/icons/$GTNH_ATLAS_ICON_SIZE}"
export GTNH_EXPORT_DISABLE_CLIENT_UI_MODS="${GTNH_EXPORT_DISABLE_CLIENT_UI_MODS:-false}"
export GTNH_EXPORT_FAIL_FAST_ON_FATAL_LOGS="${GTNH_EXPORT_FAIL_FAST_ON_FATAL_LOGS:-true}"

mkdir -p "$GTNH_DATASET_OUT_DIR" "$GTNH_RAW_EXPORT_DIR" "$GTNH_INSTANCE_DIR"

pack_archive="$GTNH_RAW_EXPORT_DIR/gtnh-pack.zip"
recex_work="$GTNH_RAW_EXPORT_DIR/recex-autostart"
runner_log="$GTNH_RAW_EXPORT_DIR/export-runner.log"
runtime_log="$GTNH_RAW_EXPORT_DIR/gtnh-runtime.log"
rendered_icon_dir="$(realpath -m "$GTNH_RAW_EXPORT_DIR/rendered-icons")"
export GTNH_RENDERED_ICON_DIR="$rendered_icon_dir"

exec > >(tee -a "$runner_log") 2>&1

echo "GTNH export runner started at $(date -u --iso-8601=seconds)"
echo "Dataset: $GTNH_DATASET_VERSION_ID ($GTNH_DATASET_CHANNEL $GTNH_DATASET_VERSION_LABEL)"
echo "Memory: $GTNH_EXPORT_MAX_MEMORY"
echo "Timeout: ${GTNH_EXPORT_TIMEOUT_SECONDS}s"
echo "Pack kind: $GTNH_EXPORT_PACK_KIND"
echo "GTNH 1.7.10 icon exporter: $GTNH_RENDER_STACK_ICONS"
echo "Icon export batch size: $GTNH_ICON_EXPORT_BATCH_SIZE"
echo "Atlas icon size: $GTNH_ATLAS_ICON_SIZE"
echo "Shared icon cache: $GTNH_ICON_CACHE_DIR"
echo "Disable client UI-only mods: $GTNH_EXPORT_DISABLE_CLIENT_UI_MODS"
echo "Fail fast on fatal runtime logs: $GTNH_EXPORT_FAIL_FAST_ON_FATAL_LOGS"

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
export GTNH_INSTANCE_ROOT="$instance_root"
mkdir -p "$instance_root/mods"

rm -rf "$recex_work"
git clone --depth 1 https://github.com/GTNewHorizons/RecEx.git "$recex_work"
node tools/dataset-pipeline/scripts/patch-recex-autorun.mjs "$recex_work"

chmod +x "$recex_work/gradlew"
gradle_java_paths=()
while IFS= read -r java_bin; do
  gradle_java_paths+=("$(dirname "$(dirname "$java_bin")")")
done < <(find /opt/java/jvm17 /opt/java/openjdk /opt/java/jdk-25 -path '*/bin/java' -type f 2>/dev/null | sort)
if (( ${#gradle_java_paths[@]} > 0 )); then
  gradle_java_paths_csv="$(IFS=,; echo "${gradle_java_paths[*]}")"
  export GRADLE_OPTS="${GRADLE_OPTS:-} -Dorg.gradle.java.installations.paths=$gradle_java_paths_csv -Dorg.gradle.java.installations.auto-download=false"
fi
if [[ -x /opt/java/jdk-25/bin/java ]]; then
  (cd "$recex_work" && JAVA_HOME=/opt/java/jdk-25 PATH="/opt/java/jdk-25/bin:$PATH" ./gradlew --no-daemon build -x spotlessJavaCheck)
else
  (cd "$recex_work" && ./gradlew --no-daemon build -x spotlessJavaCheck)
fi
recex_jar="$(find "$recex_work/build/libs" -maxdepth 1 -type f -name 'RecEx-*.jar' ! -name '*sources*' ! -name '*dev*' | sort | tail -n 1)"
find "$instance_root/mods" -type f \( -iname '*recex*.jar' -o -iname '*recipe*export*.jar' \) -print -delete
cp "$recex_jar" "$instance_root/mods/"

cat > "$instance_root/eula.txt" <<'EOF'
eula=true
EOF
mkdir -p "$rendered_icon_dir"
mkdir -p "$GTNH_ICON_CACHE_DIR"

if [[ -f "$instance_root/server.properties" ]]; then
  sed -i 's/^online-mode=.*/online-mode=false/' "$instance_root/server.properties"
fi

if [[ "$GTNH_EXPORT_DISABLE_CLIENT_UI_MODS" == "true" ]]; then
  disabled_mod_dir="$instance_root/mods/.disabled-for-recex-export"
  mkdir -p "$disabled_mod_dir"
  while IFS= read -r mod_jar; do
    echo "Disabling client UI/NEI-only mod for RecEx export: $(basename "$mod_jar")"
    mv "$mod_jar" "$disabled_mod_dir/"
  done < <(
    find "$instance_root/mods" -maxdepth 1 -type f \
      \( -iname 'visualprospecting-*.jar' \) \
      | sort
  )
fi

export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Drecex.autorun=true"
if [[ "$GTNH_RENDER_STACK_ICONS" == "true" ]]; then
  export JAVA_TOOL_OPTIONS="$JAVA_TOOL_OPTIONS -Drecex.renderIcons=true -Drecex.iconDir=$rendered_icon_dir -Drecex.iconCacheDir=$GTNH_ICON_CACHE_DIR -Drecex.iconSize=$GTNH_ATLAS_ICON_SIZE -Drecex.iconExportBatchSize=$GTNH_ICON_EXPORT_BATCH_SIZE -Djava.awt.headless=false"
fi
export _JAVA_OPTIONS="${_JAVA_OPTIONS:-} -Xms4G -Xmx${GTNH_EXPORT_MAX_MEMORY}"

if [[ "$GTNH_EXPORT_PACK_KIND" == "client" ]]; then
  client_runtime_dir="$GTNH_INSTANCE_DIR/client-runtime"
  launch_script="$(node tools/dataset-pipeline/scripts/prepare-forge-client-launch.mjs "$instance_root" "$client_runtime_dir")"
  bash tools/dataset-pipeline/scripts/install-ae2fc-nei-compat-shim.sh "$instance_root" "$client_runtime_dir" "$GTNH_RAW_EXPORT_DIR"
  if command -v xvfb-run >/dev/null 2>&1 && [[ -z "${DISPLAY:-}" ]]; then
    runtime_command="xvfb-run -a bash '$launch_script'"
  else
    runtime_command="bash '$launch_script'"
  fi
else
  start_script="$(find "$instance_root" -maxdepth 2 -type f \( -iname '*start*server*.sh' -o -iname 'startserver*.sh' -o -iname 'ServerStart*.sh' \) | sort | head -n 1)"

  if [[ -z "$start_script" ]]; then
    echo "No GTNH server start script found in $instance_root" >&2
    exit 1
  fi

  chmod +x "$start_script"
  start_script="$(realpath "$start_script")"
  runtime_command="bash '$start_script'"
fi

setsid bash -lc "cd '$instance_root' && $runtime_command" >"$runtime_log" 2>&1 &
runtime_pid=$!
tail -n +1 -f "$runtime_log" &
tail_pid=$!

stop_runtime() {
  kill "$tail_pid" 2>/dev/null || true
  kill -TERM "-$runtime_pid" 2>/dev/null || true
  sleep 5
  kill -KILL "-$runtime_pid" 2>/dev/null || true
}

fail_from_runtime_log() {
  local reason="$1"
  echo "$reason" >&2
  echo "Recent GTNH runtime log:" >&2
  tail -n 160 "$runtime_log" >&2 || true
  stop_runtime
  exit 1
}

detect_fatal_runtime_log() {
  [[ "$GTNH_EXPORT_FAIL_FAST_ON_FATAL_LOGS" == "true" ]] || return 1
  [[ -s "$runtime_log" ]] || return 1

  grep -Eq \
    'Fatal errors were detected during the transition|Minecraft ran into a problem! Report saved to:|---- Minecraft Crash Report ----|Caught exception from [A-Za-z0-9_.:-]+' \
    "$runtime_log"
}

raw_recex_json=""
deadline=$((SECONDS + GTNH_EXPORT_TIMEOUT_SECONDS))

while (( SECONDS < deadline )); do
  if detect_fatal_runtime_log; then
    fail_from_runtime_log "GTNH runtime emitted a fatal Forge/Minecraft crash log before completing the RecEx export."
  fi

  raw_recex_json="$(find "$instance_root/RecEx-Records" -type f -name '*.json' 2>/dev/null | sort | tail -n 1 || true)"
  if [[ -n "$raw_recex_json" ]]; then
    current_size="$(stat -c%s "$raw_recex_json")"
    sleep 5
    if detect_fatal_runtime_log; then
      fail_from_runtime_log "GTNH runtime emitted a fatal Forge/Minecraft crash log while waiting for the RecEx export to settle."
    fi
    next_size="$(stat -c%s "$raw_recex_json")"
    if [[ "$current_size" == "$next_size" ]]; then
      if [[ "$GTNH_RENDER_STACK_ICONS" == "true" ]]; then
        echo "Detected stable RecEx JSON file; waiting for queued icon batch and client shutdown: $raw_recex_json"
      else
        echo "Detected completed RecEx export: $raw_recex_json"
        break
      fi
    fi
  fi

  if ! kill -0 "$runtime_pid" 2>/dev/null; then
    set +e
    wait "$runtime_pid"
    runtime_exit=$?
    set -e
    if [[ -n "$raw_recex_json" && "$runtime_exit" == "0" ]]; then
      echo "GTNH runtime exited after completing RecEx export and icon batch."
      break
    fi
    echo "GTNH runtime process exited with code $runtime_exit before producing a RecEx export." >&2
    exit "$runtime_exit"
  fi

  sleep 5
done

stop_runtime

if [[ -z "$raw_recex_json" ]]; then
  echo "RecEx did not produce a JSON export under $instance_root/RecEx-Records" >&2
  exit 1
fi

cp "$raw_recex_json" "$GTNH_RAW_EXPORT_DIR/recex-export.json"
echo "Normalizing RecEx export into dataset recipes.json"
node tools/dataset-pipeline/scripts/normalize-recex-export.mjs "$raw_recex_json" "$GTNH_DATASET_OUT_DIR/recipes.json"
echo "Applying texture icons to normalized dataset"
node tools/dataset-pipeline/scripts/apply-texture-icons.mjs "$instance_root" "$GTNH_DATASET_OUT_DIR/recipes.json" "$GTNH_DATASET_OUT_DIR"
echo "RecEx export post-processing completed"
