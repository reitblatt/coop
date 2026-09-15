/**
 * In-process probe, loaded via `node --require perf/lib/probe.cjs`.
 *
 * Records what /proc can't see: V8 heap composition, libuv handle counts, event
 * loop delay, and (on SIGUSR2) a heap snapshot. Writes JSONL to COOP_PROBE_OUT.
 *
 * Env:
 *   COOP_PROBE_OUT          JSONL destination (default: ./probe.jsonl)
 *   COOP_PROBE_INTERVAL_MS  sample interval (default: 1000)
 *   COOP_PROBE_SNAPSHOT_DIR heap snapshot destination (default: cwd)
 */
const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');
const { monitorEventLoopDelay } = require('node:perf_hooks');

const out = process.env.COOP_PROBE_OUT ?? './probe.jsonl';
const intervalMs = Number(process.env.COOP_PROBE_INTERVAL_MS ?? 1000);
const snapshotDir = process.env.COOP_PROBE_SNAPSHOT_DIR ?? process.cwd();
const bootHrtime = process.hrtime.bigint();

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const stream = fs.createWriteStream(out, { flags: 'a' });

const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

function handleCounts() {
  // `_getActiveHandles` is undocumented but stable, and is the only way to see
  // what libuv is holding open (sockets, timers) without an inspector session.
  const counts = {};
  const handles = process._getActiveHandles?.() ?? [];
  for (const handle of handles) {
    const name = handle?.constructor?.name ?? 'Unknown';
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return { total: handles.length, byType: counts };
}

function sample(event) {
  const heap = v8.getHeapStatistics();
  const spaces = {};
  for (const space of v8.getHeapSpaceStatistics()) {
    spaces[space.space_name] = space.space_used_size;
  }
  const memory = process.memoryUsage();
  const record = {
    ts: Date.now(),
    uptimeS: Math.round(process.uptime() * 10) / 10,
    event: event ?? 'sample',
    rss: memory.rss,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    heapSizeLimit: heap.heap_size_limit,
    mallocedMemory: heap.malloced_memory,
    peakMallocedMemory: heap.peak_malloced_memory,
    numberOfNativeContexts: heap.number_of_native_contexts,
    numberOfDetachedContexts: heap.number_of_detached_contexts,
    heapSpaces: spaces,
    handles: handleCounts(),
    eventLoopDelayP99Ms: Math.round(loopDelay.percentile(99) / 1000) / 1000,
    eventLoopDelayMeanMs: Math.round(loopDelay.mean / 1000) / 1000,
    cpu: process.cpuUsage(),
  };
  stream.write(`${JSON.stringify(record)}\n`);
  loopDelay.reset();
}

// Timestamp the moment the app's own module graph starts loading, so startup
// cost splits into "node boot" vs "coop imports".
sample('probe-loaded');

const timer = setInterval(() => sample(), intervalMs);
timer.unref();

process.on('SIGUSR2', () => {
  const file = path.join(snapshotDir, `heap-${Date.now()}.heapsnapshot`);
  sample('pre-snapshot');
  v8.writeHeapSnapshot(file);
  sample('post-snapshot');
  process.stderr.write(`[probe] wrote heap snapshot: ${file}\n`);
});

process.on('exit', () => {
  const elapsedMs = Number(process.hrtime.bigint() - bootHrtime) / 1e6;
  stream.write(
    `${JSON.stringify({ ts: Date.now(), event: 'exit', elapsedMs })}\n`,
  );
});
