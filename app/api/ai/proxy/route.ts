import { NextRequest } from 'next/server';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { getProjectAiByTokenHash } from '@/lib/db/repos';
import { hashToken, DEFAULT_AI_MODEL } from '@/lib/ai/provision-ai';

// Public AI proxy for generated tenant apps.
//
// A generated app never holds the platform's model key. Its own server route
// (app/api/chat) sends the chat here with a per-project bearer token; this proxy
// authenticates the token, then forwards to the Vercel AI Gateway using the
// platform key (server-side only) and streams plain text back. Because tenant
// apps call this server-to-server, no CORS handling is needed.
export const dynamic = 'force-dynamic';

// OpenAI-compatible client pointed at the AI Gateway. Model ids are `provider/model`
// slugs (e.g. anthropic/claude-haiku-4-5-...). Same gateway the codegen uses.
const gateway = createOpenAI({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: 'https://ai-gateway.vercel.sh/v1',
});

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response('Body must include a non-empty messages array', { status: 400 });
  }

  const model = record.model || DEFAULT_AI_MODEL;
  console.log(`[ai-proxy] project=${record.projectId} model=${model} messages=${messages.length}`);

  const result = streamText({
    model: gateway(model),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: messages as any,
    // v1 metering: log token usage per project. Enforced quotas come later.
    onFinish: ({ usage }) => {
      console.log(`[ai-proxy] project=${record.projectId} usage`, usage);
    },
  });

  return result.toTextStreamResponse();
}
