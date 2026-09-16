# Resource usage: where Coop's memory and CPU go

Coop has a reputation for being resource-hungry. This document replaces that
anecdote with measurements: what a Coop deployment actually costs at rest and
under load, which code is responsible, and what is worth changing.

Everything here was produced by the harness in [`perf/`](../../perf/README.md).
Raw artifacts for every run quoted below are under `perf/results/`.

> **Measurement host.** 8 vCPU, 14.9 GiB RAM, Linux 7.0, Node 24.20.0, Docker
> 29.8. The API server was built with `npm run build` and run from
> `transpiled/bin/www.js` — the production entry point — against the
> `docker-compose` backing services, with `ItemProcessingWorker` alongside.
> Absolute numbers move with host shape; the ratios travel.

## The short version

| question                                  | answer                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Full local stack at rest                  | **~1.6 GiB** — 1175 MiB containers + ~300 MiB API server + ~145 MiB worker                                               |
| The dev loop on top of that               | **~1.3 GiB steady, 2.5 GiB peak** of Node processes                                                                      |
| Under ingest load                         | API server reaches **1.45 GiB**, containers **3.7 GiB**                                                                  |
| Is there a memory leak?                   | **No.** After the backlog drains the heap returns to 77 MiB, against 70 MiB at idle                                      |
| So why does it look like one?             | The _live_ working set under load exceeds **494 MiB**, and RSS never returns to the OS afterwards                        |
| What happens on a small container?        | With `--max-old-space-size=512`, a **30-second** ingest burst OOM-kills the server                                       |
| Can reviewers work while reports pour in? | Yes to ~200 reports/s (p99 ~24 ms). At 400/s the console hits a **5.2 s p99** and **25 jobs/min** — a cliff, not a slope |
| Cheapest single win                       | One import line: **66 MiB RSS, 25 MiB heap, 150 ms boot**, measured end to end                                           |

The headline is not that any one thing is huge. It is that Coop pays a large
fixed cost before serving a request, and that nothing bounds its ingest path —
so under load it takes whatever it needs, and the interactive path pays for it.

## Phase 1 — baseline

### Startup

| metric                               | value                                                      |
| ------------------------------------ | ---------------------------------------------------------- |
| Boot to `/ready` answering           | **2.0–2.8 s** (five runs: 1985, 2006, 2558, 2748, 2762 ms) |
| Bare `node`, before app modules load | 45.7 MiB RSS, 4.8 MiB heap                                 |
| After the module graph loads         | 328 MiB RSS, 93 MiB heap                                   |
| Cost of loading Coop's own code      | **+283 MiB RSS, +88 MiB heap**                             |

Roughly **1,100 ES modules** are loaded at boot (counted as `ModuleWrap`
instances in the idle heap snapshot).

### Idle

Idle RSS is not a single number, because V8's memory reducer hands pages back
after a couple of minutes of quiet:

| moment                | API server RSS |
| --------------------- | -------------- |
| Just after boot       | ~329 MiB       |
| After ~2 minutes idle | **~160 MiB**   |
| Worker, idle          | ~145 MiB       |

Threads stay at 11 and file descriptors at 26 through idle; nothing spins. Idle
CPU over a 120 s window was 0.5 CPU-seconds.

What the 70 MiB idle heap is made of (shallow size, via
`perf/bin/analyze-heapsnapshot.mjs`):

| bucket                           | MiB  | count   |
| -------------------------------- | ---- | ------- |
| strings                          | 31.5 | 152,804 |
| compiled code                    | 13.8 | 184,750 |
| arrays                           | 8.6  | 47,918  |
| object shapes                    | 3.8  | 42,892  |
| GraphQL AST `Token` / `Location` | 1.9  | 25,880  |

Almost none of the idle heap is data. It is loaded code and the strings that
come with it — which is why the dependency graph, not the business logic,
dominates the resting cost.

### Backing services

`npm run up` starts seven containers. Cold, healthy, no traffic:

| container      | MiB idle |
| -------------- | -------- |
| clickhouse     | 496      |
| hma            | 277      |
| scylla         | 252      |
| otel-collector | 57       |
| postgres       | 46       |
| redis          | 39       |
| jaeger         | 9        |
| **total**      | **1175** |

