#!/usr/bin/env node
// Does heavy ingestion starve the interactive reviewer path?
//
// Runs two workloads against one server at the same time:
//
//   reviewers — a sequential dequeue -> decide loop, i.e. what a human working
//               the review console actually does. This is the workload we care
//               about protecting.
//   ingest    — `POST /report/` at a *rate* (open loop), stepped upward over
//               the run, so "report volume scales up" is expressed in
//               reports/second rather than in client concurrency.
//
// Reviewer latency and throughput are reported per ingest step, so graceful
// degradation is visible as a number: if reviewer p99 and jobs/min hold roughly
// flat as ingest climbs, the paths are isolated. If they collapse, they are not.
//
// Usage:
//   node perf/bin/contention.mjs --steps 0,20,60,150 --step-s 60 \
//     [--reviewers 1] [--think-ms 0] [--server-pid <pid>] [--out result.json]
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
const fixturesPath =
  args.fixtures ??
  path.join(import.meta.dirname, '..', 'results', 'fixtures.json');
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const baseUrl = new URL(args['base-url'] ?? fixtures.baseUrl);
const basePath = baseUrl.pathname.replace(/\/$/, '');
const stepRates = String(args.steps ?? '0,20,60,150')
  .split(',')
  .map(Number);
const stepSeconds = Number(args['step-s'] ?? 60);
const reviewerCount = Number(args.reviewers ?? 1);
const thinkMs = Number(args['think-ms'] ?? 0);
const serverPid = args['server-pid'] ? Number(args['server-pid']) : null;
// Bound on outstanding report requests, so a saturated server produces backlog
// in Coop rather than unbounded sockets in the generator.
const maxInflight = Number(args['max-inflight'] ?? 200);

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: maxInflight + reviewerCount + 4,
});

