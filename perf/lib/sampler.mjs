#!/usr/bin/env node
// Samples OS-level resource usage for a process tree and/or docker containers
// and appends one JSON object per sample to a JSONL file.
//
// Usage:
//   node perf/lib/sampler.mjs --pid 1234[,5678] [--containers coop-postgres-1,...]
//     --out samples.jsonl [--interval-ms 1000] [--duration-s 60] [--label idle]
//
// Each --pid is treated as the root of a process tree; descendants are followed.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CLOCK_TICK = 100; // Linux USER_HZ; /proc/<pid>/stat times are in ticks.

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

function readFileOrNull(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function descendantPids(rootPid) {
  const pids = [rootPid];
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift();
    const children = readFileOrNull(`/proc/${pid}/task/${pid}/children`);
    if (!children) continue;
    for (const child of children.trim().split(/\s+/).filter(Boolean)) {
      const childPid = Number(child);
      if (!pids.includes(childPid)) {
        pids.push(childPid);
        queue.push(childPid);
      }
    }
  }
  return pids;
}

function sampleProcess(pid) {
  const status = readFileOrNull(`/proc/${pid}/status`);
  if (status === null) return null;

  const field = (name) => {
    const match = status.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'));
    return match ? Number(match[1]) : null;
  };

  const stat = readFileOrNull(`/proc/${pid}/stat`) ?? '';
  // Skip past comm, which may itself contain spaces and parens.
  const statFields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const utimeTicks = Number(statFields[11] ?? 0);
  const stimeTicks = Number(statFields[12] ?? 0);

  const rollup = readFileOrNull(`/proc/${pid}/smaps_rollup`) ?? '';
  const pssMatch = rollup.match(/^Pss:\s+(\d+)/m);

  const io = readFileOrNull(`/proc/${pid}/io`) ?? '';
  const ioField = (name) => {
    const match = io.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'));
    return match ? Number(match[1]) : null;
  };

  let fds = null;
  try {
    fds = fs.readdirSync(`/proc/${pid}/fd`).length;
  } catch {
    /* process may have exited, or we may lack permission */
  }

  return {
    pid,
    cmd: (readFileOrNull(`/proc/${pid}/cmdline`) ?? '')
      .replaceAll('\0', ' ')
      .trim()
      .slice(0, 240),
    rssKb: field('VmRSS'),
    pssKb: pssMatch ? Number(pssMatch[1]) : null,
    vszKb: field('VmSize'),
    peakRssKb: field('VmHWM'),
    threads: field('Threads'),
    fds,
    cpuSeconds: (utimeTicks + stimeTicks) / CLOCK_TICK,
    ioReadBytes: ioField('read_bytes'),
    ioWriteBytes: ioField('write_bytes'),
  };
}

// `docker stats` talks to the daemon and can take seconds (or time out) while
// the host is under load — exactly when we are sampling. Never let that abort a
// run: a missed container sample is worth far less than the rest of the data.
async function sampleContainers(names) {
  if (names.length === 0) return [];
  const format =
    '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}\t{{.BlockIO}}\t{{.NetIO}}';
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'docker',
      ['stats', '--no-stream', '--format', format, ...names],
      { timeout: 20_000 },
    ));
  } catch {
    return [];
  }
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, cpuPerc, memUsage, pids, blockIo, netIo] = line.split('\t');
      const memMatch = memUsage.match(/^([\d.]+)([A-Za-z]+)/);
      const toMib = (value, unit) => {
        const scale = { B: 1 / 2 ** 20, KiB: 1 / 1024, MiB: 1, GiB: 1024 };
        return Math.round(value * (scale[unit] ?? 1) * 100) / 100;
      };
      return {
        name,
        cpuPercent: Number(cpuPerc.replace('%', '')),
        memMib: memMatch ? toMib(Number(memMatch[1]), memMatch[2]) : null,
        pids: Number(pids),
        blockIo,
        netIo,
      };
    });
}

function systemSample() {
  const meminfo = readFileOrNull('/proc/meminfo') ?? '';
  const meminfoField = (name) => {
    const match = meminfo.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'));
    return match ? Number(match[1]) : null;
  };
  const loadavg = (readFileOrNull('/proc/loadavg') ?? '').split(' ');
  return {
    memTotalKb: meminfoField('MemTotal'),
    memAvailableKb: meminfoField('MemAvailable'),
    loadAvg1: Number(loadavg[0] ?? 0),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const intervalMs = Number(args['interval-ms'] ?? 1000);
  const durationS = args['duration-s'] ? Number(args['duration-s']) : null;
  const out = args.out ?? 'samples.jsonl';
  const label = args.label ?? 'default';
  const rootPids = args.pid
    ? String(args.pid)
        .split(',')
        .map((it) => Number(it.trim()))
        .filter((it) => Number.isFinite(it))
    : [];
  const containers = args.containers ? String(args.containers).split(',') : [];

  // Container stats are expensive to collect, so take them on a slower cadence
  // than process stats rather than on every tick.
  const containerEveryMs = Number(args['container-interval-ms'] ?? 5000);

  const stream = fs.createWriteStream(out, { flags: 'a' });
  const startedAt = Date.now();
  let lastContainerSampleAt = 0;
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    const pids = [...new Set(rootPids.flatMap(descendantPids))];
    const processes = pids.map(sampleProcess).filter((it) => it !== null);
    const dueForContainers =
      Date.now() - lastContainerSampleAt >= containerEveryMs;
    if (dueForContainers) lastContainerSampleAt = Date.now();
    const sample = {
      ts: Date.now(),
      elapsedS: Math.round((Date.now() - startedAt) / 100) / 10,
      label,
      system: systemSample(),
      processes,
      containers: dueForContainers ? await sampleContainers(containers) : [],
    };
    stream.write(`${JSON.stringify(sample)}\n`);

    if (rootPids.length > 0 && processes.length === 0) break;
    if (durationS !== null && (Date.now() - startedAt) / 1000 >= durationS) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  await new Promise((resolve) => stream.end(resolve));
}

await main();
