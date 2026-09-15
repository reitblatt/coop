#!/usr/bin/env node
// Turns the raw artifacts of a run (sampler JSONL, in-process probe JSONL, load
// generator JSON) into a stable, diffable summary: summary.json + summary.md.
//
// "Stable" matters: keys are emitted in a fixed order and values are rounded,
// so `diff` between two runs shows real movement rather than sampling noise.
//
// Usage:
//   node perf/bin/summarize.mjs --dir perf/results/<run-id> [--out-prefix summary]
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const dir = args.dir ?? 'perf/results/latest';
const rawDir = path.join(dir, 'raw');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

const round = (value, digits = 1) =>
  value === null || value === undefined || Number.isNaN(value)
    ? null
    : Math.round(value * 10 ** digits) / 10 ** digits;
const kbToMib = (kb) => round(kb / 1024);
const bytesToMib = (bytes) => round(bytes / 1024 / 1024);

function statsOver(values) {
  const clean = values.filter(
    (it) => typeof it === 'number' && !Number.isNaN(it),
  );
  if (clean.length === 0) return null;
  const sorted = clean.slice().sort((a, b) => a - b);
  return {
    first: round(clean[0]),
    last: round(clean[clean.length - 1]),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    mean: round(clean.reduce((a, b) => a + b, 0) / clean.length),
    samples: clean.length,
  };
}

/**
 * Least-squares slope, used to separate "plateaued" from "still climbing".
 * A soak that ends flat has a slope near zero whatever its absolute level.
 */
function slopePerMinute(points) {
  const usable = points.filter(
    (it) => typeof it.x === 'number' && typeof it.y === 'number',
  );
  if (usable.length < 3) return null;
  const n = usable.length;
  const meanX = usable.reduce((a, b) => a + b.x, 0) / n;
  const meanY = usable.reduce((a, b) => a + b.y, 0) / n;
  const numerator = usable.reduce(
    (acc, it) => acc + (it.x - meanX) * (it.y - meanY),
    0,
  );
  const denominator = usable.reduce((acc, it) => acc + (it.x - meanX) ** 2, 0);
  if (denominator === 0) return null;
  return round((numerator / denominator) * 60, 2);
}

// --- process samples -------------------------------------------------------

const processSummary = {};
const containerSummary = {};

for (const file of fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : []) {
  if (!file.endsWith('.jsonl') || file.startsWith('probe')) continue;
  const phase = file.replace(/\.jsonl$/, '');
  const samples = readJsonl(path.join(rawDir, file));
  if (samples.length === 0) continue;

  // Group process samples by a stable key: the binary plus a short tag from the
  // command line, so pids changing between runs don't change the summary shape.
  const byKey = new Map();
  const instancesByKey = new Map();
  for (const sample of samples) {
    const seenThisSample = new Map();
    for (const proc of sample.processes ?? []) {
      if (typeof proc.rssKb !== 'number') continue; // process exited mid-sample
      const key = classify(proc.cmd);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ ...proc, elapsedS: sample.elapsedS });
      seenThisSample.set(key, (seenThisSample.get(key) ?? 0) + 1);
    }
    for (const [key, count] of seenThisSample) {
      instancesByKey.set(key, Math.max(instancesByKey.get(key) ?? 0, count));
    }
  }

  const processes = {};
  for (const [key, entries] of [...byKey.entries()].sort()) {
    const rss = statsOver(entries.map((it) => it.rssKb));
    processes[key] = {
      instances: instancesByKey.get(key) ?? 1,
      rssMib: rss
        ? {
            first: kbToMib(rss.first),
            last: kbToMib(rss.last),
            max: kbToMib(rss.max),
            mean: kbToMib(rss.mean),
          }
        : null,
      pssMib: kbToMib(statsOver(entries.map((it) => it.pssKb))?.mean ?? 0),
      peakRssMib: kbToMib(
        statsOver(entries.map((it) => it.peakRssKb))?.max ?? 0,
      ),
      threadsMax: statsOver(entries.map((it) => it.threads))?.max ?? null,
      fdsMax: statsOver(entries.map((it) => it.fds))?.max ?? null,
      cpuSecondsUsed: round(
        (statsOver(entries.map((it) => it.cpuSeconds))?.max ?? 0) -
          (statsOver(entries.map((it) => it.cpuSeconds))?.min ?? 0),
        2,
      ),
      rssSlopeMibPerMin: slopePerMinute(
        entries.map((it) => ({ x: it.elapsedS, y: it.rssKb / 1024 })),
      ),
    };
  }

  const totalRssByTs = samples.map((sample) => ({
    x: sample.elapsedS,
    y:
      (sample.processes ?? []).reduce((acc, it) => acc + (it.rssKb ?? 0), 0) /
      1024,
  }));

  processSummary[phase] = {
    durationS: round(samples[samples.length - 1].elapsedS),
    samples: samples.length,
    totalRssMib: statsOver(totalRssByTs.map((it) => it.y)),
    totalRssSlopeMibPerMin: slopePerMinute(totalRssByTs),
    processes,
  };

  const containerNames = new Set(
    samples.flatMap((it) => (it.containers ?? []).map((c) => c.name)),
  );
  if (containerNames.size > 0) {
    const containers = {};
    for (const name of [...containerNames].sort()) {
      const entries = samples.flatMap((sample) =>
        (sample.containers ?? []).filter((it) => it.name === name),
      );
      containers[name] = {
        memMib: statsOver(entries.map((it) => it.memMib)),
        cpuPercentMean: round(
          entries.reduce((a, b) => a + (b.cpuPercent ?? 0), 0) / entries.length,
        ),
        pidsMax: statsOver(entries.map((it) => it.pids))?.max ?? null,
      };
    }
    containerSummary[phase] = {
      totalMemMib: round(
        Object.values(containers).reduce(
          (acc, it) => acc + (it.memMib?.mean ?? 0),
          0,
        ),
      ),
      containers,
    };
  }
}

