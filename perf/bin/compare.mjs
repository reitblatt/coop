#!/usr/bin/env node
// Diffs two summary.json files and reports movement on the metrics that matter,
// so a regression shows up as a number rather than as a feeling.
//
// Exits 1 if any tracked metric regresses by more than the threshold, which
// makes it usable as a CI gate.
//
// Usage:
//   node perf/bin/compare.mjs --base perf/results/baseline --head perf/results/<run>
//     [--threshold-percent 10] [--fail-on-regression]
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
const thresholdPercent = Number(args['threshold-percent'] ?? 10);

function load(dir) {
  const file = dir.endsWith('.json') ? dir : path.join(dir, 'summary.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const base = load(args.base ?? 'perf/results/baseline');
const head = load(args.head ?? 'perf/results/latest');

// direction: 'lower' means a smaller number is better.
const METRICS = [
  ['startup.bootToReadyMs', (it) => it.startup?.bootToReadyMs, 'lower', 'ms'],
  [
    'idle.rssMib',
    (it) => it.probe?.['probe-server']?.rssMib?.first,
    'lower',
    'MiB',
  ],
  [
    'idle.serverRssMib',
    (it) => it.processes?.idle?.processes?.['api-server']?.rssMib?.mean,
    'lower',
    'MiB',
  ],
  [
    'idle.totalRssMib',
    (it) => it.processes?.idle?.totalRssMib?.mean,
    'lower',
    'MiB',
  ],
  [
    'soak.serverRssMaxMib',
    (it) => it.processes?.soak?.processes?.['api-server']?.rssMib?.max,
    'lower',
    'MiB',
  ],
  [
    'soak.rssSlopeMibPerMin',
    (it) => it.processes?.soak?.processes?.['api-server']?.rssSlopeMibPerMin,
    'lower',
    'MiB/min',
  ],
  [
    'soak.heapSlopeMibPerMin',
    (it) => it.probe?.['probe-server']?.heapUsedSlopeMibPerMin,
    'lower',
    'MiB/min',
  ],
  [
    'load.graphql.rps',
    (it) => it.load?.graphql?.requestsPerSecond,
    'higher',
    'rps',
  ],
  [
    'load.graphql.p99Ms',
    (it) => it.load?.graphql?.latencyMs?.p99,
    'lower',
    'ms',
  ],
  [
    'load.ingest.rps',
    (it) => it.load?.ingest?.requestsPerSecond,
    'higher',
    'rps',
  ],
  ['load.ingest.p99Ms', (it) => it.load?.ingest?.latencyMs?.p99, 'lower', 'ms'],
  ['soak.rps', (it) => it.load?.soak?.requestsPerSecond, 'higher', 'rps'],
  [
    'footprint.nodeModulesMib',
    (it) => it.footprint?.nodeModulesTotalMib,
    'lower',
    'MiB',
  ],
  [
    'footprint.imageServerMib',
    (it) => it.footprint?.imageServerMib,
    'lower',
    'MiB',
  ],
  [
    'containers.idleTotalMib',
    (it) => it.containers?.idle?.totalMemMib,
    'lower',
    'MiB',
  ],
];

/**
 * A run whose server fell over reports spectacular throughput — thousands of
 * instant connection refusals per second — and would otherwise read as a huge
 * improvement. Check health before comparing anything.
 */
function healthProblems(summary) {
  const problems = [];
  for (const [phase, load] of Object.entries(summary.load ?? {})) {
    const failures = Object.entries(load.statusCounts ?? {})
      .filter(([status]) => status.startsWith('err:') || Number(status) >= 400)
      .reduce((acc, [, count]) => acc + count, 0);
    const total = load.requests || 1;
    const rate = failures / total;
    if (rate > 0.01) {
      problems.push(
        `${phase}: ${Math.round(rate * 1000) / 10}% of ${total} requests failed (${JSON.stringify(load.statusCounts)})`,
      );
    }
  }
  return problems;
}

const baseProblems = healthProblems(base);
const headProblems = healthProblems(head);

const rows = [];
let regressions = 0;

for (const [name, get, direction, unit] of METRICS) {
  const baseValue = get(base);
  const headValue = get(head);
  if (
    typeof baseValue !== 'number' ||
    typeof headValue !== 'number' ||
    baseValue === 0
  ) {
    rows.push({
      name,
      base: baseValue ?? '-',
      head: headValue ?? '-',
      delta: '-',
      pct: '-',
      verdict: '-',
    });
    continue;
  }
  const delta = headValue - baseValue;
  const pct = (delta / Math.abs(baseValue)) * 100;
  const worse =
    direction === 'lower' ? pct > thresholdPercent : pct < -thresholdPercent;
  const better =
    direction === 'lower' ? pct < -thresholdPercent : pct > thresholdPercent;
  if (worse) regressions += 1;
  rows.push({
    name,
    base: `${Math.round(baseValue * 100) / 100} ${unit}`,
    head: `${Math.round(headValue * 100) / 100} ${unit}`,
    delta: `${delta > 0 ? '+' : ''}${Math.round(delta * 100) / 100}`,
    pct: `${pct > 0 ? '+' : ''}${Math.round(pct * 10) / 10}%`,
    verdict: worse ? 'REGRESSION' : better ? 'improved' : 'same',
  });
}

const widths = ['name', 'base', 'head', 'delta', 'pct', 'verdict'].map((key) =>
  Math.max(key.length, ...rows.map((row) => String(row[key]).length)),
);
const line = (values) =>
  values.map((value, i) => String(value).padEnd(widths[i])).join('  ');

process.stdout.write(
  `base: ${base.meta?.runId ?? args.base} (${base.meta?.gitSha ?? '?'})\n`,
);
process.stdout.write(
  `head: ${head.meta?.runId ?? args.head} (${head.meta?.gitSha ?? '?'})\n\n`,
);
process.stdout.write(
  `${line(['metric', 'base', 'head', 'delta', 'pct', 'verdict'])}\n`,
);
process.stdout.write(`${widths.map((w) => '-'.repeat(w)).join('  ')}\n`);
for (const row of rows) {
  process.stdout.write(
    `${line([row.name, row.base, row.head, row.delta, row.pct, row.verdict])}\n`,
  );
}
process.stdout.write(
  `\n${regressions} regression(s) beyond ${thresholdPercent}%\n`,
);

for (const [label, problems] of [
  ['base', baseProblems],
  ['head', headProblems],
]) {
  for (const problem of problems) {
    process.stdout.write(`UNHEALTHY (${label}) ${problem}\n`);
  }
}
if (headProblems.length > 0 || baseProblems.length > 0) {
  process.stdout.write(
    'Throughput numbers from an unhealthy run are meaningless — a crashed server\n' +
      'refuses connections quickly and looks fast. Fix the run before reading the table.\n',
  );
}

const failed =
  (regressions > 0 || headProblems.length > 0) && args['fail-on-regression'];
if (failed) process.exit(1);