function request({ method, urlPath, headers = {}, body = null }) {
  return new Promise((resolve) => {
    const payload = body === null ? null : Buffer.from(body);
    const req = http.request(
      {
        agent,
        host: baseUrl.hostname,
        port: baseUrl.port || 80,
        method,
        path: urlPath,
        headers: {
          ...headers,
          ...(payload ? { 'content-length': payload.length } : {}),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => {
          if (text.length < 8192) text += c.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on('error', (error) => resolve({ status: null, error, text: '' }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function gql(query, variables) {
  const res = await request({
    method: 'POST',
    urlPath: `${basePath}/graphql`,
    headers: { 'content-type': 'application/json', cookie: fixtures.cookie },
    body: JSON.stringify({ query, variables }),
  });
  if (res.error) return { transportError: res.error.code ?? res.error.name };
  if (res.status !== 200)
    return { httpError: res.status, body: res.text.slice(0, 300) };
  let parsed;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    return { parseError: res.text.slice(0, 200) };
  }
  if (parsed.errors) {
    return { gqlError: JSON.stringify(parsed.errors).slice(0, 300) };
  }
  return { data: parsed.data };
}

// --- metrics ---------------------------------------------------------------

function newStats() {
  return {
    dequeueMs: [],
    decideMs: [],
    jobsCompleted: 0,
    dequeueEmpty: 0,
    reviewerErrors: {},
    reportsAttempted: 0,
    reportsAccepted: 0,
    reportMs: [],
    reportErrors: {},
    queueDepthSamples: [],
    rssSamples: [],
  };
}
let stats = newStats();
const note = (bag, key) => {
  bag[key] = (bag[key] ?? 0) + 1;
};

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[i] * 10) / 10;
}

// --- reviewer workload -----------------------------------------------------

const DEQUEUE = `mutation D($id: ID!) {
  dequeueManualReviewJob(queueId: $id) {
    __typename
    ... on DequeueManualReviewJobSuccessResponse {
      lockToken
      numPendingJobs
      job { id }
    }
  }
}`;

const DECIDE = `mutation S($input: SubmitDecisionInput!) {
  submitManualReviewDecision(input: $input) {
    __typename
    ... on SubmitDecisionSuccessResponse { success }
  }
}`;

let running = true;

async function reviewerLoop() {
  while (running) {
    const t0 = performance.now();
    const dq = await gql(DEQUEUE, { id: fixtures.queueId });
    stats.dequeueMs.push(performance.now() - t0);

    if (dq.transportError || dq.httpError || dq.gqlError || dq.parseError) {
      note(
        stats.reviewerErrors,
        `dequeue:${dq.transportError ?? dq.httpError ?? (dq.gqlError ? 'gql' : 'parse')}`,
      );
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }

    const payload = dq.data?.dequeueManualReviewJob;
    const job = payload?.job;
    if (payload?.numPendingJobs !== undefined) {
      stats.queueDepthSamples.push(payload.numPendingJobs);
    }
    if (!job) {
      stats.dequeueEmpty += 1;
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    const t1 = performance.now();
    const sub = await gql(DECIDE, {
      input: {
        queueId: fixtures.queueId,
        jobId: job.id,
        lockToken: payload.lockToken,
        reportHistory: [],
        reportedItemDecisionComponents: [{ ignore: { _: true } }],
        relatedItemActions: [],
        decisionReason: 'perf harness',
      },
    });
    stats.decideMs.push(performance.now() - t1);

    if (sub.data?.submitManualReviewDecision?.success) stats.jobsCompleted += 1;
    else
      note(
        stats.reviewerErrors,
        `decide:${sub.transportError ?? sub.httpError ?? (sub.gqlError ? 'gql' : 'unknown')}`,
      );

    if (thinkMs > 0) await new Promise((r) => setTimeout(r, thinkMs));
  }
}

// --- ingest workload -------------------------------------------------------

let reportCounter = 0;
let inflight = 0;

function reportBody() {
  reportCounter += 1;
  return JSON.stringify({
    reporter: {
      kind: 'user',
      typeId: fixtures.userItemTypeId,
      id: `perf-reporter-${reportCounter % 1000}`,
    },
    reportedAt: new Date().toISOString(),
    reportedForReason: {
      reason: 'perf harness generated report',
      csam: false,
    },
    reportedItem: {
      id: `perf-reported-${process.pid}-${reportCounter}`,
      typeId: fixtures.itemTypeId,
      data: {
        text: `reported content ${reportCounter} ${'lorem ipsum '.repeat(6)}`,
        creatorId: {
          id: `perf-user-${reportCounter % 500}`,
          typeId: fixtures.userItemTypeId,
        },
        createdAt: new Date().toISOString(),
      },
    },
  });
}

async function fireReport() {
  if (inflight >= maxInflight) {
    note(stats.reportErrors, 'skipped:generator-inflight-cap');
    return;
  }
  inflight += 1;
  stats.reportsAttempted += 1;
  const t0 = performance.now();
  const res = await request({
    method: 'POST',
    urlPath: `${basePath}/report/`,
    headers: {
      'content-type': 'application/json',
      'x-api-key': fixtures.apiKey,
    },
    body: reportBody(),
  });
  inflight -= 1;
  stats.reportMs.push(performance.now() - t0);
  if (res.error)
    note(stats.reportErrors, `err:${res.error.code ?? res.error.name}`);
  else if (res.status >= 200 && res.status < 300) stats.reportsAccepted += 1;
  else note(stats.reportErrors, `http:${res.status}`);
}

// --- server RSS ------------------------------------------------------------

function sampleRss() {
  if (serverPid === null) return;
  try {
    const status = fs.readFileSync(`/proc/${serverPid}/status`, 'utf8');
    const m = status.match(/^VmRSS:\s+(\d+)/m);
    if (m) stats.rssSamples.push(Number(m[1]) / 1024);
  } catch {
    /* process gone */
  }
}

// --- run -------------------------------------------------------------------

const reviewers = Array.from({ length: reviewerCount }, () => reviewerLoop());
const results = [];

for (const rate of stepRates) {
  stats = newStats(); // reset so each step is measured independently
  const stepStart = Date.now();
  const stepEnd = stepStart + stepSeconds * 1000;

  // Open-loop rate injection: fire on a fixed schedule regardless of how long
  // previous requests take, so a slowing server shows up as backlog and
  // latency rather than as a self-throttling client.
  //
  // Fire in batches on a coarse tick rather than one request per timer: node
  // cannot honour a 1 ms setInterval, so at high rates a per-request timer
  // silently under-delivers and the "achieved" rate becomes a measurement of
  // the generator instead of the server.
  const TICK_MS = 20;
  let owed = 0;
  const ticker =
    rate > 0
      ? setInterval(() => {
          owed += (rate * TICK_MS) / 1000;
          while (owed >= 1) {
            owed -= 1;
            void fireReport();
          }
        }, TICK_MS)
      : null;
  const rssTicker = setInterval(sampleRss, 1000);

  process.stderr.write(`step: ${rate} reports/s for ${stepSeconds}s\n`);
  await new Promise((r) => setTimeout(r, stepEnd - Date.now()));
  if (ticker) clearInterval(ticker);
  clearInterval(rssTicker);

  const elapsedS = (Date.now() - stepStart) / 1000;
  results.push({
    targetReportsPerSec: rate,
    durationS: Math.round(elapsedS * 10) / 10,
    reviewer: {
      jobsCompleted: stats.jobsCompleted,
      jobsPerMin: Math.round((stats.jobsCompleted / elapsedS) * 60 * 10) / 10,
      dequeueMs: {
        p50: percentile(stats.dequeueMs, 50),
        p95: percentile(stats.dequeueMs, 95),
        p99: percentile(stats.dequeueMs, 99),
        max: percentile(stats.dequeueMs, 100),
      },
      decideMs: {
        p50: percentile(stats.decideMs, 50),
        p95: percentile(stats.decideMs, 95),
        p99: percentile(stats.decideMs, 99),
        max: percentile(stats.decideMs, 100),
      },
      emptyDequeues: stats.dequeueEmpty,
      errors: stats.reviewerErrors,
    },
    ingest: {
      attempted: stats.reportsAttempted,
      accepted: stats.reportsAccepted,
      achievedPerSec: Math.round((stats.reportsAccepted / elapsedS) * 10) / 10,
      reportMs: {
        p50: percentile(stats.reportMs, 50),
        p95: percentile(stats.reportMs, 95),
        p99: percentile(stats.reportMs, 99),
      },
      errors: stats.reportErrors,
    },
    queueDepth: {
      first: stats.queueDepthSamples[0] ?? null,
      last: stats.queueDepthSamples[stats.queueDepthSamples.length - 1] ?? null,
      max: stats.queueDepthSamples.length
        ? Math.max(...stats.queueDepthSamples)
        : null,
    },
    serverRssMib: stats.rssSamples.length
      ? {
          first: Math.round(stats.rssSamples[0]),
          last: Math.round(stats.rssSamples[stats.rssSamples.length - 1]),
          max: Math.round(Math.max(...stats.rssSamples)),
        }
      : null,
  });
}

running = false;
await Promise.all(reviewers);
agent.destroy();

const output = {
  startedAt: new Date(
    Date.now() - stepRates.length * stepSeconds * 1000,
  ).toISOString(),
  config: {
    steps: stepRates,
    stepSeconds,
    reviewerCount,
    thinkMs,
    maxInflight,
  },
  steps: results,
};

if (args.out) {
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(output, null, 2)}\n`);
}

// Readable table: the whole point is comparing reviewer cost across steps.
process.stdout.write(
  `\n${'ingest/s'.padStart(9)}${'achieved'.padStart(10)}${'jobs/min'.padStart(10)}${'dequeue p50'.padStart(13)}${'p99'.padStart(9)}${'decide p50'.padStart(12)}${'p99'.padStart(9)}${'qdepth'.padStart(9)}${'rss MiB'.padStart(9)}\n`,
);
for (const s of results) {
  process.stdout.write(
    `${String(s.targetReportsPerSec).padStart(9)}${String(s.ingest.achievedPerSec).padStart(10)}${String(s.reviewer.jobsPerMin).padStart(10)}${String(s.reviewer.dequeueMs.p50).padStart(13)}${String(s.reviewer.dequeueMs.p99).padStart(9)}${String(s.reviewer.decideMs.p50).padStart(12)}${String(s.reviewer.decideMs.p99).padStart(9)}${String(s.queueDepth.max ?? '-').padStart(9)}${String(s.serverRssMib?.max ?? '-').padStart(9)}\n`,
  );
}
process.stdout.write('\n');
for (const s of results) {
  const errs = { ...s.reviewer.errors, ...s.ingest.errors };
  if (Object.keys(errs).length > 0) {
    process.stdout.write(
      `${s.targetReportsPerSec} reports/s errors: ${JSON.stringify(errs)}\n`,
    );
  }
}