Scylla also takes **~3 minutes** to report healthy after a restart, which is
most of the wait when bringing a stack up.

### Disk and images

| item                                     | size                                                                |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `node_modules`, all four packages        | **1388 MiB** (client 700, server 389, root 120, db 93, migrator 86) |
| installed packages                       | **2534** (server 1330, client 878, root 326)                        |
| server build output (`transpiled/`)      | 9 MiB                                                               |
| client build output                      | 6.1 MiB                                                             |
| production server image (`build_server`) | **590 MB**                                                          |
| server test/CI image (`server_base`)     | 876 MB                                                              |
| client build image (`client_base`)       | 1.09 GB                                                             |

The production server image is 329 MB of `node:24-bookworm-slim`, 237 MB of
`npm ci --omit=dev`, and 8.6 MB of application code. Inside the production
dependencies (193 MiB on disk):

| package         | MiB    |
| --------------- | ------ |
| date-fns        | **34** |
| @stdlib         | 28     |
| @aws-sdk        | 16     |
| @opentelemetry  | 15     |
| @apollo         | 15     |
| @smithy         | 9      |
| everything else | 76     |

### The development loop

`npm run compile` (what `npm start` runs) is heavier than the application it
builds. Sampled over 7 minutes:

| process                     | instances | mean MiB | peak MiB |
| --------------------------- | --------- | -------- | -------- |
| `tsc --watch`               | 1         | 548      | **1293** |
| api server                  | 1         | 199      | 466      |
| `vite` dev server           | 1         | 117      | 178      |
| `graphql-codegen --watch`   | 1         | 96       | 189      |
| **`npm` wrapper processes** | **5**     | 50 each  | 52 each  |
| `concurrently`              | 1         | 50       | 51       |
| `tsc-watch` wrapper         | 1         | 40       | 43       |
| esbuild service             | 1         | 24       | 31       |
| shell wrappers              | 8         | 1.8 each | —        |
| **total**                   |           | **1332** | **2521** |

Two things stand out. The TypeScript compiler peaks at 1.29 GiB during the
first full type-check and does not reliably give it back: it was observed at
434 MiB shortly after the initial compile but at 1.07 GiB after several hours of
an editing session, so treat 548 MiB as a mean and the high end as where a long
session lands. That, not the server, is what makes `npm start` feel heavy on a
small machine. And **five `npm` processes hold ~250 MiB between them purely to
spawn other processes**:
`concurrently` runs `npm run server:start`, which runs `npm start`, which runs
`tsc-watch`, with the same nesting on the client and codegen sides.

## Phase 2 — under load

### Throughput

Closed loop, 25 concurrent keep-alive connections:

| scenario                           | rps      | p50     | p90     | p99     |
| ---------------------------------- | -------- | ------- | ------- | ------- |
| `GET /ready`                       | **24.9** | 1001 ms | 1003 ms | 1012 ms |
| `POST /graphql` `{ me }`           | 1028     | 24 ms   | 28 ms   | 33 ms   |
| `POST /items/async/` (5 items/req) | 309      | 52 ms   | 114 ms  | 567 ms  |
| mixed, sustained 7 min             | 96       | 75 ms   | 162 ms  | 988 ms  |

GraphQL throughput is healthy. Three other numbers are not:

**`/ready` costs exactly one second per call**, because the handler samples host
CPU, `await`s 1000 ms, then samples again
([`server/api.ts:76`](../../server/api.ts)). It measures _host-wide_ CPU via
`os.cpus()` — not this process or container — and returns HTTP 500 above 75%.
On a busy host every Coop pod reports unhealthy simultaneously, exactly when you
least want them pulled from rotation.

**Ingest p99 is 10× its p50** because submissions are batched through a
DataLoader with a fixed 500 ms window
([`server/queues/itemSubmissionQueue.ts:24`](../../server/queues/itemSubmissionQueue.ts))
that the caller awaits. Below 200 items per window, every request pays most of
that 500 ms.

**Sustained mixed load collapses to 96 rps** with a 988 ms p99 and the run's
first errors (35 × HTTP 500, 6 × ECONNRESET) — by then the process is managing
a gigabyte of heap.

### Memory under load, by phase

API server RSS, one process across a single run
(`perf/results/baseline/summary.md`):

