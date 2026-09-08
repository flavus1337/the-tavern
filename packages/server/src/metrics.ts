import { monitorEventLoopDelay } from 'node:perf_hooks';
import { log } from './log.js';

type Duration = 'commandMs' | 'commitMs' | 'queueWaitMs';
type Counter = 'commands' | 'rejectedCommands' | 'commits' | 'failedCommits' | 'connections' | 'reconnectObservations';
const durations: Record<Duration, number[]> = { commandMs: [], commitMs: [], queueWaitMs: [] };
const counters: Record<Counter, number> = { commands: 0, rejectedCommands: 0, commits: 0, failedCommits: 0, connections: 0, reconnectObservations: 0 };
const disconnected = new Map<string, number>();
let queueDepth = 0, peakQueueDepth = 0;

export function count(name: Counter): void { counters[name]++; }
export function duration(name: Duration, ms: number): void {
  const samples = durations[name];
  if (samples.length === 512) samples.shift();
  samples.push(ms);
}
export function changeQueueDepth(delta: 1 | -1): void {
  queueDepth += delta;
  peakQueueDepth = Math.max(peakQueueDepth, queueDepth);
}
export function recordDisconnect(userId: string): void {
  disconnected.delete(userId);
  disconnected.set(userId, Date.now());
  if (disconnected.size > 256) disconnected.delete(disconnected.keys().next().value!);
}
export function recordConnection(userId: string): void {
  count('connections');
  const previous = disconnected.get(userId);
  if (previous !== undefined && Date.now() - previous < 300_000) count('reconnectObservations');
  disconnected.delete(userId);
}

/** Fixed metric names and at most 512 recent samples per duration; no identity labels. */
export function metricsSnapshot(reset = false) {
  const result = {
    ...counters, queueDepth, peakQueueDepth,
    durations: Object.fromEntries(Object.entries(durations).map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [name, { samples: sorted.length, p50: sorted[Math.floor(sorted.length / 2)] ?? 0, p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0, max: sorted.at(-1) ?? 0 }];
    })),
  };
  if (reset) {
    for (const name of Object.keys(counters) as Counter[]) counters[name] = 0;
    for (const values of Object.values(durations)) values.length = 0;
    peakQueueDepth = queueDepth;
  }
  return result;
}

/** One local aggregate per minute plus shutdown. Reconnects are observations of
 * a new socket within five minutes of a disconnect, not a distinct-user count. */
export function startMetrics(): () => void {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const report = () => {
    log.info(`Local metrics ${JSON.stringify({ ...metricsSnapshot(true), eventLoopMs: { p95: loop.percentile(95) / 1e6, max: loop.max / 1e6 } })}`);
    loop.reset();
  };
  const timer = setInterval(report, 60_000);
  timer.unref();
  return () => { clearInterval(timer); loop.disable(); report(); };
}
