import { NextRequest, NextResponse } from 'next/server';
import { createGroq } from '@ai-sdk/groq';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';
import { appConfig } from '@/config/app.config';

// Force dynamic route to enable streaming
export const dynamic = 'force-dynamic';

// This route is a lightweight *conversational* companion to the code generator.
// It decides whether the user's message is something to BUILD (in which case it
// tells the client to hand off to /api/generate-ai-code-stream) or a plain
// QUESTION/chat it should answer in warm, non-technical language — no code.

const isUsingAIGateway = !!process.env.AI_GATEWAY_API_KEY;
const aiGatewayBaseURL = 'https://ai-gateway.vercel.sh/v1';

const groq = createGroq({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.GROQ_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : undefined,
});
const anthropic = createAnthropic({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.ANTHROPIC_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1'),
});
const googleGenerativeAI = createGoogleGenerativeAI({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.GEMINI_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : undefined,
});
const openai = createOpenAI({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : process.env.OPENAI_BASE_URL,
});
const zai = createOpenAI({
  apiKey: process.env.ZAI_API_KEY,
  baseURL: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4',
});

function resolveModel(model: string) {
  const isAnthropic = model.startsWith('anthropic/');
  const isGoogle = model.startsWith('google/');
  const isOpenAI = model.startsWith('openai/');
  const isZai = model.startsWith('zai/');
  const isKimiGroq = model === 'moonshotai/kimi-k2-instruct-0905';
  const provider = isAnthropic ? anthropic : (isOpenAI ? openai : (isGoogle ? googleGenerativeAI : (isZai ? zai : groq)));

  let actualModel = model;
  if (isAnthropic) actualModel = model.replace('anthropic/', '');
  else if (isOpenAI) actualModel = model.replace('openai/', '');
  else if (isZai) actualModel = model.replace('zai/', '');
  else if (isGoogle) actualModel = model.replace('google/', '');
  else if (isKimiGroq) actualModel = 'moonshotai/kimi-k2-instruct-0905';

  // Z.AI only supports the Chat Completions API, not the newer Responses API.
  const languageModel = isZai ? (zai as any).chat(actualModel) : provider(actualModel);
  return { languageModel, isOpenAI };
}

interface ChatBody {
  prompt: string;
  model?: string;
  hasApp?: boolean;
  firstPrompt?: string;
  recentMessages?: Array<{ type: string; content: string }>;
}

export async function POST(request: NextRequest) {
  let body: ChatBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { prompt, model = appConfig.ai.defaultModel, hasApp = false, firstPrompt, recentMessages = [] } = body;
  if (!prompt || !prompt.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  const transcript = recentMessages
    .filter((m) => m.type === 'user' || m.type === 'ai')
    .slice(-8)
    .map((m) => `${m.type === 'user' ? 'User' : 'You'}: ${(m.content || '').slice(0, 500)}`)
    .join('\n');

  const systemPrompt = `You are Etlaq, a warm, friendly assistant that helps a NON-TECHNICAL person build and improve their web app just by chatting in plain language.

Every user message is one of exactly two kinds. Decide which, then respond accordingly:

1. A BUILD REQUEST — the user wants you to create, add, change, remove, fix, restyle, rearrange, or otherwise MODIFY their app. Examples: "build a todo app", "make the header blue", "add a login page", "remove the footer", "the button is broken, fix it", "make it look more modern", "put my logo at the top".
   → Respond with EXACTLY this token and NOTHING else: <build/>
   → No greeting, no explanation, no other characters. The app builder will take over from here and do the work.

2. A QUESTION or CONVERSATION — the user is asking how something works, what's possible, for advice or a recommendation, or making small talk. Examples: "how do I start collecting payments?", "is my app mobile friendly?", "what can you do?", "who are you?", "should I add a contact form?", "thanks!".
   → Answer conversationally: warm, encouraging, and in PLAIN language a non-developer understands. 2 to 5 short sentences.
   → NEVER use code, file names, or technical jargon (avoid words like component, API, endpoint, deploy, repository, database schema, prop, state). Speak about what the app *does* for real people.
   → If your answer describes something you could actually do to their app, END with a simple offer phrased as a question, e.g. "Want me to add that for you?" — so that if they say yes, their next message becomes a build request.
   → A conversational reply must NEVER begin with the "<" character.

Rules:
- When a message clearly instructs you to change or create something in the app, ALWAYS treat it as a BUILD REQUEST (option 1), even if it is phrased politely.
- When in doubt between the two, and the message is an instruction to change the app, choose BUILD. If it is genuinely a question seeking information, choose CONVERSATION.
- Output ONLY one of the two forms. Never mix them.

Context about the user's app:
- The user ${hasApp ? 'already has an app you have been building together' : 'has not built anything yet'}.${firstPrompt ? `\n- Their original request was: "${firstPrompt.slice(0, 300)}"` : ''}${transcript ? `\n\nRecent conversation:\n${transcript}` : ''}`;

  const { languageModel, isOpenAI } = resolveModel(model);

  const streamOptions: any = {
    model: languageModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    maxTokens: 700,
  };
  if (!model.startsWith('openai/gpt-5')) streamOptions.temperature = 0.6;
  if (isOpenAI) streamOptions.experimental_providerMetadata = { openai: { reasoningEffort: 'low' } };

  const encoder = new TextEncoder();
  const tstream = new TransformStream();
  const writer = tstream.writable.getWriter();

  const send = async (data: any) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      /* client disconnected */
    }
  };

  (async () => {
    try {
      const result = await streamText(streamOptions);

      // First non-whitespace character decides the branch: a build signal always
      // starts with "<" (it is "<build/>"), and a conversational reply is forbidden
      // from ever starting with "<". So we buffer only until we see that first
      // real character, then commit — no risk of leaking a partial "<build/>".
      let decided = false;
      let mode: 'build' | 'chat' | null = null;
      let lead = '';

      for await (const part of result.textStream) {
        const text = part || '';
        if (!decided) {
          lead += text;
          const trimmed = lead.trimStart();
          if (trimmed.length === 0) continue; // still only whitespace
          if (trimmed[0] === '<') {
            decided = true;
            mode = 'build';
            await send({ type: 'route', mode: 'build' });
            break; // stop reading — the client hands off to the generator
          }
          decided = true;
          mode = 'chat';
          await send({ type: 'delta', text: lead });
          continue;
        }
        await send({ type: 'delta', text });
      }

      // Edge cases: model emitted only whitespace, or the loop ended before a
      // character arrived (empty response) — fall back to a gentle chat nudge.
      if (!decided) {
        const trimmed = lead.trim();
        if (trimmed.startsWith('<')) {
          mode = 'build';
          await send({ type: 'route', mode: 'build' });
        } else {
          mode = 'chat';
          const fallback = trimmed || "I'm here to help — tell me what you'd like to build or change, and I'll take care of it.";
          await send({ type: 'delta', text: fallback });
        }
      }

      await send({ type: 'done', mode });
    } catch (error: any) {
      console.error('[chat] Error:', error);
      await send({ type: 'error', error: error?.message || 'Chat failed' });
    } finally {
      try { await writer.close(); } catch { /* already closed */ }
    }
  })();

  return new Response(tstream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