| phase                      | mean     | max          | trend            |
| -------------------------- | -------- | ------------ | ---------------- |
| idle (120 s)               | 297 MiB  | 330 MiB      | −79 MiB/min      |
| `/ready` load (45 s)       | 164 MiB  | 166 MiB      | +8 MiB/min       |
| GraphQL load (45 s)        | 413 MiB  | 437 MiB      | +162 MiB/min     |
| ingest load (45 s)         | 841 MiB  | 1181 MiB     | **+962 MiB/min** |
| soak, mixed (420 s)        | 1143 MiB | **1451 MiB** | +81 MiB/min      |
| settle, no traffic (180 s) | 1294 MiB | 1303 MiB     | −7 MiB/min       |

The worker is well-behaved throughout: heap trend **+0.23 MiB/min**, RSS steady
at 145–220 MiB. Whatever grows, grows in the API process.

### It is not a leak — and that matters

The settle phase above looks damning: three minutes after traffic stops, heap
sits flat at 949 MiB. But flat is not the same as retained. V8 will not run a
major GC on an idle process whose heap limit is still gigabytes away, so a
sample of `heapUsed` on an idle process measures _garbage plus live data_.

Forcing the question (`perf/results/leak-probe/`, which snapshots at phase
boundaries — writing a snapshot forces a full mark-compact first):

| moment             | heap before forced GC | after      |
| ------------------ | --------------------- | ---------- |
| idle, post-boot    | 96 MiB                | 65 MiB     |
| after ingest burst | 616 MiB               | 326 MiB    |
| after soak         | 715 MiB               | 255 MiB    |
| after 150 s settle | 73 MiB                | **72 MiB** |

And comparing the snapshots directly: **70.3 MiB at idle vs 76.8 MiB after the
whole load run had drained** — 6.5 MiB apart, after processing tens of thousands
of items. There is no leak. The backlog drains completely.

Two real problems hide behind that reassuring fact:

**1. The live working set under load is enormous.** Running the same load
against a server started with `--max-old-space-size=512`
(`perf/results/heapcap-512/`) does not slow down gracefully — it dies, 30
seconds into the ingest phase:

