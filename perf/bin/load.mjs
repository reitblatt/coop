#!/usr/bin/env node
// Closed-loop load generator for the Coop API. Zero dependencies (node:http
// only), so it runs anywhere Node runs and never perturbs package installs.
//
// Scenarios:
//   ready        GET  /ready                      (bare Express + CPU probe)
//   graphql-me   POST /graphql `{ me { ... } }`   (session auth + Apollo + pg)
//   items-async  POST /items/async/               (ingest hot path -> Redis queue)
//   mixed        70% graphql-me / 30% items-async
//
// Usage:
//   node perf/bin/load.mjs --scenario mixed --concurrency 25 --duration-s 60
//     [--fixtures perf/results/fixtures.json] [--out load.json] [--label phase1]
import fs from 'node:fs';
import http from 'node:http';
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
const scenario = args.scenario ?? 'graphql-me';
const concurrency = Number(args.concurrency ?? 25);
const durationS = Number(args['duration-s'] ?? 60);
const label = args.label ?? scenario;
const itemsPerRequest = Number(args['items-per-request'] ?? 5);
const fixturesPath =
  args.fixtures ??
  path.join(import.meta.dirname, '..', 'results', 'fixtures.json');
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const baseUrl = new URL(args['base-url'] ?? fixtures.baseUrl);

// Keep sockets open; otherwise we would be measuring TCP setup, not the server.
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: concurrency,
  maxFreeSockets: concurrency,
});

const ME_QUERY = JSON.stringify({
  query: '{ me { id email firstName lastName } }',
});

let itemCounter = 0;
function itemsBody() {
  const items = [];
  for (let i = 0; i < itemsPerRequest; i += 1) {
    itemCounter += 1;
    items.push({
      id: `perf-item-${process.pid}-${itemCounter}`,
      typeId: fixtures.itemTypeId,
      data: {
        text: `perf harness payload ${itemCounter} ${'lorem ipsum dolor sit amet '.repeat(4)}`,
        creatorId: {
          id: `perf-user-${itemCounter % 500}`,
          typeId: fixtures.userItemTypeId,
        },
        createdAt: new Date().toISOString(),
      },
    });
  }
  return JSON.stringify({ items });
}

function requestFor(kind) {
  const basePath = baseUrl.pathname.replace(/\/$/, '');
  switch (kind) {
    case 'ready':
      return {
        method: 'GET',
        path: `${basePath}/ready`,
        headers: {},
        body: null,
      };
    case 'graphql-me':
      return {
        method: 'POST',
        path: `${basePath}/graphql`,
        headers: {
          'content-type': 'application/json',
          cookie: fixtures.cookie,
        },
        body: ME_QUERY,
      };
    case 'items-async':
      return {
        method: 'POST',
        path: `${basePath}/items/async/`,
        headers: {
          'content-type': 'application/json',
          'x-api-key': fixtures.apiKey,
        },
        body: itemsBody(),
      };
    default:
      throw new Error(`Unknown scenario: ${kind}`);
  }
}

function pickKind() {
  if (scenario !== 'mixed') return scenario;
  return Math.random() < 0.7 ? 'graphql-me' : 'items-async';
}

function once(spec) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        agent,
        host: baseUrl.hostname,
        port: baseUrl.port || 80,
        method: spec.method,
        path: spec.path,
        headers: {
          ...spec.headers,
          ...(spec.body
            ? { 'content-length': Buffer.byteLength(spec.body) }
            : {}),
        },
      },
      (res) => {
        let size = 0;
        let head = '';
        res.on('data', (chunk) => {
          size += chunk.length;
          if (head.length < 400) head += chunk.toString('utf8', 0, 400);
        });
        res.on('end', () => resolve({ status: res.statusCode, size, head }));
      },
    );
    req.on('error', (error) =>
      resolve({ status: null, error, size: 0, head: '' }),
    );
    if (spec.body) req.write(spec.body);
    req.end();
  });
}

const latencies = [];
const statusCounts = {};
let errors = 0;
let bytesIn = 0;
let firstErrorBody = null;
const deadline = Date.now() + durationS * 1000;

async function worker() {
  while (Date.now() < deadline) {
    const spec = requestFor(pickKind());
    const startedAt = performance.now();
    const result = await once(spec);
    latencies.push(performance.now() - startedAt);
    bytesIn += result.size;
    if (result.error) {
      errors += 1;
      const code = result.error.code ?? result.error.name;
      statusCounts[`err:${code}`] = (statusCounts[`err:${code}`] ?? 0) + 1;
      continue;
    }
    statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
    // A 200 carrying a GraphQL `errors` array is a failure for our purposes.
    if (result.head.includes('"errors"')) {
      statusCounts['200-gql-error'] = (statusCounts['200-gql-error'] ?? 0) + 1;
      firstErrorBody ??= result.head;
    }
    if (result.status >= 400) firstErrorBody ??= result.head;
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return Math.round(sorted[index] * 100) / 100;
}

const startedAt = Date.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const wallSeconds = (Date.now() - startedAt) / 1000;
agent.destroy();

const sorted = latencies.slice().sort((a, b) => a - b);
const result = {
  label,
  scenario,
  concurrency,
  durationS: Math.round(wallSeconds * 10) / 10,
  requests: latencies.length,
  requestsPerSecond: Math.round((latencies.length / wallSeconds) * 10) / 10,
  itemsSubmitted: itemCounter,
  errors,
  statusCounts,
  responseBytes: bytesIn,
  firstErrorBody,
  latencyMs: {
    mean:
      Math.round(
        (latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)) * 100,
      ) / 100,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: percentile(sorted, 100),
  },
};

if (args.out) {
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
