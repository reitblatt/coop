#!/usr/bin/env node
// Summarizes a V8 .heapsnapshot without needing Chrome DevTools: aggregates
// shallow size by object type/constructor, so "what is the heap actually full
// of" is answerable from the command line and diffable between two snapshots.
//
// Usage:
//   node perf/bin/analyze-heapsnapshot.mjs snap.heapsnapshot [--top 25]
//   node perf/bin/analyze-heapsnapshot.mjs before.heapsnapshot --diff after.heapsnapshot
import fs from 'node:fs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

function summarize(file) {
  // The whole snapshot is parsed as one JSON document, so V8's ~512 MiB max
  // string length is the ceiling. Capture a smaller snapshot (shorter load
  // burst) rather than trying to parse a multi-GB one.
  const bytes = fs.statSync(file).size;
  if (bytes > 450 * 2 ** 20) {
    throw new Error(
      `${file} is ${Math.round(bytes / 2 ** 20)} MiB; too large to parse as a single JSON document. ` +
        'Capture a smaller snapshot (shorter load phase) instead.',
    );
  }
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { node_fields: nodeFields, node_types: nodeTypes } =
    snapshot.snapshot.meta;
  const fieldCount = nodeFields.length;
  const typeIndex = nodeFields.indexOf('type');
  const nameIndex = nodeFields.indexOf('name');
  const sizeIndex = nodeFields.indexOf('self_size');
  const typeNames = nodeTypes[typeIndex];
  const { nodes, strings } = snapshot;

  const byKey = new Map();
  let totalSize = 0;
  let nodeCount = 0;

  for (let offset = 0; offset < nodes.length; offset += fieldCount) {
    const type = typeNames[nodes[offset + typeIndex]];
    const name = strings[nodes[offset + nameIndex]] ?? '';
    const size = nodes[offset + sizeIndex];
    totalSize += size;
    nodeCount += 1;

    // Strings and code dominate by count; bucket them so the table stays
    // readable rather than listing every distinct string.
    const key =
      type === 'string' ||
      type === 'concatenated string' ||
      type === 'sliced string'
        ? '(strings)'
        : type === 'code'
          ? '(code)'
          : type === 'object' || type === 'closure'
            ? `${type}:${name}`
            : `(${type})`;

    const entry = byKey.get(key) ?? { size: 0, count: 0 };
    entry.size += size;
    entry.count += 1;
    byKey.set(key, entry);
  }

  return {
    file,
    totalMib: Math.round((totalSize / 2 ** 20) * 10) / 10,
    nodeCount,
    byKey,
  };
}

const args = parseArgs(process.argv.slice(2));
const top = Number(args.top ?? 25);
const file = args._[0];
if (!file)
  throw new Error('usage: analyze-heapsnapshot.mjs <file> [--diff other]');

const base = summarize(file);

if (!args.diff) {
  process.stdout.write(
    `${base.file}\n  total shallow size: ${base.totalMib} MiB across ${base.nodeCount} nodes\n\n`,
  );
  process.stdout.write(
    `${'bucket'.padEnd(52)}${'MiB'.padStart(9)}${'count'.padStart(10)}\n`,
  );
  const sorted = [...base.byKey.entries()].sort(
    (a, b) => b[1].size - a[1].size,
  );
  for (const [key, entry] of sorted.slice(0, top)) {
    process.stdout.write(
      `${key.slice(0, 52).padEnd(52)}${(Math.round((entry.size / 2 ** 20) * 100) / 100).toFixed(2).padStart(9)}${String(entry.count).padStart(10)}\n`,
    );
  }
  process.exit(0);
}

const head = summarize(args.diff);
process.stdout.write(
  `base: ${base.file} (${base.totalMib} MiB)\nhead: ${head.file} (${head.totalMib} MiB)\n` +
    `delta: ${Math.round((head.totalMib - base.totalMib) * 10) / 10} MiB\n\n`,
);

const keys = new Set([...base.byKey.keys(), ...head.byKey.keys()]);
const rows = [...keys]
  .map((key) => {
    const b = base.byKey.get(key) ?? { size: 0, count: 0 };
    const h = head.byKey.get(key) ?? { size: 0, count: 0 };
    return {
      key,
      deltaMib: (h.size - b.size) / 2 ** 20,
      deltaCount: h.count - b.count,
      headMib: h.size / 2 ** 20,
    };
  })
  .sort((a, b) => b.deltaMib - a.deltaMib);

process.stdout.write(
  `${'bucket'.padEnd(52)}${'ΔMiB'.padStart(9)}${'Δcount'.padStart(10)}${'headMiB'.padStart(10)}\n`,
);
for (const row of [...rows.slice(0, top), ...rows.slice(-5)]) {
  process.stdout.write(
    `${row.key.slice(0, 52).padEnd(52)}${row.deltaMib.toFixed(2).padStart(9)}${String(row.deltaCount).padStart(10)}${row.headMib.toFixed(2).padStart(10)}\n`,
  );
}
