# Coop resource measurement harness

Reproducible measurement of what Coop costs to run: boot time, memory (RSS,
V8 heap, per-space), CPU, file descriptors, threads, container memory, disk and
image footprint, and throughput/latency under load — captured as JSON that
`diff`s cleanly between runs so a regression shows up as a number.

Nothing here is wired into CI or the app. It has **no dependencies** beyond Node
and the tools already needed to run Coop (`docker`, `curl`).

## Quick start

```bash
# 1. backing services + schema (see the root README for the long version)
npm run up
for db in api-server-pg scylla clickhouse; do
  npm run db:create -- --env staging --db "$db"
  npm run db:update -- --env staging --db "$db"
done

# 2. an org to load-test against (keep the API key it prints)
export COOP_PERF_PASSWORD='pick-anything-local'
npm run create-org -- --name "Perf Test Org" --email perf@example.com \
  --website https://example.com --firstName Perf --lastName Tester \
  --password "$COOP_PERF_PASSWORD"

# 3. build the server, start it once, and provision fixtures
(cd server && npm run build && npm start)     # in another terminal
node perf/bin/setup-fixtures.mjs \
  --email perf@example.com --password "$COOP_PERF_PASSWORD" --api-key <key>

# 4. stop that server, then run the full measurement
perf/bin/run.sh --run-id baseline --with-worker
```

Results land in `perf/results/<run-id>/`:

| file                      | what it is                                                                       |
| ------------------------- | -------------------------------------------------------------------------------- |
| `summary.md`              | human-readable tables                                                            |
| `summary.json`            | the same numbers, stable key order — this is what you diff                       |
| `meta.json`               | git sha, host shape, node version                                                |
| `footprint.json`          | node_modules / build output / image sizes                                        |
| `raw/*.jsonl`             | every sample, per phase (`idle`, `ready`, `graphql`, `ingest`, `soak`, `settle`) |
| `raw/probe-*.jsonl`       | in-process V8 heap, handles, event-loop delay                                    |
| `raw/load-*.json`         | load generator results per phase                                                 |
| `raw/heap-*.heapsnapshot` | heap snapshots at phase boundaries                                               |

## Comparing two runs

```bash
node perf/bin/compare.mjs --base perf/results/baseline --head perf/results/my-change
# add --fail-on-regression --threshold-percent 10 to use as a gate
```

```
metric                     base        head        delta    pct      verdict
idle.serverRssMib          328.4 MiB   231.1 MiB   -97.3    -29.6%   improved
startup.bootToReadyMs      2006 ms     1847 ms     -159     -7.9%    same
```

## Phases that `run.sh` walks through

1. **cold start** — spawn the built server, poll `/api/v1/ready` until it answers.
   Boot time is "time until it can serve traffic", not "time to first log line".
2. **idle** — no traffic. Idle cost is what a self-hoster pays 24/7.
3. **load** — `ready`, `graphql-me`, and `items-async` scenarios in turn, each
   with its own sampler window, so cost attributes to a specific path.
4. **soak** — sustained mixed load, long enough to tell a plateau from a leak.
   The summary reports an RSS/heap slope in MiB per minute; near-zero is a
   plateau, sustained positive is a leak.
5. **settle** — idle again, to see whether memory comes back down after load.

Heap snapshots are **opt-in via `--snapshots`**, taken at each phase boundary
plus once after the settle phase. They are opt-in because writing a snapshot
permanently inflates the process's RSS — V8 does not hand that memory back — so
a run used for absolute RSS comparisons should not take them. Use a
`--snapshots` run to answer "what is in the heap", a plain run to answer "how
big is it".

Writing a snapshot also forces a full mark-compact first, which is the only
reliable way to separate live data from garbage the collector has not got to
yet. The probe records `pre-snapshot` and `post-snapshot` samples for exactly
this comparison.

## The pieces, used on their own

```bash
# OS-level sampler: RSS/PSS/threads/fds/CPU/IO for a process tree + containers
node perf/lib/sampler.mjs --pid <pid>[,<pid>] --containers coop-postgres-1,coop-redis-1 \
  --out samples.jsonl --interval-ms 1000 --duration-s 60 --label idle

# In-process probe: preload into any node process to get V8 heap detail.
# SIGUSR2 writes a heap snapshot.
COOP_PROBE_OUT=probe.jsonl node --require perf/lib/probe.cjs server/transpiled/bin/www.js

# Load generator (no deps, keep-alive, closed loop)
node perf/bin/load.mjs --scenario mixed --concurrency 25 --duration-s 60

# What does each dependency cost just to import?
node perf/bin/import-cost.mjs --package server --repeats 3

# What is the heap actually full of? And what grew between two snapshots?
node perf/bin/analyze-heapsnapshot.mjs raw/heap-idle.heapsnapshot --top 25
node perf/bin/analyze-heapsnapshot.mjs raw/heap-pre-soak.heapsnapshot \
  --diff raw/heap-post-soak.heapsnapshot

# Disk/image footprint on its own
perf/bin/footprint.sh
```

## Load scenarios

| scenario      | request                        | exercises                                                                                 |
| ------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `ready`       | `GET /ready`                   | Express + the readiness handler                                                           |
| `graphql-me`  | `POST /graphql` `{ me { … } }` | session auth, Apollo, Postgres session store                                              |
| `items-async` | `POST /items/async/`           | the ingest hot path: API key auth, JSON-schema validation, rule evaluation, Redis enqueue |
| `mixed`       | 70/30 of the two above         | steady-state blend for soaks                                                              |

`items-async` behaviour depends on `ITEM_QUEUE_TRAFFIC_PERCENTAGE`: that
fraction goes to BullMQ (and needs `--with-worker` to be consumed), the rest is
evaluated inline in the API process after the 202 is sent.

## Caveats worth knowing before you quote a number

- **RSS is not all "leak".** V8 keeps compiled code and module source text
  resident and does not return it to the OS. A process can show 300 MiB RSS with
  a 90 MiB heap; the gap is mostly loaded code.
- **`import-cost.mjs` numbers do not add up.** Each dependency is measured in a
  cold process, so shared transitive deps (graphql, lodash) are counted once per
  parent. Use it to rank, not to total.
- **The sampler's own cost is real but small** (~40 MiB node process). It is
  excluded from the process tables unless you point it at itself.
- **Container memory from `docker stats`** includes page cache, so it moves with
  I/O. Compare like-for-like phases.
- **A crashed server looks fast.** It refuses connections in microseconds, so a
  run where the process died reports enormous throughput. `compare.mjs` checks
  the error rate of every phase and prints `UNHEALTHY` when more than 1% of
  requests failed; read that line before the table.
- Runs are only comparable on the same host shape — `meta.json` records it.
