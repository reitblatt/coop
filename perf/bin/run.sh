#!/usr/bin/env bash
# End-to-end resource measurement for the Coop API server.
#
# Boots the built server against the docker-compose backing services, then walks
# it through cold start -> idle -> load phases -> soak, capturing OS-level
# samples, in-process heap stats, heap snapshots and load-generator results.
# Produces a diffable summary.json / summary.md under perf/results/<run-id>/.
#
#   npm run up                                   # backing services
#   (cd server && npm run build)                 # transpiled/ must exist
#   perf/bin/run.sh --run-id baseline
#
# Requires fixtures (see perf/README.md):
#   node perf/bin/setup-fixtures.mjs --email ... --password ... --api-key ...

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

RUN_ID="run-$(date -u +%Y%m%dT%H%M%SZ)"
IDLE_S=120
LOAD_S=45
SOAK_S=420
SOAK_CONCURRENCY=25
SETTLE_S=180
PORT=8080
SNAPSHOTS=0
WITH_WORKER=0
BOOT_ONLY=0
NODE_ARGS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --idle-s) IDLE_S="$2"; shift 2 ;;
    --load-s) LOAD_S="$2"; shift 2 ;;
    --soak-s) SOAK_S="$2"; shift 2 ;;
    --soak-concurrency) SOAK_CONCURRENCY="$2"; shift 2 ;;
    --settle-s) SETTLE_S="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --with-worker) WITH_WORKER=1; shift ;;
    --boot-only) BOOT_ONLY=1; shift ;;
    --node-args) NODE_ARGS="$2"; shift 2 ;;
    --snapshots) SNAPSHOTS=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

OUT_DIR="$REPO_ROOT/perf/results/$RUN_ID"
RAW_DIR="$OUT_DIR/raw"
mkdir -p "$RAW_DIR"
BASE_URL="http://localhost:$PORT/api/v1"
CONTAINERS="$(docker ps --format '{{.Names}}' | grep '^coop-' | paste -sd, - || true)"

echo "==> run id: $RUN_ID  (out: $OUT_DIR)"

# --- metadata --------------------------------------------------------------
node -e '
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");
const git = (cmd) => { try { return execSync(cmd).toString().trim(); } catch { return null; } };
fs.writeFileSync(process.argv[1], JSON.stringify({
  runId: process.argv[2],
  nodeArgs: process.argv[3] ?? "",
  startedAt: new Date().toISOString(),
  gitSha: git("git rev-parse --short HEAD"),
  gitDirty: git("git status --porcelain") !== "",
  host: {
    cpus: os.cpus().length,
    availableParallelism: os.availableParallelism(),
    memTotalGib: Math.round(os.totalmem() / 2 ** 30 * 10) / 10,
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
  },
}, null, 2) + "\n");
' "$OUT_DIR/meta.json" "$RUN_ID" "$NODE_ARGS"

# --- disk footprint --------------------------------------------------------
echo "==> measuring disk footprint"
"$REPO_ROOT/perf/bin/footprint.sh" > "$OUT_DIR/footprint.json"

# --- cold start ------------------------------------------------------------
echo "==> cold start"
PROBE_OUT="$RAW_DIR/probe-server.jsonl"
SERVER_LOG="$RAW_DIR/server.log"
export COOP_PROBE_OUT="$PROBE_OUT"
export COOP_PROBE_INTERVAL_MS=1000
export COOP_PROBE_SNAPSHOT_DIR="$RAW_DIR"

START_NS=$(date +%s%N)
(
  cd "$REPO_ROOT/server"
  # shellcheck disable=SC2086 -- NODE_ARGS is intentionally word-split
  exec node $NODE_ARGS \
    --require "$REPO_ROOT/perf/lib/probe.cjs" \
    --env-file-if-exists=.env \
    ./transpiled/bin/www.js
) > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
  for pid in "${SERVER_PID:-}" "${WORKER_PID:-}" "${SAMPLER_PID:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

# Poll /ready rather than parsing logs: it is the same signal a load balancer
# would use, so "boot time" means "time until it can serve traffic".
READY_NS=""
for _ in $(seq 1 600); do
  if curl -fsS -o /dev/null "$BASE_URL/ready" 2>/dev/null; then
    READY_NS=$(date +%s%N)
    break
  fi
  sleep 0.1
done
if [[ -z "$READY_NS" ]]; then
  echo "server never became ready; see $SERVER_LOG" >&2
  tail -20 "$SERVER_LOG" >&2
  exit 1
fi

BOOT_MS=$(( (READY_NS - START_NS) / 1000000 ))
echo "    ready in ${BOOT_MS} ms (pid $SERVER_PID)"

