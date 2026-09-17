#!/usr/bin/env node
// Data isolation probe: with tenant B's credentials, try to reach tenant A's
// data. Every probe should be refused or come back empty; anything that returns
// A's data is a cross-tenant leak.
//
// This is a correctness check, not a benchmark — it makes one request per probe.
//
// Usage:
//   node perf/bin/tenant-isolation.mjs \
//     --victim perf/results/fixtures.json --attacker perf/results/fixtures-b.json
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
const dir = path.join(import.meta.dirname, '..', 'results');
const victim = JSON.parse(
  fs.readFileSync(args.victim ?? path.join(dir, 'fixtures.json'), 'utf8'),
);
const attacker = JSON.parse(
  fs.readFileSync(args.attacker ?? path.join(dir, 'fixtures-b.json'), 'utf8'),
);
const base = attacker.baseUrl;

async function gql(query, variables, cookie) {
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { status: res.status, unparsed: text.slice(0, 200) };
  }
  return { status: res.status, data: body.data, errors: body.errors };
}

async function rest(urlPath, apiKey, init = {}) {
  const res = await fetch(`${base}${urlPath}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      ...(init.headers ?? {}),
    },
  });
  return { status: res.status, text: (await res.text()).slice(0, 400) };
}

const results = [];

/**
 * `leaked` decides the verdict: it receives the response and returns true if
 * the response contains the victim's data. Errors and nulls are passes — a
 * tenant being told "not found" is correct behaviour.
 */
async function probe(name, detail, run, leaked) {
  try {
    const response = await run();
    const didLeak = leaked(response);
    results.push({
      name,
      detail,
      verdict: didLeak ? 'LEAK' : 'ok',
      response: JSON.stringify(response).slice(0, 300),
    });
  } catch (error) {
    results.push({
      name,
      detail,
      verdict: 'error',
      response: String(error.message).slice(0, 200),
    });
  }
}

// --- GraphQL, using B's session against A's ids -----------------------------

await probe(
  'org(id: A)',
  "B's session reads A's org record",
  () =>
    gql(
      `query O($id: ID!) { org(id: $id) { name mrtQueues { id name } } }`,
      { id: victim.orgId },
      attacker.cookie,
    ),
  (r) => r.data?.org != null,
);

await probe(
  'itemType(id: A)',
  "B's session reads A's item type schema",
  () =>
    gql(
      `query T($id: ID!) { itemType(id: $id) { ... on ItemTypeBase { id name version } } }`,
      { id: victim.itemTypeId },
      attacker.cookie,
    ),
  (r) => r.data?.itemType != null,
);

await probe(
  'manualReviewQueue(id: A)',
  "B's session reads A's review queue",
  () =>
    gql(
      `query Q($id: ID!) { manualReviewQueue(id: $id) { id name pendingJobCount } }`,
      { id: victim.queueId },
      attacker.cookie,
    ),
  (r) => r.data?.manualReviewQueue != null,
);

await probe(
  'dequeueManualReviewJob(queueId: A)',
  "B dequeues a job out of A's queue — would expose reported user content",
  () =>
    gql(
      `mutation D($id: ID!) {
         dequeueManualReviewJob(queueId: $id) {
           __typename
           ... on DequeueManualReviewJobSuccessResponse {
             lockToken numPendingJobs job { id }
           }
         }
       }`,
      { id: victim.queueId },
      attacker.cookie,
    ),
  (r) => r.data?.dequeueManualReviewJob?.job != null,
);

await probe(
  'itemTypes(identifiers: A)',
  "B's session resolves A's item type by identifier",
  () =>
    gql(
      `query T($ids: [ItemTypeIdentifierInput!]!) {
         itemTypes(identifiers: $ids) { ... on ItemTypeBase { id name } }
       }`,
      {
        ids: [
          {
            id: victim.itemTypeId,
            version: victim.itemTypeVersion,
            schemaVariant: 'ORIGINAL',
          },
        ],
      },
      attacker.cookie,
    ),
  (r) => (r.data?.itemTypes ?? []).length > 0,
);

await probe(
  'getExistingJobsForItem(A item)',
  "B's session looks up review jobs for one of A's items",
  () =>
    gql(
      `query E($itemId: ID!, $itemTypeId: ID!) {
         getExistingJobsForItem(itemId: $itemId, itemTypeId: $itemTypeId) {
           queueId
           job { id }
         }
       }`,
      { itemId: 'perf-reported-1', itemTypeId: victim.itemTypeId },
      attacker.cookie,
    ),
  (r) => (r.data?.getExistingJobsForItem ?? []).length > 0,
);

// --- REST, using B's API key against A's item type -------------------------

await probe(
  'POST /items/async/ with A typeId',
  "B's API key writes an item into A's item type",
  () =>
    rest('/items/async/', attacker.apiKey, {
      method: 'POST',
      body: JSON.stringify({
        items: [
          {
            id: `cross-tenant-${Date.now()}`,
            typeId: victim.itemTypeId,
            data: {
              text: 'written by tenant B into tenant A item type',
              creatorId: { id: 'attacker', typeId: victim.userItemTypeId },
              createdAt: new Date().toISOString(),
            },
          },
        ],
      }),
    }),
  (r) => r.status >= 200 && r.status < 300,
);

await probe(
  'POST /report/ with A typeId',
  "B's API key files a report against A's item type",
  () =>
    rest('/report/', attacker.apiKey, {
      method: 'POST',
      body: JSON.stringify({
        reporter: {
          kind: 'user',
          typeId: victim.userItemTypeId,
          id: 'attacker-reporter',
        },
        reportedAt: new Date().toISOString(),
        reportedForReason: { reason: 'cross-tenant probe', csam: false },
        reportedItem: {
          id: `cross-tenant-report-${Date.now()}`,
          typeId: victim.itemTypeId,
          data: {
            text: 'cross tenant',
            creatorId: { id: 'x', typeId: victim.userItemTypeId },
            createdAt: new Date().toISOString(),
          },
        },
      }),
    }),
  (r) => r.status >= 200 && r.status < 300,
);

// --- control: the same probes against B's own ids must succeed --------------
// Without this, a probe that fails for an unrelated reason (wrong field name,
// bad input shape) would masquerade as an isolation pass.

await probe(
  'CONTROL org(id: B)',
  'B reads its own org — must succeed, else the probes above prove nothing',
  () =>
    gql(
      `query O($id: ID!) { org(id: $id) { name mrtQueues { id name } } }`,
      { id: attacker.orgId },
      attacker.cookie,
    ),
  (r) => r.data?.org != null,
);

await probe(
  'CONTROL manualReviewQueue(id: B)',
  'B reads its own queue — must succeed',
  () =>
    gql(
      `query Q($id: ID!) { manualReviewQueue(id: $id) { id name pendingJobCount } }`,
      { id: attacker.queueId },
      attacker.cookie,
    ),
  (r) => r.data?.manualReviewQueue != null,
);

// --- report ----------------------------------------------------------------

const leaks = results.filter(
  (it) => it.verdict === 'LEAK' && !it.name.startsWith('CONTROL'),
);
const controlsFailed = results.filter(
  (it) => it.name.startsWith('CONTROL') && it.verdict !== 'LEAK',
);

for (const r of results) {
  const isControl = r.name.startsWith('CONTROL');
  const label = isControl
    ? r.verdict === 'LEAK'
      ? 'ok (control passed)'
      : 'CONTROL FAILED'
    : r.verdict === 'LEAK'
      ? 'LEAK'
      : 'isolated';
  process.stdout.write(`${label.padEnd(20)} ${r.name}\n`);
  process.stdout.write(`${' '.repeat(21)}${r.detail}\n`);
  process.stdout.write(`${' '.repeat(21)}${r.response}\n\n`);
}

process.stdout.write(
  `${leaks.length} cross-tenant leak(s); ${controlsFailed.length} control(s) failed\n`,
);
if (controlsFailed.length > 0) {
  process.stdout.write(
    'A failed control means the probes are not exercising what they claim — fix before trusting the result.\n',
  );
}

if (args.out) {
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(
    args.out,
    `${JSON.stringify({ victimOrg: victim.orgId, attackerOrg: attacker.orgId, leaks: leaks.length, controlsFailed: controlsFailed.length, results }, null, 2)}\n`,
  );
}

process.exit(leaks.length > 0 || controlsFailed.length > 0 ? 1 : 0);