function classify(cmd) {
  if (!cmd) return 'unknown';
  // Shell wrappers repeat their child's command line, so they must be matched
  // before the patterns that name the child.
  if (/^(\/bin\/)?(sh|bash) -c/.test(cmd)) return 'shell';
  if (cmd.includes('bin/www')) return 'api-server';
  if (cmd.includes('run-worker-or-job')) return 'worker';
  if (cmd.includes('typescript/bin/tsc')) return 'tsc-watch(compiler)';
  if (cmd.includes('tsc-watch')) return 'tsc-watch(wrapper)';
  if (cmd.includes('graphql-codegen')) return 'graphql-codegen-watch';
  if (cmd.includes('vite')) return 'vite-dev-server';
  if (cmd.includes('esbuild')) return 'esbuild-service';
  if (cmd.includes('concurrently')) return 'concurrently';
  if (cmd.includes('sampler.mjs')) return 'perf-sampler';
  if (cmd.startsWith('sh -c') || cmd.startsWith('/bin/sh')) return 'shell';
  if (cmd.includes('npm ')) return 'npm';
  return cmd.split(' ')[0].split('/').pop() ?? 'unknown';
}

// --- in-process probe ------------------------------------------------------

const probeSummary = {};
for (const file of fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : []) {
  if (!file.startsWith('probe') || !file.endsWith('.jsonl')) continue;
  const records = readJsonl(path.join(rawDir, file)).filter(
    (it) => it.event === 'sample' || it.event === 'probe-loaded',
  );
  if (records.length === 0) continue;
  const points = records.map((it) => ({
    x: it.uptimeS,
    y: it.heapUsed / 2 ** 20,
  }));
  probeSummary[file.replace(/\.jsonl$/, '')] = {
    samples: records.length,
    uptimeS: round(records[records.length - 1].uptimeS),
    rssMib: statsOver(records.map((it) => it.rss / 2 ** 20)),
    heapUsedMib: statsOver(records.map((it) => it.heapUsed / 2 ** 20)),
    heapTotalMib: statsOver(records.map((it) => it.heapTotal / 2 ** 20)),
    externalMib: statsOver(records.map((it) => it.external / 2 ** 20)),
    arrayBuffersMib: statsOver(records.map((it) => it.arrayBuffers / 2 ** 20)),
    heapUsedSlopeMibPerMin: slopePerMinute(points),
    handlesMax: statsOver(records.map((it) => it.handles?.total))?.max ?? null,
    handleTypesAtEnd: records[records.length - 1].handles?.byType ?? null,
    detachedContextsMax:
      statsOver(records.map((it) => it.numberOfDetachedContexts))?.max ?? null,
    eventLoopDelayP99MsMax:
      statsOver(records.map((it) => it.eventLoopDelayP99Ms))?.max ?? null,
    heapSpacesAtEndMib: Object.fromEntries(
      Object.entries(records[records.length - 1].heapSpaces ?? {})
        .map(([key, value]) => [key, bytesToMib(value)])
        .sort(),
    ),
  };
}

// --- load phases -----------------------------------------------------------

const loadSummary = {};
for (const file of fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : []) {
  if (!file.startsWith('load-') || !file.endsWith('.json')) continue;
  const load = readJson(path.join(rawDir, file));
  if (load) loadSummary[load.label] = load;
}

const meta = readJson(path.join(dir, 'meta.json')) ?? {};

