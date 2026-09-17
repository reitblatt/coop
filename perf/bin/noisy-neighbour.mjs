#!/usr/bin/env node
// Performance isolation between orgs: does one tenant's ingest flood degrade
// another tenant's review console?
//
// Tenant B (the victim) holds a constant, modest workload throughout: a
// reviewer working jobs plus a low report rate to keep its queue fed. Tenant A
// (the aggressor) ramps report volume upward in steps. Because B's own load
// never changes, any movement in B's numbers is attributable to A.
//
// The first step is 0 reports/s from A, which is B's baseline.
//
// Deliberately self-contained rather than sharing code with contention.mjs, so
// that changing one test cannot silently invalidate the other's published
// numbers.
//
// Usage:
//   node perf/bin/noisy-neighbour.mjs --steps 0,100,400,800 --step-s 60 \
//     [--victim perf/results/fixtures-b.json] \
//     [--aggressor perf/results/fixtures.json] \
//     [--victim-reports 10] [--server-pid <pid>] [--out result.json]
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
const dir = path.join(import.meta.dirname, '..', 'results');
const victim = JSON.parse(
  fs.readFileSync(args.victim ?? path.join(dir, 'fixtures-b.json'), 'utf8'),
);
const aggressor = JSON.parse(
  fs.readFileSync(args.aggressor ?? path.join(dir, 'fixtures.json'), 'utf8'),
);
const baseUrl = new URL(args['base-url'] ?? victim.baseUrl);
const basePath = baseUrl.pathname.replace(/\/$/, '');
const stepRates = String(args.steps ?? '0,100,400,800')
  .split(',')
  .map(Number);
const stepSeconds = Number(args['step-s'] ?? 60);
const victimReportsPerSec = Number(args['victim-reports'] ?? 10);
const serverPid = args['server-pid'] ? Number(args['server-pid']) : null;
const maxInflight = Number(args['max-inflight'] ?? 600);

const agent = new http.Agent({ keepAlive: true, maxSockets: maxInflight + 16 });

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
          if (text.length < 4096) text += c.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on('error', (error) => resolve({ status: null, error, text: '' }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function gql(query, variables, cookie) {
  const res = await request({
    method: 'POST',
    urlPath: `${basePath}/graphql`,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ query, variables }),
  });
  if (res.error) return { err: res.error.code ?? res.error.name };
  if (res.status !== 200) return { err: `http:${res.status}` };
  try {
    const parsed = JSON.parse(res.text);
    if (parsed.errors) return { err: 'gql' };
    return { data: parsed.data };
  } catch {
    return { err: 'parse' };
  }
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[i] * 10) / 10;
}

function newStats() {
  return {
    dequeueMs: [],
    decideMs: [],
    jobsCompleted: 0,
    emptyDequeues: 0,
    reviewerErrors: {},
    victimReportsAttempted: 0,
    victimReportsAccepted: 0,
    victimReportMs: [],
    aggressorAttempted: 0,
    aggressorAccepted: 0,
    aggressorErrors: {},
    rssSamples: [],
  };
}
let stats = newStats();
const note = (bag, key) => {
  bag[key] = (bag[key] ?? 0) + 1;
};

