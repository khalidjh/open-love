import { NextRequest, NextResponse } from 'next/server';
import { requireProjectSession, toErrorResponse } from '@/lib/sandbox/require-project-session';
import { startGenerationJob } from '@/lib/generation/job-runner';
import { getLatestGenerationJob, updateGenerationJob, isJobStale } from '@/lib/db/repos';

export const dynamic = 'force-dynamic';

// POST /api/projects/:id/generate
// Start a background build (generate → provision → apply → snapshot) that runs
// entirely server-side and survives the browser closing. Returns the job id;
// the client follows progress on /generate/:jobId/stream.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireProjectSession(id);

    const body = await request.json().catch(() => ({}));
    const prompt: string = body.prompt;
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ success: false, error: 'prompt is required' }, { status: 400 });
    }

    // Refuse to stack builds: one running job per project at a time.
    const latest = await getLatestGenerationJob(id);
    if (latest && latest.status === 'running' && !isJobStale(latest)) {
      return NextResponse.json(
        { success: false, error: 'A build is already running for this project', jobId: latest.id },
        { status: 409 },
      );
    }

    // Base URL + auth cookie for the runner's internal self-calls — the same
    // pattern apply-ai-code-stream uses to call install-packages.
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const host = request.headers.get('host') || 'localhost:3000';

    const jobId = await startGenerationJob({
      orgId,
      projectId: id,
      prompt,
      model: typeof body.model === 'string' ? body.model : undefined,
      isEdit: Boolean(body.isEdit),
      context: body.context,
      images: Array.isArray(body.images) ? body.images : undefined,
      origin: `${protocol}://${host}`,
      cookie: request.headers.get('cookie') || '',
    });

    return NextResponse.json({ success: true, jobId });
  } catch (error) {
    return toErrorResponse(error);
  }
}

// GET /api/projects/:id/generate
// Latest job for this project — the reload/resume discovery path. A 'running'
// job whose heartbeat went stale (runner died with a server restart) is
// reported — and persisted — as failed.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireProjectSession(id);

    const job = await getLatestGenerationJob(id);
    if (!job) return NextResponse.json({ success: true, job: null });

    if (isJobStale(job)) {
      await updateGenerationJob(job.id, {
        status: 'failed',
        error: 'Build was interrupted by a server restart',
        finishedAt: new Date(),
      });
      job.status = 'failed';
      job.error = 'Build was interrupted by a server restart';
    }

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        phase: job.phase,
        prompt: job.prompt,
        isEdit: Boolean(job.isEdit),
        explanation: job.explanation,
        filesChanged: job.filesChanged || [],
        error: job.error,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
