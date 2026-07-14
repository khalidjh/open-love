/**
 * End-to-end test of the background build runner with NO client attached —
 * the closed-tab condition. Real local Postgres; mock origin server stands in
 * for the model (generate), sandbox apply, and file listing.
 *
 * Asserts:
 *  1. job row goes running → completed with phase 'done'
 *  2. a project_versions snapshot row was saved
 *  3. chat messages (user/build/ai/system) were appended
 *  4. the in-memory event bus recorded the full staged event sequence
 */
import http from 'node:http';
import { db } from '@/lib/db/index';
import { orgs, projects, generationJobs, projectVersions, messages } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { startGenerationJob } from '@/lib/generation/job-runner';
import { subscribeJobEvents } from '@/lib/generation/job-events';

const PORT = 4599;

const GENERATED = `Building your guestbook app now!
<file path="src/App.jsx">
export default function App() { return <h1>Guestbook</h1>; }
</file>
<explanation>A simple guestbook app.</explanation>`;

function sse(res: http.ServerResponse, events: object[], delayMs = 30): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (i >= events.length) { res.end(); resolve(); return; }
      res.write(`data: ${JSON.stringify(events[i++])}\n\n`);
      setTimeout(tick, delayMs);
    };
    tick();
  });
}

// FAIL_MODE=1 makes generation emit a model error — asserts the job fails cleanly.
const FAIL_MODE = process.env.FAIL_MODE === '1';

const server = http.createServer(async (req, res) => {
  console.log('[mock]', req.method, req.url);
  if (req.url === '/api/generate-ai-code-stream') {
    if (FAIL_MODE) {
      await sse(res, [
        { type: 'status', message: 'Initializing AI...' },
        { type: 'error', error: 'model exploded (mock)' },
      ]);
      return;
    }
    await sse(res, [
      { type: 'status', message: 'Initializing AI...' },
      { type: 'thinking', text: 'Planning the app...' },
      { type: 'thinking_complete', duration: 1 },
      { type: 'stream', raw: true, text: GENERATED.slice(0, 60) },
      { type: 'stream', raw: true, text: GENERATED.slice(60) },
      { type: 'complete', generatedCode: GENERATED, explanation: 'A simple guestbook app.', packagesToInstall: [] },
    ]);
  } else if (req.url === '/api/apply-ai-code-stream') {
    await sse(res, [
      { type: 'start', message: 'Starting code application...', totalSteps: 3 },
      { type: 'step', step: 2, message: 'Creating 1 files...' },
      { type: 'file-complete', fileName: 'src/App.jsx', action: 'created' },
      { type: 'complete', results: { filesCreated: ['src/App.jsx'], filesUpdated: [], errors: [] }, explanation: 'A simple guestbook app.' },
    ]);
  } else if (req.url?.startsWith('/api/get-sandbox-files')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, files: { 'src/App.jsx': 'export default function App() { return <h1>Guestbook</h1>; }' } }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'unexpected call: ' + req.url }));
  }
});

async function main() {
  await new Promise<void>((r) => server.listen(PORT, r));

  // Seed org + project directly (no auth involved — runner trusts its caller).
  const [org] = await db.insert(orgs).values({ name: 'e2e-test-org' }).returning();
  const [project] = await db.insert(projects).values({ orgId: org.id, name: 'e2e guestbook' }).returning();

  const jobId = await startGenerationJob({
    orgId: org.id,
    projectId: project.id,
    prompt: 'Build a guestbook app',
    isEdit: false,
    context: {},
    origin: `http://127.0.0.1:${PORT}`,
    cookie: '',
  });
  console.log('[test] job started:', jobId);

  // Record bus events (as a monitoring tap — the runner must not need it).
  const seen: string[] = [];
  subscribeJobEvents(jobId, -1, (e) => seen.push(`${e.data.stage}:${e.data.type}`), () => {});

  // NO client stays attached; just poll the DB like a fresh page-load would.
  let job: typeof generationJobs.$inferSelect | undefined;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    job = await db.query.generationJobs.findFirst({ where: eq(generationJobs.id, jobId) });
    if (job && job.status !== 'running') break;
  }

  const version = await db.query.projectVersions.findFirst({
    where: eq(projectVersions.projectId, project.id),
    orderBy: desc(projectVersions.createdAt),
  });
  const msgs = await db.select().from(messages).where(eq(messages.projectId, project.id)).orderBy(messages.seq);

  console.log('\n[test] job status:', job?.status, '| phase:', job?.phase, '| error:', job?.error);
  console.log('[test] explanation:', job?.explanation);
  console.log('[test] filesChanged:', JSON.stringify(job?.filesChanged));
  console.log('[test] snapshot files:', version ? Object.keys(version.files) : null);
  console.log('[test] messages:', msgs.map((m) => `${m.role}: ${m.content.slice(0, 50)}`));
  console.log('[test] bus events:', seen.join(' '));

  const failures: string[] = [];
  if (FAIL_MODE) {
    if (job?.status !== 'failed') failures.push(`job status = ${job?.status} (want failed)`);
    if (!job?.error?.includes('model exploded')) failures.push(`job error = ${job?.error}`);
    if (!seen.includes('job:failed')) failures.push('bus missing job:failed');
    await db.delete(orgs).where(eq(orgs.id, org.id));
    server.close();
    if (failures.length) { console.error('\n[test] FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
    console.log('\n[test] PASSED: generation error fails the job cleanly.');
    process.exit(0);
  }
  if (job?.status !== 'completed') failures.push(`job status = ${job?.status} (want completed)`);
  if (job?.phase !== 'done') failures.push(`job phase = ${job?.phase} (want done)`);
  if (!version || !version.files['src/App.jsx']) failures.push('no project_versions snapshot with src/App.jsx');
  if (!msgs.some((m) => m.role === 'user' && m.content === 'Build a guestbook app')) failures.push('user message not appended');
  if (!msgs.some((m) => m.role === 'ai')) failures.push('ai message not appended');
  if (!msgs.some((m) => m.role === 'build')) failures.push('build message not appended');
  if (!seen.includes('generate:complete')) failures.push('bus missing generate:complete');
  if (!seen.includes('apply:complete')) failures.push('bus missing apply:complete');
  if (!seen.includes('job:done')) failures.push('bus missing job:done');

  // Cleanup seeded data.
  await db.delete(orgs).where(eq(orgs.id, org.id));
  server.close();

  if (failures.length) {
    console.error('\n[test] FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('\n[test] PASSED: build ran to completion with no client attached.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