```
160370 ms: Mark-Compact 499.3 (521.7) -> 493.5 (524.0) MB ... (average mu = 0.139)
160543 ms: Mark-Compact 501.6 (525.0) -> 494.5 (542.5) MB ... (average mu = 0.125)
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

Mark-compact reclaimed ~6 MB per cycle against a ~494 MB live set, with GC
consuming 86–96% of the process's time before it gave up. An API container
provisioned with 512 MB–1 GB will be OOM-killed by a modest ingest burst. That
is almost certainly what "Coop is resource-hungry" means in practice.

**2. RSS never comes back.** Even once the heap returns to 73 MiB, process RSS
stays above 1.2 GiB: V8 does not return its arenas to the OS. An operator
watching container memory sees a process that grew tenfold during one burst and
stayed there, with no leak to find.

### Why the working set grows: no bound on in-flight work

`POST /items/async/` sends `202 Accepted` and _then_ does the work
([`server/routes/items/submitItems.ts`](../../server/routes/items/submitItems.ts)),
because `ITEM_QUEUE_TRAFFIC_PERCENTAGE` defaults to `0.05` — 95% of submissions
are evaluated inline in the API process rather than going through the durable
queue. After responding, the handler awaits, per item: a Scylla insert, rule
evaluation, and a ClickHouse write. Nothing limits how many of these may be in
flight, and the client has already been told the request succeeded.

Diffing the idle heap against the post-soak heap
(`perf/results/leak-probe/analysis/heap-diff-idle-to-postsoak.txt`) shows
exactly that shape — +190 MiB, made of:

| what grew                               | Δ count      | ΔMiB |
| --------------------------------------- | ------------ | ---- |
| `Promise`                               | +134,276     | 6.2  |
| `Generator` (suspended `async` frames)  | +87,366      | 7.3  |
| closures                                | +285,587     | 15.6 |
| `system / Context` (captured variables) | +253,805     | 15.2 |
| `ClientRequest` / `URLContext`          | +10,664 each | 6.5  |
| strings (the item payloads)             | +366,546     | 34.2 |
| arrays                                  | +320,864     | 46.1 |

134,000 pending promises and 10,664 outbound HTTP requests in flight at once, each
holding its item payload alive.

The soak's server log contains **1,829 instances** of `The host 127.0.0.1:9042
did not reply before timeout 12000 ms` — every timed-out Scylla insert pins its
item submission in memory for up to 12 seconds while new requests keep arriving
at ~1,500 items/second.

The _trigger_ here is environment-specific: the compose Scylla runs
`--smp 1 --developer-mode 1` and is not sized for that rate. The _amplification_
is architectural. Any slow downstream — degraded Scylla, ClickHouse mid-
compaction, a slow HMA — converts into unbounded in-flight state in the API
process, with no signal to the caller and no shedding.

### Import cost: what we pay before serving anything

Each dependency imported into a cold Node process, median of 3
(`perf/bin/import-cost.mjs`). These do **not** sum — shared transitive
dependencies are counted once per parent — but they rank:

| dependency                          | RSS          | heap     | import time |
| ----------------------------------- | ------------ | -------- | ----------- |
| **@roostorg/coop-types**            | **97.5 MiB** | 53.8 MiB | **151 ms**  |
| @roostorg/coop-integration-example  | 97.1 MiB     | 53.3 MiB | 166 ms      |
| bullmq                              | 33.9 MiB     | 12.1 MiB | 68 ms       |
| @aws-sdk/client-s3                  | 32.3 MiB     | 9.2 MiB  | 49 ms       |
| @googlemaps/google-maps-services-js | 28.6 MiB     | 7.3 MiB  | 58 ms       |
| undici                              | 27.0 MiB     | 6.9 MiB  | 53 ms       |
| @sendgrid/mail                      | 26.8 MiB     | 5.8 MiB  | 46 ms       |
| @stdlib/stats-binomial-test         | 24.8 MiB     | 7.6 MiB  | 75 ms       |
| cassandra-driver                    | 24.8 MiB     | 4.8 MiB  | 42 ms       |
| express                             | 24.5 MiB     | 7.7 MiB  | 57 ms       |
| @apollo/server                      | 20.5 MiB     | 6.9 MiB  | 63 ms       |

The most expensive import in the whole server is a _types_ package, because of
one line — [`types/index.ts:1`](../../types/index.ts):

```ts
import { isValid, parseJSON } from 'date-fns';
```

`date-fns` v2's barrel entry point pulls in the entire library. In isolation:

|                                                   | RSS      | import time |
| ------------------------------------------------- | -------- | ----------- |
| `import { isValid, parseJSON } from 'date-fns'`   | 99.1 MiB | 144 ms      |
| `date-fns/esm/isValid` + `date-fns/esm/parseJSON` | 5.6 MiB  | 7 ms        |

That memory is genuinely retained: two forced GCs leave the JS heap at 3.1 MiB
but RSS unchanged at 97.9 MiB, because the cost is V8's compiled code and module
metadata, which is never returned to the OS.

## Phase 3 — does it degrade gracefully?

The operational question behind all of this: **as report volume scales up, can
reviewers still work jobs?** Reviewers and the ingest API share one process and
one database pool, so this is an isolation question, not a throughput one.

`perf/bin/contention.mjs` runs both workloads against one server at once:

- **reviewers** — a sequential `dequeueManualReviewJob` → `submitManualReviewDecision`
  loop, i.e. what a human working the review console actually does.
- **ingest** — `POST /report/` injected open-loop at a fixed rate, stepped
  upward, so "report volume" is expressed in reports/second rather than in
  client concurrency.

Method: production-style server, dev stack stopped, Scylla restarted and the
review queue drained before each run, 60 s per step, one virtual reviewer with
no think time. Both runs below logged **zero** Scylla timeouts, so nothing here
is the Scylla saturation from Phase 2.

### Result: graceful to ~200 reports/s, then a cliff

With the pool sizes in `server/.env.example` (`DATABASE_POOL_MAX=5`,
`DATABASE_READ_POOL_MAX=10`):

| reports/s | achieved | reviewer jobs/min | dequeue p99   | decide p99 | queue depth |
| --------- | -------- | ----------------- | ------------- | ---------- | ----------- |
| 100       | 99.6     | 3543              | 19.5 ms       | 20.6 ms    | 24,453      |
| 200       | 199.0    | 3129              | 23.8 ms       | 21.0 ms    | 33,259      |
| 400       | 325.7    | **25**            | **5251 ms**   | 5008 ms    | 51,197      |
| 800       | 178.6    | **26**            | **11,749 ms** | 9016 ms    | 61,712      |

Up to 200 reports/s the review console is unaffected — p99 around 20 ms, over
3,000 jobs/min. Past that it does not degrade, it **falls over**: a 2× increase
in report volume costs 125× reviewer throughput and 220× dequeue latency. At a
5-second p99 the console is unusable.

Note that ingest itself also goes backwards — 800 reports/s offered yields _less_
accepted throughput (178/s) than 400 offered (326/s). The system is past its
knee and losing ground.

### The lever is the Postgres pool, not memory

Re-running identically with a larger pool (`20`/`60`, still within the compose
Postgres' `max_connections = 100`):

| reports/s | achieved | reviewer jobs/min | dequeue p99 | decide p99 |
| --------- | -------- | ----------------- | ----------- | ---------- |
| 100       | 99.6     | 4188              | 13.2 ms     | 13.0 ms    |
| 200       | 199.2    | 3001              | 28.2 ms     | 25.6 ms    |
| 400       | 389.2    | **684**           | **416 ms**  | 312 ms     |
| 800       | 359.2    | 114               | 4540 ms     | 3119 ms    |

At 400 reports/s, four extra pooled connections buy **27× reviewer throughput**
(25 → 684 jobs/min) and **12.6× lower dequeue p99** (5251 → 416 ms). Server RSS
was essentially identical between the two runs (674 vs 618 MiB peak), so this is
connection contention, not memory.

The cliff moves but does not disappear: even at 20/60, reviewer p99 goes 28 ms →
416 ms → 4.5 s across a 4× load increase. Raising the pool buys headroom, not
isolation — the two workloads still compete for one resource.

### Why ingest consumes pool so fast

Every authenticated API request runs **two** Postgres queries in
`ApiKeyService.validateApiKey`
([`server/services/apiKeyService/apiKeyService.ts:127`](../../server/services/apiKeyService/apiKeyService.ts)):
a `SELECT` on the key hash, then an `UPDATE ... SET last_used_at = now()`.
There is no caching, so ingest occupies pool connections at twice its request
rate, and the write lands on **one row** — every concurrent request contends for
the same row lock, and each fires the table's `BEFORE UPDATE` trigger.

Confirmed in `pg_stat_user_tables` after this session: **216,742 updates against
a 5-row table**. (The 207,425 sequential scans on the same table are _not_ a
missing index — `key_hash` is indexed twice over; the planner simply prefers a
scan at 5 rows.)

Caching validation for a few seconds, and writing `last_used_at` on a sampled or
batched basis rather than per request, would cut ingest's pool consumption by
roughly half and remove the single-row serialization point.

### Infrastructure failures are reported to clients as 401

[`server/utils/apiKeyMiddleware.ts`](../../server/utils/apiKeyMiddleware.ts)
wraps validation in `try { ... } catch { orgId = null }`, and a null org becomes
`401 Invalid API Key`. A pool-acquisition timeout, a query timeout, or a
Postgres blip is therefore reported to the caller as bad credentials.

This showed up only in the runs where the system was already struggling (222,
981 and 1,746 occurrences in the degraded runs; zero in the two clean runs
above), which is exactly the pattern the code predicts. It is the worst possible
status code for the situation: 401 is a permanent client error, so well-behaved
clients will not retry — they will page someone about a broken API key while the
real problem is a busy database. A `503` with `Retry-After` is the correct
signal.

### Two smaller observations

- **Backlog is unbounded and invisible to the submitter.** Queue depth reached
  61,712 jobs with no shedding, no warning and no change in the `201` returned
  to the reporting client. Reviewers cannot consume 200 reports/s, so a real
  deployment accumulates backlog indefinitely; nothing in the API surface says so.
- **An idle reviewer waits 5 seconds for "no jobs".** `dequeueManualReviewJob`
  uses BullMQ's `getNextJob`, whose blocking pop honours the default 5 s
  `drainDelay`, so on an empty queue the console's "next job" action takes ~5 s
  to return nothing. Measured: 5016 ms p50 against an empty queue.

## Findings, ranked

Ranked by measured saving against how invasive the fix is. "Measured" means
there is a number in this document; "inferred" means the mechanism is confirmed
in code but the saving is not measured end to end.

### 1. Unbounded in-flight work on the ingest path — OOM at 512 MB · design change · **measured**

The single most consequential finding. The live working set exceeds 494 MiB
under a 30-second ingest burst and takes the process down on any container sized
under ~1 GiB. Options, roughly in increasing order of effort:

- Bound the inline path with a concurrency limiter — `p-limit` is already a
  dependency — so in-flight items cannot exceed a fixed budget.
- Raise `ITEM_QUEUE_TRAFFIC_PERCENTAGE` toward `1` so the durable queue absorbs
  the backlog. The queue path _is_ bounded (BullMQ worker concurrency 30), and
  the worker's flat +0.23 MiB/min heap trend under the same load is the evidence
  that it behaves.
- Shed load (503) rather than accepting work the process cannot hold.
- Until one of those lands, document a minimum memory requirement for the API
  container, because the current answer is "more than you would guess".

### 1b. Ingest starves the review console past ~200 reports/s · design change · **measured**

The same lack of bounds, seen from the reviewer's side. At 400 reports/s the
review console goes from a 24 ms p99 to a 5.2 s p99 and from 3,100 to 25
jobs/min. Reviewers and ingest share one Postgres pool with no reservation
between them, so ingest starves the interactive path. Fixes compose with #1 —
bounding in-flight ingest work is what stops it monopolising connections — plus
either a separate pool for interactive traffic or admission control that
prioritises it.

### 1c. `validateApiKey` does two queries and a single-row `UPDATE` per request · small · **measured**

216,742 updates against a 5-row `api_keys` table in one session. Every
authenticated request re-reads the key and rewrites `last_used_at` on the same
row, doubling ingest's pool consumption and serialising concurrent requests on
one row lock plus a `BEFORE UPDATE` trigger. Cache validation for a few seconds
and sample or batch the `last_used_at` write. Cheapest meaningful win on the
ingest path.

### 1d. Infrastructure failures are returned as `401 Invalid API Key` · small · **measured**

`apiKeyMiddleware` catches every validation error and turns it into a 401, so a
pool timeout or database blip tells the caller its credentials are bad.
Observed 222–1,746 times per run when the system was struggling, zero when
healthy. 401 is permanent, so clients will not retry and operators chase a
credentials problem that does not exist. Return `503` with `Retry-After` for
infrastructure failures and reserve 401 for keys that genuinely do not validate.

### 2. `date-fns` barrel import — 66 MiB RSS, 25 MiB heap, 150 ms boot · one line (×2) · **measured**

A/B on the real server process, two runs each, patching the built package in
`node_modules` and restoring afterwards:

|                         | boot          | RSS after boot       | heap               |
| ----------------------- | ------------- | -------------------- | ------------------ |
| barrel import (current) | 2082, 2091 ms | 325.1, 328.1 MiB     | 94.6, 92.5 MiB     |
| deep imports            | 1985, 1879 ms | **265.8, 256.0 MiB** | **69.5, 69.6 MiB** |

**~66 MiB RSS (−20%), ~24 MiB heap (−26%), ~150 ms boot (−7%)**, on every Coop
process — API server, worker, every CLI script. `date-fns` is also the largest
single package in the production image at 34 MiB.

Note the isolated import measurement above suggested ~93 MiB; the real saving is
smaller because a warm process amortises module-loading overhead. The 66 MiB
number is the one to quote.

Two things must change together, which is why the first attempt at this A/B
measured only 13 MiB: **both** [`types/index.ts`](../../types/index.ts)
(published as `@roostorg/coop-types`) and its twin `@roostorg/types` (pulled in
by `@roostorg/coop-integration-example`, which the integration registry loads
eagerly at startup) import the barrel. Patching one leaves the other loading the
whole library. Both are published packages, so this needs a release before the
server sees it — and two functions this small are also a reasonable candidate
for dropping the dependency entirely.

### 3. `/ready` sleeps one second and watches the wrong CPU · small · **measured**

[`server/api.ts:76`](../../server/api.ts). A 24.9 rps ceiling and 1001 ms p50 on
a health endpoint. `process.cpuUsage()` deltas between calls, or cgroup v2
`cpu.stat`, give a container-aware answer for free.

### 4. `getUsableCoreCount()` reads cgroup v1 only · one line · **measured**

[`server/utils/cpu-helpers.ts`](../../server/utils/cpu-helpers.ts) reads
`/sys/fs/cgroup/cpu/cpu.cfs_quota_us`, a cgroup **v1** path. On any cgroup v2
host — every current Docker and Kubernetes default — that read fails and the
code falls back to `os.cpus().length`, the _host's_ core count. Measured inside
a `--cpus=1` container on this 8-core host:

| source                            | value                 |
| --------------------------------- | --------------------- |
| `getCFSLimit()` (cgroup v1 path)  | missing → `undefined` |
| `os.cpus().length` (what it uses) | **8**                 |
| cgroup v2 `cpu.max` (the truth)   | 1                     |
| `os.availableParallelism()`       | **1**                 |

`os.availableParallelism()` already accounts for cgroup v2.

### 5. `GlobalWorkerPool` is dead weight · deletion · **measured**

Declared in `Dependencies`, registered as a factory, listed for shutdown — and
with **no consumers anywhere in the repo**. BottleJS factories are lazy, so it
never instantiates and costs no RSS today, but it keeps
`node-worker-threads-pool` in the tree and is the only consumer of the
miscounted core count in #4, where it would size a worker-thread pool at
`cores - 1`: 7 isolates instead of 1 on a single-CPU container. Deleting it
removes a dependency and a latent bug.

### 6. `express.json({ limit: '50mb' })` on every route · small · **inferred**

[`server/api.ts:119`](../../server/api.ts) raises the body limit 500× above the
Express default of 100 kB, for every endpoint including GraphQL, and there is no
cap on `items[]` length in the submit route's schema
([`server/routes/items/ItemRoutes.ts`](../../server/routes/items/ItemRoutes.ts)).
A parsed 50 MB JSON body typically occupies 2–4× its wire size as V8 objects, so
a few concurrent maximum-size requests is a multi-gigabyte spike — and given
finding #1, that memory is then held through the whole inline processing path. A
per-route limit plus a `maxItems` in the schema bounds it.

### 7. Postgres pool defaults exceed the default server · config · **inferred**

`DATABASE_READ_POOL_MAX` defaults to **150** and `DATABASE_POOL_MAX` to 30 in
[`server/iocContainer/index.ts`](../../server/iocContainer/index.ts). Neither
`.env.docker` nor `.env.githubci` overrides them, and the compose Postgres runs
stock with `max_connections = 100`. One replica's code defaults already exceed
the server's limit; two certainly do. `server/.env.example` sensibly sets 5/10,
which is why local dev never sees it.

### 8. 511 KB vendor logo in the client bundle · trivial · **measured**

The client production build is 6.1 MiB: 4.1 MiB of JS across 200 chunks
(1.1 MiB gzipped), a 939 KiB entry chunk (281 KiB gzipped), and 988 KiB of
images and fonts — of which **511 KiB is `OpenAILogoWithBackground.png`**, a
single vendor logo, over half the image payload. An SVG or an optimised PNG is a
one-line change.

Separately, `client/src/images` holds 11 MiB across 50 files of which
**9.4 MiB is referenced by nothing** (largest: `HomeFirstGraphic.png` 1.86 MiB,
`Integrations.png` 1.33 MiB, `IntegrationsWithBuffer.png` 1.29 MiB). Vite does
not emit them, so this is checkout and Docker build-context weight, not bundle
weight.

### 9. Per-request redundant serialization · small · **measured**

Every item submission writes the **entire item type schema**, JSON-serialized,
into its `CONTENT_API_REQUESTS` row
([`server/services/analyticsLoggers/ContentApiLogger.ts`](../../server/services/analyticsLoggers/ContentApiLogger.ts)).
Over 56,515 rows of the 3-field test item type that is 6.78 MiB uncompressed
(28 KiB compressed — ClickHouse deduplicates it well, so this is CPU and
allocation cost, not storage). A realistic 20–40 field schema is 10–30× larger
per row, re-serialized on every submitted item.

### 10. Unbounded caches · latent · **inferred**

`cached()` uses a plain `Map` unless `numItemsLimit` is passed
([`server/lib/cache/stores/MemoryStore/ExpiringEntryMap.ts:33`](../../server/lib/cache/stores/MemoryStore/ExpiringEntryMap.ts)).
Of 24 non-test call sites, **20 pass no limit**. The expiry sweeper visits 20
entries every 2 seconds — a ceiling of 10 evictions/second regardless of insert
rate — and `itemTypeVersionsCache` uses `freshUntilAge: Infinity`, so its entries
never expire at all.

Latent rather than observed: every key in use today is configuration-scoped
(org, rule, item type, bank ids), so growth is bounded by config size, not
traffic. The first cache keyed on an item or user id would change that silently.

### 11. Five `npm` processes in the dev loop · small · **measured**

~250 MiB of the dev stack is `npm` processes whose only job is to spawn the next
process. Having `concurrently` invoke the underlying tools directly (or using
`npm --prefix`) removes most of that without changing the workflow.

### 12. Client build heap cap looks unnecessary · speculative

`client/Dockerfile` builds with `NODE_OPTIONS="--max-old-space-size=5250"`. The
build measured here finished in 8.9 s with a peak RSS of 1.5 GiB — a third of
that budget. Worth re-checking on CI hardware before touching, since the cap was
presumably added in response to a real OOM.

### 13. Base image is over half the production image · speculative

329 MB of the 590 MB server image is `node:24-bookworm-slim`. `AGENTS.md`
documents the deliberate choice of Debian over Alpine for native modules, so this
is noted, not recommended.

## Where to look next

- **Re-run the soak with a healthy Scylla** (or
  `ITEM_INVESTIGATION_AND_STRIKES_ENABLED=false`) to separate "Scylla is the
  bottleneck here" from "the path has no bound". The prediction is that memory
  still grows, just more slowly.
- **Measure `ITEM_QUEUE_TRAFFIC_PERCENTAGE=1`** under the same load. If the
  queue path holds flat where the inline path grows, finding #1 has its fix and
  the harness can prove it.
- **Find the right container size.** The 512 MB run OOMs; bisecting with
  `perf/bin/run.sh --node-args "--max-old-space-size=N"` turns "how much memory
  does Coop need?" into a number worth documenting.
- **Profile CPU under ingest**, not just memory. `node --cpu-prof` during the
  ingest phase would show whether JSON-schema validation, serialization, or
  driver overhead dominates.
- **A minimal deployment profile.** Scylla, ClickHouse, HMA, Jaeger and the OTel
  collector are 1090 of the 1175 MiB of idle container memory.
  `ITEM_INVESTIGATION_AND_STRIKES_ENABLED=false` already drops Scylla; a
  documented "small deployment" compose profile would make the rest of that
  choice explicit for self-hosters.
- **The `@roostorg/types` / `@roostorg/coop-types` duplication.** Two published
  packages with the same `date-fns` import and overlapping purpose both load at
  startup. Worth understanding before fixing #2.

## Systematizing this

The harness in [`perf/`](../../perf/README.md) has no dependencies beyond Node
and Docker. `perf/bin/run.sh` walks a server through cold start, idle, three load
scenarios, a soak and a settle phase, capturing OS-level samples, V8 heap detail,
handle counts, event-loop delay, container memory and load-generator results,
then writes a stable-ordered `summary.json` next to a readable `summary.md`.

`perf/bin/compare.mjs` diffs two runs and can fail a build on regression:

```bash
perf/bin/run.sh --run-id my-change --with-worker
node perf/bin/compare.mjs --base perf/results/baseline --head perf/results/my-change \
  --fail-on-regression --threshold-percent 10
```

Tracked metrics include boot time, idle and peak RSS, the soak RSS/heap slope,
throughput and p99 per scenario, container memory, and `node_modules` and image
sizes. `perf/results/baseline/` is the committed reference run.

## How to reproduce

```bash
npm run up
# see perf/README.md for org creation and fixture setup
perf/bin/run.sh --run-id my-run --with-worker
```

[`perf/README.md`](../../perf/README.md) documents each tool and — importantly —
the caveats that belong with any number quoted from it.
