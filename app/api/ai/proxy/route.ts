import { NextRequest } from 'next/server';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, type LanguageModel } from 'ai';
import { getProjectAiByTokenHash } from '@/lib/db/repos';
import { hashToken, DEFAULT_AI_MODEL } from '@/lib/ai/provision-ai';

// Public AI proxy for generated tenant apps.
//
// A generated app never holds the platform's model key. Its own server route
// (app/api/chat) sends the chat here with a per-project bearer token; this proxy
// authenticates the token, then forwards to the model using the platform's keys
// (server-side only) and streams plain text back. Because tenant apps call this
// server-to-server, no CORS handling is needed.
export const dynamic = 'force-dynamic';

// Same gateway-or-direct fallback the codegen route uses: prefer the Vercel AI
// Gateway when AI_GATEWAY_API_KEY is set, else use direct provider keys.
const isUsingAIGateway = !!process.env.AI_GATEWAY_API_KEY;
const aiGatewayBaseURL = 'https://ai-gateway.vercel.sh/v1';

const anthropic = createAnthropic({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.ANTHROPIC_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1'),
});
const openai = createOpenAI({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : process.env.OPENAI_BASE_URL,
});
const groq = createGroq({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.GROQ_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : undefined,
});
const google = createGoogleGenerativeAI({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.GEMINI_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : undefined,
});
const zai = createOpenAI({
  apiKey: process.env.ZAI_API_KEY,
  baseURL: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4',
});

// Map a `provider/model` slug to the right client. Prefix is stripped to the
// provider-native id (the provider client handles gateway vs direct routing).
function resolveModel(slug: string): LanguageModel {
  if (slug.startsWith('anthropic/')) return anthropic(slug.replace('anthropic/', ''));
  if (slug.startsWith('openai/')) return openai(slug.replace('openai/', ''));
  if (slug.startsWith('google/')) return google(slug.replace('google/', ''));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (slug.startsWith('zai/')) return (zai as any).chat(slug.replace('zai/', ''));
  return groq(slug); // bare id / groq fallback
}

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

  const modelSlug = record.model || DEFAULT_AI_MODEL;
  console.log(`[ai-proxy] project=${record.projectId} model=${modelSlug} messages=${messages.length}`);

  const result = streamText({
    model: resolveModel(modelSlug),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: messages as any,
    // v1 metering: log token usage per project. Enforced quotas come later.
    onFinish: ({ usage }) => {
      console.log(`[ai-proxy] project=${record.projectId} usage`, usage);
    },
  });

  return result.toTextStreamResponse();
}
