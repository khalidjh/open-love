import { NextRequest } from 'next/server';
import { getProjectAiByTokenHash } from '@/lib/db/repos';
import { hashToken, transcribeProvider } from '@/lib/ai/provision-ai';

// Public speech-to-text endpoint for generated tenant apps.
//
// A generated voice app never holds a Whisper key. Its own server route posts the
// recorded audio here with the same per-project bearer token the chat proxy uses;
// this endpoint authenticates the token, forwards the audio to a Whisper-capable
// provider using the platform's server-side key, and returns { text }. Because
// tenant apps call this server-to-server, no CORS handling is needed.
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // audio transcription can take a few seconds

// Both providers expose an OpenAI-compatible /audio/transcriptions endpoint, so the
// forward logic is identical apart from URL + model + key.
const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3',
    keyEnv: 'GROQ_API_KEY',
  },
  openai: {
    url: `${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/audio/transcriptions`,
    model: 'whisper-1',
    keyEnv: 'OPENAI_API_KEY',
  },
} as const;

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return new Response('Missing bearer token', { status: 401 });
  }

  const record = await getProjectAiByTokenHash(hashToken(token));
  if (!record || record.status !== 'ready') {
    return new Response('Invalid or inactive AI token', { status: 401 });
  }

  const provider = transcribeProvider();
  if (!provider) {
    return Response.json(
      { error: 'Speech-to-text is not configured on this platform.' },
      { status: 501 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: 'Expected multipart/form-data with an audio file.' },
      { status: 400 },
    );
  }

  const file = form.get('file') || form.get('audio');
  if (!(file instanceof Blob)) {
    return Response.json({ error: 'Missing audio file (field "file").' }, { status: 400 });
  }

  const cfg = PROVIDERS[provider];
  const upstream = new FormData();
  upstream.append('file', file, (file as File).name || 'audio.webm');
  upstream.append('model', cfg.model);
  upstream.append('response_format', 'json');
  const language = form.get('language');
  if (typeof language === 'string' && language) upstream.append('language', language);

  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env[cfg.keyEnv]}` },
      body: upstream,
    });
  } catch (e) {
    console.error(`[ai-transcribe] project=${record.projectId} provider=${provider} fetch failed:`, e);
    return Response.json({ error: 'Transcription failed.' }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[ai-transcribe] project=${record.projectId} provider=${provider} upstream ${res.status}: ${detail}`);
    return Response.json({ error: 'Transcription failed.' }, { status: 502 });
  }

  const data = (await res.json().catch(() => ({}))) as { text?: string };
  console.log(`[ai-transcribe] project=${record.projectId} provider=${provider} ok chars=${(data.text || '').length}`);
  return Response.json({ text: data.text ?? '' });
}
