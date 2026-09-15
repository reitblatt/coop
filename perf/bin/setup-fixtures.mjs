#!/usr/bin/env node
// Provisions the data the load generator needs (session cookie + a content item
// type) against a running Coop server, and writes it to perf/results/fixtures.json.
//
// The org/admin user must already exist:
//   npm run create-org -- --name "Perf Test Org" --email perf@example.com ...
//
// Usage:
//   node perf/bin/setup-fixtures.mjs [--base-url http://localhost:8080/api/v1]
//     --email perf@example.com --password ... --api-key ... [--out path.json]
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
const baseUrl = args['base-url'] ?? 'http://localhost:8080/api/v1';
const email = args.email ?? process.env.COOP_PERF_EMAIL;
const password = args.password ?? process.env.COOP_PERF_PASSWORD;
const apiKey = args['api-key'] ?? process.env.COOP_PERF_API_KEY;
const out =
  args.out ?? path.join(import.meta.dirname, '..', 'results', 'fixtures.json');

if (!email || !password) {
  throw new Error('--email and --password are required');
}

async function gql(query, variables, cookie) {
  const response = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  }
  return { body, setCookie: response.headers.getSetCookie?.() ?? [] };
}

const login = await gql(
  `mutation Login($input: LoginInput!) {
     login(input: $input) {
       __typename
       ... on LoginSuccessResponse { user { id orgId } }
     }
   }`,
  { input: { email, password, remember: true } },
);

if (login.body.data.login.__typename !== 'LoginSuccessResponse') {
  throw new Error(`Login failed: ${login.body.data.login.__typename}`);
}

const cookie = login.setCookie.map((it) => it.split(';')[0]).join('; ');
if (!cookie) throw new Error('Login succeeded but returned no session cookie');

const itemTypeName = `PerfContent-${Date.now()}`;
const created = await gql(
  `mutation Create($input: CreateContentItemTypeInput!) {
     createContentItemType(input: $input) {
       __typename
       ... on MutateContentTypeSuccessResponse { data { id version name } }
     }
   }`,
  {
    input: {
      name: itemTypeName,
      description: 'Item type used by the perf harness',
      fields: [
        { name: 'text', type: 'STRING', required: true },
        { name: 'creatorId', type: 'USER_ID', required: true },
        { name: 'createdAt', type: 'DATETIME', required: true },
      ],
      // Field roles are left unset: `creator_id_field` etc. carry DB check
      // constraints tying them to specific field types, and the harness does
      // not need them.
      fieldRoles: {},
    },
  },
  cookie,
);

// The create mutation does not return the row it just wrote, so read it back
// off the org.
const orgId = login.body.data.login.user.orgId;
const listed = await gql(
  `query Org($id: ID!) {
     org(id: $id) {
       itemTypes { __typename ... on ItemTypeBase { id name version } }
     }
   }`,
  { id: orgId },
  cookie,
);
const itemTypes = listed.body.data.org.itemTypes;
const itemType = itemTypes.find((it) => it.name === itemTypeName);
if (!itemType) {
  throw new Error(
    `Item type ${itemTypeName} not found after creation: ${JSON.stringify(created.body.data)}`,
  );
}

// `creatorId` (a USER_ID field) must reference an existing user item type, so
// submitted items need the org's user type id as well.
const userItemType = itemTypes.find((it) => it.__typename === 'UserItemType');
if (!userItemType) {
  throw new Error(
    'No user item type found for org; create-org should make one',
  );
}

const fixtures = {
  createdAt: new Date().toISOString(),
  baseUrl,
  cookie,
  orgId,
  apiKey: apiKey ?? null,
  itemTypeId: itemType.id,
  itemTypeVersion: itemType.version,
  itemTypeName: itemType.name,
  userItemTypeId: userItemType.id,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(fixtures, null, 2)}\n`);
process.stdout.write(`Wrote fixtures to ${out} (itemType ${itemType.id})\n`);
