#!/usr/bin/env node
// Attributes startup time and baseline RSS to individual dependencies by
// importing each one in a cold child process and measuring the delta against an
// empty baseline process. This answers "what do we pay just for `import`",
// independent of whether the code is ever called.
//
// Usage:
//   node perf/bin/import-cost.mjs --package server [--out cost.json]
//     [--only pkg-a,pkg-b] [--repeats 3]
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const pkgDir = path.join(repoRoot, args.package ?? 'server');
const pkgJson = JSON.parse(
  fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'),
);
const repeats = Number(args.repeats ?? 3);

const only = args.only ? String(args.only).split(',') : null;
const deps = (only ?? Object.keys(pkgJson.dependencies ?? {})).sort();

const PROBE = `
const t0 = performance.now();
const before = process.memoryUsage();
try {
  await import(process.argv[1]);
} catch (error) {
  console.log(JSON.stringify({ error: String(error.message).slice(0, 200) }));
  process.exit(0);
}
const after = process.memoryUsage();
console.log(JSON.stringify({
  ms: performance.now() - t0,
  rssDelta: after.rss - before.rss,
  heapDelta: after.heapUsed - before.heapUsed,
  externalDelta: after.external - before.external,
  rssTotal: after.rss,
}));
`;

async function measure(specifier) {
  const runs = [];
  for (let i = 0; i < repeats; i += 1) {
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        ['--input-type=module', '-e', PROBE, specifier],
        { cwd: pkgDir, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      );
      runs.push(JSON.parse(stdout.trim().split('\n').pop()));
    } catch (error) {
      return { specifier, error: String(error.message).slice(0, 200) };
    }
  }
  if (runs[0].error) return { specifier, error: runs[0].error };
  const median = (key) => {
    const sorted = runs.map((it) => it[key]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  return {
    specifier,
    importMs: Math.round(median('ms') * 10) / 10,
    rssDeltaMib: Math.round((median('rssDelta') / 2 ** 20) * 100) / 100,
    heapDeltaMib: Math.round((median('heapDelta') / 2 ** 20) * 100) / 100,
    externalDeltaMib:
      Math.round((median('externalDelta') / 2 ** 20) * 100) / 100,
  };
}

// Baseline: an empty module, so the numbers above are attributable to the
// dependency rather than to node's own boot.
const baseline = await measure('node:events');
process.stderr.write(`baseline (node:events): ${JSON.stringify(baseline)}\n`);

const results = [];
for (const dep of deps) {
  const result = await measure(dep);
  results.push(result);
  process.stderr.write(
    `${dep}: ${result.error ? `ERROR ${result.error}` : `${result.importMs}ms ${result.rssDeltaMib}MiB`}\n`,
  );
}

const ok = results.filter((it) => !it.error);
ok.sort((a, b) => b.rssDeltaMib - a.rssDeltaMib);

const output = {
  package: args.package ?? 'server',
  node: process.version,
  repeats,
  baseline,
  totalDeps: deps.length,
  measured: ok.length,
  failed: results.filter((it) => it.error),
  sumRssDeltaMib:
    Math.round(ok.reduce((acc, it) => acc + it.rssDeltaMib, 0) * 10) / 10,
  sumImportMs: Math.round(ok.reduce((acc, it) => acc + it.importMs, 0)),
  byRss: ok,
  byTime: ok.slice().sort((a, b) => b.importMs - a.importMs),
};

if (args.out) {
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(output, null, 2)}\n`);
}

process.stdout.write(
  `\n${'dependency'.padEnd(42)}${'rss MiB'.padStart(9)}${'heap MiB'.padStart(10)}${'ms'.padStart(9)}\n`,
);
for (const it of ok.slice(0, 30)) {
  process.stdout.write(
    `${it.specifier.padEnd(42)}${String(it.rssDeltaMib).padStart(9)}${String(it.heapDeltaMib).padStart(10)}${String(it.importMs).padStart(9)}\n`,
  );
}
process.stdout.write(
  `\nsum over ${ok.length} deps: ${output.sumRssDeltaMib} MiB rss, ${output.sumImportMs} ms\n`,
);