const summary = {
  meta,
  footprint: readJson(path.join(dir, 'footprint.json')),
  startup: readJson(path.join(dir, 'startup.json')),
  processes: processSummary,
  containers: containerSummary,
  probe: probeSummary,
  load: loadSummary,
};

const outPrefix = args['out-prefix'] ?? 'summary';
fs.writeFileSync(
  path.join(dir, `${outPrefix}.json`),
  `${JSON.stringify(summary, null, 2)}\n`,
);

// --- markdown --------------------------------------------------------------

const lines = [];
lines.push(`# Coop resource measurement — ${meta.runId ?? path.basename(dir)}`);
lines.push('');
if (meta.host) {
  lines.push(
    `Host: ${meta.host.cpus} cpu / ${meta.host.memTotalGib} GiB · node ${meta.host.node} · ${meta.startedAt ?? ''}`,
  );
  lines.push('');
}

if (summary.startup) {
  lines.push('## Startup');
  lines.push('');
  lines.push('| metric | value |');
  lines.push('| --- | --- |');
  for (const [key, value] of Object.entries(summary.startup)) {
    lines.push(`| ${key} | ${value} |`);
  }
  lines.push('');
}

for (const [phase, data] of Object.entries(processSummary)) {
  lines.push(`## Processes — ${phase}`);
  lines.push('');
  lines.push(
    `Total RSS: mean ${data.totalRssMib?.mean} MiB, max ${data.totalRssMib?.max} MiB, trend ${data.totalRssSlopeMibPerMin} MiB/min over ${data.durationS}s`,
  );
  lines.push('');
  lines.push(
    '| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, proc] of Object.entries(data.processes)) {
    lines.push(
      `| ${name} | ${proc.instances} | ${proc.rssMib?.mean} | ${proc.rssMib?.max} | ${proc.pssMib} | ${proc.threadsMax} | ${proc.fdsMax} | ${proc.cpuSecondsUsed} | ${proc.rssSlopeMibPerMin} |`,
    );
  }
  lines.push('');
}

for (const [phase, data] of Object.entries(containerSummary)) {
  lines.push(`## Containers — ${phase}`);
  lines.push('');
  lines.push(`Total: ${data.totalMemMib} MiB`);
  lines.push('');
  lines.push('| container | mem mean MiB | mem max MiB | cpu % mean | pids |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const [name, container] of Object.entries(data.containers)) {
    lines.push(
      `| ${name} | ${container.memMib?.mean} | ${container.memMib?.max} | ${container.cpuPercentMean} | ${container.pidsMax} |`,
    );
  }
  lines.push('');
}

for (const [name, probe] of Object.entries(probeSummary)) {
  lines.push(`## In-process heap — ${name}`);
  lines.push('');
  lines.push('| metric | first | last | max | trend/min |');
  lines.push('| --- | --- | --- | --- | --- |');
  lines.push(
    `| rss MiB | ${probe.rssMib?.first} | ${probe.rssMib?.last} | ${probe.rssMib?.max} | |`,
  );
  lines.push(
    `| heapUsed MiB | ${probe.heapUsedMib?.first} | ${probe.heapUsedMib?.last} | ${probe.heapUsedMib?.max} | ${probe.heapUsedSlopeMibPerMin} |`,
  );
  lines.push(
    `| external MiB | ${probe.externalMib?.first} | ${probe.externalMib?.last} | ${probe.externalMib?.max} | |`,
  );
  lines.push(`| handles | | | ${probe.handlesMax} | |`);
  lines.push('');
}

if (Object.keys(loadSummary).length > 0) {
  lines.push('## Load phases');
  lines.push('');
  lines.push(
    '| phase | scenario | conc | rps | p50 ms | p90 ms | p99 ms | errors | statuses |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, load] of Object.entries(loadSummary)) {
    lines.push(
      `| ${name} | ${load.scenario} | ${load.concurrency} | ${load.requestsPerSecond} | ${load.latencyMs.p50} | ${load.latencyMs.p90} | ${load.latencyMs.p99} | ${load.errors} | ${JSON.stringify(load.statusCounts)} |`,
    );
  }
  lines.push('');
}

if (summary.footprint) {
  lines.push('## Disk footprint');
  lines.push('');
  lines.push('| item | MiB |');
  lines.push('| --- | --- |');
  for (const [key, value] of Object.entries(summary.footprint)) {
    lines.push(`| ${key} | ${value} |`);
  }
  lines.push('');
}

fs.writeFileSync(path.join(dir, `${outPrefix}.md`), `${lines.join('\n')}\n`);
process.stdout.write(
  `Wrote ${path.join(dir, `${outPrefix}.json`)} and ${outPrefix}.md\n`,
);
