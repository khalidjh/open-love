// Minimal Docker Engine API client over the unix socket. The control app
// drives the host's Docker to build/run tenant Next.js apps — no docker CLI
// and no npm dependency, just the REST API over /var/run/docker.sock.

import http from 'http';

const DOCKER_SOCK = process.env.DOCKER_SOCK || '/var/run/docker.sock';

export class DockerError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function request(
  method: string,
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; raw?: boolean } = {}
): Promise<{ status: number; body: any; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: DOCKER_SOCK,
        method,
        path,
        headers: {
          Host: 'docker',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          let parsed: any;
          if (!opts.raw) {
            try { parsed = JSON.parse(buffer.toString('utf8')); } catch { parsed = undefined; }
          }
          resolve({ status: res.statusCode || 0, body: parsed, buffer });
        });
      }
    );
    req.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT' || e.code === 'EACCES') {
        reject(new DockerError(0, `Docker socket unavailable at ${DOCKER_SOCK} — is it mounted into this container?`));
      } else {
        reject(e);
      }
    });
    req.setTimeout(opts.timeoutMs ?? 30_000, () => req.destroy(new Error(`Docker API timeout: ${method} ${path}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

async function api(method: string, path: string, body?: unknown, opts: { timeoutMs?: number } = {}) {
  const res = await request(method, path, body, opts);
  if (res.status >= 400) {
    throw new DockerError(res.status, res.body?.message || `Docker API ${res.status} on ${method} ${path}`);
  }
  return res.body;
}

// Docker log streams are multiplexed: 8-byte frame headers (stream type + BE32
// length) between payloads. Strip them so we can show build output as text.
function demuxLogs(buffer: Buffer): string {
  let out = '';
  let i = 0;
  while (i + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(i + 4);
    out += buffer.subarray(i + 8, i + 8 + len).toString('utf8');
    i += 8 + len;
  }
  // TTY containers have no framing; fall back to the raw text.
  return out || buffer.toString('utf8');
}

export async function inspectContainer(name: string): Promise<any | null> {
  try {
    return await api('GET', `/containers/${encodeURIComponent(name)}/json`);
  } catch (e) {
    if (e instanceof DockerError && e.status === 404) return null;
    throw e;
  }
}

export async function removeContainer(name: string): Promise<void> {
  try {
    await api('DELETE', `/containers/${encodeURIComponent(name)}?force=true`);
  } catch (e) {
    if (e instanceof DockerError && e.status === 404) return;
    throw e;
  }
}

export async function ensureImage(image: string): Promise<void> {
  try {
    await api('GET', `/images/${encodeURIComponent(image)}/json`);
    return;
  } catch (e) {
    if (!(e instanceof DockerError && e.status === 404)) throw e;
  }
  const [name, tag = 'latest'] = image.split(':');
  // Pull streams progress JSON until done; we only care that it finishes.
  const res = await request('POST', `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`, undefined, {
    timeoutMs: 300_000,
    raw: true,
  });
  if (res.status >= 400) throw new DockerError(res.status, `Failed to pull ${image}`);
}

export async function createAndStart(name: string, config: Record<string, unknown>): Promise<string> {
  await removeContainer(name);
  const created = await api('POST', `/containers/create?name=${encodeURIComponent(name)}`, config);
  await api('POST', `/containers/${created.Id}/start`);
  return created.Id as string;
}

// Run a container to completion; returns exit code and its logs.
export async function runToCompletion(
  name: string,
  config: Record<string, unknown>,
  timeoutMs: number
): Promise<{ exitCode: number; logs: string }> {
  const id = await createAndStart(name, config);
  try {
    const waited = await api('POST', `/containers/${id}/wait?condition=not-running`, undefined, { timeoutMs });
    const logsRes = await request('GET', `/containers/${id}/logs?stdout=1&stderr=1&tail=200`, undefined, { raw: true });
    return { exitCode: waited.StatusCode ?? 1, logs: demuxLogs(logsRes.buffer) };
  } finally {
    await removeContainer(name).catch(() => {});
  }
}

// HTTP-probe a container from the inside (the control app itself may not share
// a network with it). Any HTTP response — even a 500 — means the server is up.
export async function probeContainerHttp(name: string, port: number, attempts = 30, delayMs = 2000): Promise<boolean> {
  const script = `fetch('http://127.0.0.1:${port}/').then(()=>process.exit(0)).catch(()=>process.exit(1))`;
  for (let i = 0; i < attempts; i++) {
    const info = await inspectContainer(name);
    if (!info?.State?.Running) return false;
    try {
      const exec = await api('POST', `/containers/${encodeURIComponent(name)}/exec`, {
        AttachStdout: true,
        AttachStderr: true,
        Cmd: ['node', '-e', script],
      });
      await request('POST', `/exec/${exec.Id}/start`, { Detach: false }, { raw: true, timeoutMs: 15_000 });
      const done = await api('GET', `/exec/${exec.Id}/json`);
      if (done.ExitCode === 0) return true;
    } catch { /* container mid-start; retry */ }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

// Host ports already bound by other containers (any state) — for allocation.
export async function usedHostPorts(): Promise<Set<number>> {
  const list = await api('GET', '/containers/json?all=true');
  const used = new Set<number>();
  for (const c of list || []) {
    for (const p of c.Ports || []) {
      if (p.PublicPort) used.add(p.PublicPort);
    }
  }
  return used;
}

export async function containerLogs(name: string, tail = 100): Promise<string> {
  const res = await request('GET', `/containers/${encodeURIComponent(name)}/logs?stdout=1&stderr=1&tail=${tail}`, undefined, { raw: true });
  return demuxLogs(res.buffer);
}
