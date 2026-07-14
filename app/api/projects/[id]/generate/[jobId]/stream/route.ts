import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireProjectSession, toErrorResponse } from '@/lib/sandbox/require-project-session';
import { getGenerationJob, updateGenerationJob } from '@/lib/db/repos';
import { subscribeJobEvents, hasJobChannel } from '@/lib/generation/job-events';
import type { JobEvent } from '@/lib/generation/job-events';

export const dynamic = 'force-dynamic';

// GET /api/projects/:id/generate/:jobId/stream?since=N
// SSE feed for a background build: replays the event backlog after `since`
// (so a reloaded page catches up mid-build), then follows live. Closing this
// stream does NOT affect the build — the runner is fully detached from it.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  try {
    const { id, jobId } = await params;
    await requireProjectSession(id);

    const job = await getGenerationJob(id, jobId);
    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    const since = Number(request.nextUrl.searchParams.get('since') ?? -1);
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    let unsubscribe: (() => void) | null = null;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      try {
        await writer.close();
      } catch {
        // Already closed by the client going away.
      }
    };

    const send = async (payload: Record<string, unknown>) => {
      if (closed) return;
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      } catch {
        // Client disconnected — stop feeding it. The build itself keeps going.
        await close();
      }
    };

    // Stop writing when the client goes away (the runner is unaffected).
    request.signal.addEventListener('abort', () => void close());

    const onEvent = (event: JobEvent) => {
      void send({ seq: event.seq, ...event.data });
      // Terminal runner events end the stream.
      const type = event.data.type;
      if (event.data.stage === 'job' && (type === 'done' || type === 'failed')) {
        void close();
      }
    };

    if (hasJobChannel(jobId)) {
      unsubscribe = subscribeJobEvents(jobId, Number.isFinite(since) ? since : -1, onEvent, () => {
        // Channel already finished — the replayed backlog included the terminal
        // event, so onEvent has closed (or will close) the stream.
        void close();
      });
    } else {
      // No live channel: the job predates a server restart or its retention
      // window passed. Report its durable state as a single terminal event.
      if (job.status === 'running') {
        // The in-process runner is gone — whether or not the heartbeat is stale
        // yet, this build can never finish. Persist the failure.
        await updateGenerationJob(jobId, {
          status: 'failed',
          error: 'Build was interrupted by a server restart',
          finishedAt: new Date(),
        });
        await send({ seq: -1, stage: 'job', type: 'failed', error: 'Build was interrupted by a server restart' });
      } else if (job.status === 'failed') {
        await send({ seq: -1, stage: 'job', type: 'failed', error: job.error || 'Build failed' });
      } else {
        await send({
          seq: -1,
          stage: 'job',
          type: 'done',
          explanation: job.explanation || '',
          filesChanged: job.filesChanged || [],
        });
      }
      await close();
    }

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