const DEQUEUE = `mutation D($id: ID!) {
  dequeueManualReviewJob(queueId: $id) {
    __typename
    ... on DequeueManualReviewJobSuccessResponse {
      lockToken numPendingJobs job { id }
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

async function victimReviewerLoop() {
  while (running) {
    const t0 = performance.now();
    const dq = await gql(DEQUEUE, { id: victim.queueId }, victim.cookie);
    stats.dequeueMs.push(performance.now() - t0);
    if (dq.err) {
      note(stats.reviewerErrors, `dequeue:${dq.err}`);
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    const payload = dq.data?.dequeueManualReviewJob;
    const job = payload?.job;
    if (!job) {
      stats.emptyDequeues += 1;
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    const t1 = performance.now();
    const sub = await gql(
      DECIDE,
      {
        input: {
          queueId: victim.queueId,
          jobId: job.id,
          lockToken: payload.lockToken,
          reportHistory: [],
          reportedItemDecisionComponents: [{ ignore: { _: true } }],
          relatedItemActions: [],
          decisionReason: 'tenancy harness',
        },
      },
      victim.cookie,
    );
    stats.decideMs.push(performance.now() - t1);
    if (sub.data?.submitManualReviewDecision?.success) stats.jobsCompleted += 1;
    else note(stats.reviewerErrors, `decide:${sub.err ?? 'unknown'}`);
  }
}

let counter = 0;
let inflight = 0;

function reportBody(tenant) {
  counter += 1;
  return JSON.stringify({
    reporter: {
      kind: 'user',
      typeId: tenant.userItemTypeId,
      id: `reporter-${counter % 1000}`,
    },
    reportedAt: new Date().toISOString(),
    reportedForReason: { reason: 'tenancy harness', csam: false },
    reportedItem: {
      id: `tenancy-${tenant.orgId}-${process.pid}-${counter}`,
      typeId: tenant.itemTypeId,
      data: {
        text: `reported content ${counter} ${'lorem ipsum '.repeat(6)}`,
        creatorId: {
          id: `user-${counter % 500}`,
          typeId: tenant.userItemTypeId,
        },
        createdAt: new Date().toISOString(),
      },
    },
  });
}

async function fireReport(tenant, which) {
  if (inflight >= maxInflight) {
    if (which === 'aggressor') {
      note(stats.aggressorErrors, 'skipped:generator-inflight-cap');
    }
    return;
  }
  inflight += 1;
  if (which === 'victim') stats.victimReportsAttempted += 1;
  else stats.aggressorAttempted += 1;
  const t0 = performance.now();
  const res = await request({
    method: 'POST',
    urlPath: `${basePath}/report/`,
    headers: { 'content-type': 'application/json', 'x-api-key': tenant.apiKey },
    body: reportBody(tenant),
  });
  inflight -= 1;
  const ok = !res.error && res.status >= 200 && res.status < 300;
  if (which === 'victim') {
    stats.victimReportMs.push(performance.now() - t0);
    if (ok) stats.victimReportsAccepted += 1;
  } else {
    if (ok) stats.aggressorAccepted += 1;
    else
      note(
        stats.aggressorErrors,
        res.error
          ? `err:${res.error.code ?? res.error.name}`
          : `http:${res.status}`,
      );
  }
}

// Batched rate injection on a coarse tick: node cannot honour a 1 ms interval,
// so a per-request timer silently under-delivers at high rates.
const TICK_MS = 20;
function rateInjector(getRate, tenant, which) {
  let owed = 0;
  return setInterval(() => {
    owed += (getRate() * TICK_MS) / 1000;
    while (owed >= 1) {
      owed -= 1;
      void fireReport(tenant, which);
    }
  }, TICK_MS);
}

function sampleRss() {
  if (serverPid === null) return;
  try {
    const m = fs
      .readFileSync(`/proc/${serverPid}/status`, 'utf8')
      .match(/^VmRSS:\s+(\d+)/m);
    if (m) stats.rssSamples.push(Number(m[1]) / 1024);
  } catch {
    /* gone */
  }
}

// --- run -------------------------------------------------------------------

const reviewer = victimReviewerLoop();
// The victim's own load is constant for the whole run, including the baseline
// step, so it is never a variable.
const victimTicker = rateInjector(() => victimReportsPerSec, victim, 'victim');

const results = [];
for (const rate of stepRates) {
  stats = newStats();
  const started = Date.now();
  const aggressorTicker =
    rate > 0 ? rateInjector(() => rate, aggressor, 'aggressor') : null;
  const rssTicker = setInterval(sampleRss, 1000);

  process.stderr.write(
    `step: aggressor ${rate} reports/s (victim steady at ${victimReportsPerSec}/s) for ${stepSeconds}s\n`,
  );
  await new Promise((r) => setTimeout(r, stepSeconds * 1000));
  if (aggressorTicker) clearInterval(aggressorTicker);
  clearInterval(rssTicker);

  const elapsedS = (Date.now() - started) / 1000;
  results.push({
    aggressorReportsPerSec: rate,
    durationS: Math.round(elapsedS * 10) / 10,
    victim: {
      jobsCompleted: stats.jobsCompleted,
      jobsPerMin: Math.round((stats.jobsCompleted / elapsedS) * 60 * 10) / 10,
      dequeueMs: {
        p50: percentile(stats.dequeueMs, 50),
        p95: percentile(stats.dequeueMs, 95),
        p99: percentile(stats.dequeueMs, 99),
      },
      decideMs: {
        p50: percentile(stats.decideMs, 50),
        p95: percentile(stats.decideMs, 95),
        p99: percentile(stats.decideMs, 99),
      },
      reportMs: {
        p50: percentile(stats.victimReportMs, 50),
        p99: percentile(stats.victimReportMs, 99),
      },
      reportsAccepted: stats.victimReportsAccepted,
      reportsAttempted: stats.victimReportsAttempted,
      emptyDequeues: stats.emptyDequeues,
      errors: stats.reviewerErrors,
    },
    aggressor: {
      attempted: stats.aggressorAttempted,
      accepted: stats.aggressorAccepted,
      achievedPerSec:
        Math.round((stats.aggressorAccepted / elapsedS) * 10) / 10,
      errors: stats.aggressorErrors,
    },
    serverRssMib: stats.rssSamples.length
      ? Math.round(Math.max(...stats.rssSamples))
      : null,
  });
}

running = false;
clearInterval(victimTicker);
await reviewer;
agent.destroy();

const output = {
  victimOrg: victim.orgId,
  aggressorOrg: aggressor.orgId,
  config: { stepRates, stepSeconds, victimReportsPerSec, maxInflight },
  steps: results,
};
if (args.out) {
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(output, null, 2)}\n`);
}

