import { NextResponse } from 'next/server';
import { ensureActiveSandbox } from '@/lib/sandbox/ensure-active-sandbox';

// POST /api/ensure-sandbox
// Guarantees a live sandbox for the current session, transparently rebuilding
// and replaying the generated files if the previous one was reaped (E2B TTL).
// Returns the (possibly new) sandbox URL so the client can reload the preview.
export async function POST() {
  try {
    const result = await ensureActiveSandbox();
    return NextResponse.json({
      success: true,
      sandboxData: result.sandboxData,
      recreated: result.recreated,
    });
  } catch (error) {
    console.error('[ensure-sandbox] Error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
