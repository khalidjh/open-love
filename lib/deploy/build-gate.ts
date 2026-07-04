// =============================================================================
// Concurrency gate for full-stack build containers.
//
// A single `next build` container is capped at 2 GB (see ksa.ts). Deploys are
// user-triggered and can arrive at once, so without a limit N simultaneous
// builds would try to claim N × 2 GB and OOM the shared KSA VM. The control app
// is a single Node process, so an in-memory semaphore across requests is all we
// need: it caps how many build containers run at the same time and queues the
// rest FIFO. Runtime (`next start`) containers are ~75 MB and are NOT gated —
// only the memory-heavy build step is.
// =============================================================================

// Peak build memory ≈ MAX_CONCURRENT_BUILDS × 2 GB. Default 2 → ~4 GB peak,
// comfortably inside the VM's headroom. Override via env for a bigger box.
const MAX_CONCURRENT_BUILDS = Math.max(1, Number(process.env.KSA_MAX_CONCURRENT_BUILDS) || 2);

// How long a queued build waits for a slot before we give up and tell the user
// to retry, rather than letting the HTTP request hang indefinitely.
const QUEUE_TIMEOUT_MS = Math.max(60_000, Number(process.env.KSA_BUILD_QUEUE_TIMEOUT_MS) || 10 * 60 * 1000);

let active = 0;
const waiters: Array<{ resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_BUILDS) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = waiters.findIndex((w) => w.timer === timer);
      if (i !== -1) waiters.splice(i, 1);
      reject(new Error('The build queue is busy right now. Please try publishing again in a minute.'));
    }, QUEUE_TIMEOUT_MS);
    waiters.push({ resolve, reject, timer });
  });
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    // Slot stays claimed; hand it straight to the next waiter.
    next.resolve();
  } else {
    active = Math.max(0, active - 1);
  }
}

/**
 * Run `fn` while holding one of the limited build slots. Queues if all slots are
 * busy; rejects if no slot frees up within QUEUE_TIMEOUT_MS. The slot is always
 * released, even if `fn` throws.
 */
export async function withBuildSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