const baseline = results[0];
process.stdout.write(
  `\nvictim org ${victim.orgId} (steady ${victimReportsPerSec} reports/s + 1 reviewer)\n` +
    `aggressor org ${aggressor.orgId} (ramping)\n\n`,
);
process.stdout.write(
  `${'aggressor/s'.padStart(12)}${'achieved'.padStart(10)}${'B jobs/min'.padStart(12)}${'B dequeue p50'.padStart(15)}${'p99'.padStart(9)}${'B decide p99'.padStart(13)}${'B report p99'.padStart(14)}${'rss MiB'.padStart(9)}\n`,
);
for (const s of results) {
  process.stdout.write(
    `${String(s.aggressorReportsPerSec).padStart(12)}${String(s.aggressor.achievedPerSec).padStart(10)}${String(s.victim.jobsPerMin).padStart(12)}${String(s.victim.dequeueMs.p50).padStart(15)}${String(s.victim.dequeueMs.p99).padStart(9)}${String(s.victim.decideMs.p99).padStart(13)}${String(s.victim.reportMs.p99).padStart(14)}${String(s.serverRssMib ?? '-').padStart(9)}\n`,
  );
}

if (baseline) {
  process.stdout.write('\nvictim degradation vs its own baseline:\n');
  for (const s of results.slice(1)) {
    const ratio = (a, b) =>
      a && b ? `${Math.round((a / b) * 10) / 10}x` : 'n/a';
    process.stdout.write(
      `  aggressor ${String(s.aggressorReportsPerSec).padStart(4)}/s: ` +
        `dequeue p99 ${ratio(s.victim.dequeueMs.p99, baseline.victim.dequeueMs.p99)}, ` +
        `decide p99 ${ratio(s.victim.decideMs.p99, baseline.victim.decideMs.p99)}, ` +
        `throughput ${ratio(s.victim.jobsPerMin, baseline.victim.jobsPerMin)}\n`,
    );
  }
}
process.stdout.write('\n');
for (const s of results) {
  const errs = { ...s.victim.errors, ...s.aggressor.errors };
  if (Object.keys(errs).length > 0) {
    process.stdout.write(
      `aggressor ${s.aggressorReportsPerSec}/s errors: ${JSON.stringify(errs)}\n`,
    );
  }
}