# --- item processing worker (optional) -------------------------------------
SAMPLE_PIDS="$SERVER_PID"
if [[ "$WITH_WORKER" == "1" ]]; then
  echo "==> starting ItemProcessingWorker"
  (
    cd "$REPO_ROOT/server"
    export COOP_PROBE_OUT="$RAW_DIR/probe-worker.jsonl"
    # shellcheck disable=SC2086 -- NODE_ARGS is intentionally word-split
    exec node $NODE_ARGS \
      --require "$REPO_ROOT/perf/lib/probe.cjs" \
      --env-file-if-exists=.env \
      ./transpiled/bin/run-worker-or-job.js ItemProcessingWorker
  ) > "$RAW_DIR/worker.log" 2>&1 &
  WORKER_PID=$!
  SAMPLE_PIDS="$SERVER_PID,$WORKER_PID"
  sleep 8
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "worker exited early; see $RAW_DIR/worker.log" >&2
    tail -5 "$RAW_DIR/worker.log" >&2
  fi
fi

sample_phase() { # label duration_s
  node "$REPO_ROOT/perf/lib/sampler.mjs" \
    --pid "$SAMPLE_PIDS" \
    --containers "$CONTAINERS" \
    --out "$RAW_DIR/$1.jsonl" \
    --interval-ms 1000 \
    --duration-s "$2" \
    --label "$1" &
  SAMPLER_PID=$!
}

# Writing a heap snapshot permanently inflates the process's RSS (V8 does not
# hand that memory back), so snapshots are opt-in: a run used for absolute RSS
# comparisons should not take them.
snapshot() { # tag
  [[ "$SNAPSHOTS" == "1" ]] || return 0
  kill -USR2 "$SERVER_PID"
  sleep 4
  local newest
  newest=$(ls -t "$RAW_DIR"/heap-*.heapsnapshot 2>/dev/null | head -1)
  if [[ -n "$newest" ]]; then mv "$newest" "$RAW_DIR/heap-$1.heapsnapshot"; fi
}

# --- idle ------------------------------------------------------------------
echo "==> idle for ${IDLE_S}s"
sample_phase idle "$IDLE_S"
wait "$SAMPLER_PID" || true
snapshot idle

node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({
  bootToReadyMs: Number(process.argv[2]),
}, null, 2) + "\n");
' "$OUT_DIR/startup.json" "$BOOT_MS"

if [[ "$BOOT_ONLY" == "1" ]]; then
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  if [[ -n "${WORKER_PID:-}" ]]; then kill "$WORKER_PID" 2>/dev/null || true; fi
  trap - EXIT
  node "$REPO_ROOT/perf/bin/summarize.mjs" --dir "$OUT_DIR"
  echo "==> done (boot only): $OUT_DIR/summary.md"
  exit 0
fi

# --- load phases -----------------------------------------------------------
run_load() { # label scenario concurrency duration
  echo "==> load: $1 ($2, c=$3, ${4}s)"
  sample_phase "$1" "$4"
  node "$REPO_ROOT/perf/bin/load.mjs" \
    --scenario "$2" \
    --concurrency "$3" \
    --duration-s "$4" \
    --label "$1" \
    --base-url "$BASE_URL" \
    --out "$RAW_DIR/load-$1.json" > /dev/null
  wait "$SAMPLER_PID" || true
}

run_load ready ready 25 "$LOAD_S"
run_load graphql graphql-me 25 "$LOAD_S"
run_load ingest items-async 25 "$LOAD_S"

# --- soak ------------------------------------------------------------------
echo "==> soak for ${SOAK_S}s at concurrency $SOAK_CONCURRENCY"
snapshot pre-soak
sample_phase soak "$SOAK_S"
node "$REPO_ROOT/perf/bin/load.mjs" \
  --scenario mixed \
  --concurrency "$SOAK_CONCURRENCY" \
  --duration-s "$SOAK_S" \
  --label soak \
  --base-url "$BASE_URL" \
  --out "$RAW_DIR/load-soak.json" > /dev/null
wait "$SAMPLER_PID" || true
snapshot post-soak

# --- settle: does RSS come back down once load stops? ----------------------
echo "==> post-load settle (${SETTLE_S}s idle)"
sample_phase settle "$SETTLE_S"
wait "$SAMPLER_PID" || true
# A settled snapshot answers the question the soak raises: was the growth a
# backlog that drains, or retention that does not?
snapshot settled

# --- shutdown --------------------------------------------------------------
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
if [[ -n "${WORKER_PID:-}" ]]; then
  kill "$WORKER_PID" 2>/dev/null || true
  wait "$WORKER_PID" 2>/dev/null || true
fi
trap - EXIT

node "$REPO_ROOT/perf/bin/summarize.mjs" --dir "$OUT_DIR"
echo "==> done: $OUT_DIR/summary.md"
