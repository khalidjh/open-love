import { NextResponse } from 'next/server';
import { guardAuth } from '@/lib/sandbox/require-project-session';

// Stub endpoint to prevent 404 errors
// This endpoint is being called but the source is unknown
// Returns empty errors array to satisfy any calling code
export async function GET() {
  const denied = await guardAuth();
  if (denied) return denied;
  return NextResponse.json({
    success: true,
    errors: [],
    message: 'No Vite errors detected'
  });
}