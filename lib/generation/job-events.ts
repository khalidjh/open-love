// =============================================================================
// In-memory event bus for background generation jobs.
//
// The job runner (lib/generation/job-runner.ts) publishes every progress event
// here; any number of SSE subscribers (the generation page, possibly re-opened
// after a tab close) replay the backlog from a sequence number and then follow
// live. Events are process-local — the durable record lives in the
// generation_jobs table — so a server restart drops the live feed, and the
// stream route falls back to reporting the job's DB state.
//
// Pinned to globalThis so Next.js dev HMR doesn't drop live jobs (same trick as
// lib/sandbox/session-store.ts).
// =============================================================================

export interface JobEvent {
  seq: number;
  // The runner wraps upstream SSE payloads with a stage discriminator:
  //  - stage 'generate' → events from /api/generate-ai-code-stream
  //  - stage 'apply'    → events from /api/apply-ai-code-stream
  //  - stage 'job'      → runner-level events (phase, provisioning, done, failed)
  data: Record<string, unknown> & { stage: 'generate' | 'apply' | 'job'; type: string };
}

interface JobChannel {
  events: JobEvent[];
  subscribers: Set<(event: JobEvent) => void>;
  done: boolean;
  nextSeq: number;
  // Set when the job finishes; the channel is dropped after RETENTION_MS so a
  // just-reconnected client can still replay the tail of a completed build.
  finishedAt: number | null;
}

// How long a finished job's events stay replayable.
const RETENTION_MS = 5 * 60 * 1000;

type Bus = Map<string, JobChannel>;
const g = globalThis as unknown as { __etlaqGenerationJobBus?: Bus };
const bus: Bus = g.__etlaqGenerationJobBus ?? (g.__etlaqGenerationJobBus = new Map());

function sweep(): void {
  const now = Date.now();
  for (const [jobId, ch] of bus) {
    if (ch.done && ch.finishedAt !== null && now - ch.finishedAt > RETENTION_MS) {
      bus.delete(jobId);
    }
  }
}

export function openJobChannel(jobId: string): void {
  sweep();
  if (!bus.has(jobId)) {
    bus.set(jobId, { events: [], subscribers: new Set(), done: false, nextSeq: 0, finishedAt: null });
  }
}

export function hasJobChannel(jobId: string): boolean {
  return bus.has(jobId);
}

export function isJobChannelDone(jobId: string): boolean {
  return bus.get(jobId)?.done ?? true;
}

export function publishJobEvent(jobId: string, data: JobEvent['data']): void {
  const ch = bus.get(jobId);
  if (!ch || ch.done) return;
  const event: JobEvent = { seq: ch.nextSeq++, data };
  ch.events.push(event);
  for (const fn of ch.subscribers) {
    try {
      fn(event);
    } catch {
      // A broken subscriber must never take down the runner.
    }
  }
}

// Mark the job's stream finished. Publish the terminal event BEFORE calling this.
export function finishJobChannel(jobId: string): void {
  const ch = bus.get(jobId);
  if (!ch) return;
  ch.done = true;
  ch.finishedAt = Date.now();
  ch.subscribers.clear();
  sweep();
}

// Replay the backlog after `since` (exclusive; pass -1 for everything), then
// follow live. Returns an unsubscribe function; `onDone` fires when the channel
// is already finished (after replay) — live completion is signaled by the
// runner's terminal 'job' event instead.
export function subscribeJobEvents(
  jobId: string,
  since: number,
  onEvent: (event: JobEvent) => void,
  onDone: () => void,
): (() => void) | null {
  const ch = bus.get(jobId);
  if (!ch) return null;

  for (const event of ch.events) {
    if (event.seq > since) onEvent(event);
  }
  if (ch.done) {
    onDone();
    return () => {};
  }
  ch.subscribers.add(onEvent);
  return () => ch.subscribers.delete(onEvent);
}
