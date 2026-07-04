import { NextRequest, NextResponse } from 'next/server';
import { createGroq } from '@ai-sdk/groq';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import { appConfig } from '@/config/app.config';

// Check if we're using Vercel AI Gateway
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

const openai = createOpenAI({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : process.env.OPENAI_BASE_URL,
});

const googleGenerativeAI = createGoogleGenerativeAI({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.GEMINI_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : undefined,
});

// Z.AI (GLM models) — OpenAI-compatible API
const zai = createOpenAI({
  apiKey: process.env.ZAI_API_KEY,
  baseURL: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4',
});

// Sensible fallback if the model call fails — never leave the UI empty.
const DEFAULT_SUGGESTIONS = [
  'Make it responsive',
  'Add a dark mode toggle',
  'Improve the styling',
  'Add animations',
];

const suggestionsSchema = z.object({
  suggestions: z
    .array(z.string())
    .min(3)
    .max(4)
    .describe('3-4 short, actionable next-step prompts the user could tap to keep improving their app'),
});

type IncomingMessage = { type?: string; content?: string };

function selectModel(model: string) {
  if (model.startsWith('anthropic/')) {
    return anthropic(model.replace('anthropic/', ''));
  } else if (model.startsWith('zai/')) {
    // Z.AI only supports Chat Completions, not the Responses API
    return (zai as any).chat(model.replace('zai/', ''));
  } else if (model.startsWith('moonshotai/')) {
    return groq(model);
  } else if (model.startsWith('openai/')) {
    if (model.includes('gpt-oss')) return groq(model);
    return openai(model.replace('openai/', ''));
  } else if (model.startsWith('google/')) {
    return googleGenerativeAI(model.replace('google/', ''));
  }
  return groq(model);
}

export async function POST(request: NextRequest) {
  try {
    const {
      messages = [],
      files = [],
      model = appConfig.ai.defaultModel,
    }: { messages?: IncomingMessage[]; files?: string[]; model?: string } = await request.json();

    // Build a compact, readable transcript for the model to reason over.
    const transcript = (messages as IncomingMessage[])
      .filter((m) => m?.content && (m.type === 'user' || m.type === 'ai'))
      .slice(-8)
      .map((m) => `${m.type === 'user' ? 'User' : 'App'}: ${(m.content || '').slice(0, 600)}`)
      .join('\n');

    const fileList = (files as string[]).slice(0, 60).join('\n');

    const aiModel = selectModel(model);

    const result = await generateObject({
      model: aiModel,
      schema: suggestionsSchema,
      temperature: 0.8,
      messages: [
        {
          role: 'system',
          content: `You suggest the next thing a NON-TECHNICAL user might want to do to improve the web app they are building with an AI app builder.

Return 3-4 suggestions. Each MUST be:
- A short imperative phrase the user could tap to send as their next request (e.g. "Add a contact form", "Make the hero section bolder").
- 2-6 words. No trailing punctuation. Sentence case.
- SPECIFIC to THIS app based on the conversation and files below — reference the app's actual sections, features, or content. Avoid generic filler unless nothing specific applies.
- Friendly and jargon-free. Never mention frameworks, files, code, or technical terms.
- Genuinely different from each other (mix visual polish, a new feature, and content/copy).
- Do NOT repeat something the user already asked for in the conversation.`,
        },
        {
          role: 'user',
          content: `Recent conversation:\n${transcript || '(no conversation yet)'}\n\nFiles in the current app:\n${fileList || '(unknown)'}\n\nSuggest 3-4 great next steps for this specific app.`,
        },
      ],
    });

    const suggestions = (result.object.suggestions || [])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);

    return NextResponse.json({
      success: true,
      suggestions: suggestions.length >= 3 ? suggestions : DEFAULT_SUGGESTIONS,
    });
  } catch (error) {
    console.error('[suggest-followups] Error:', error);
    // Degrade gracefully — the UI still gets usable chips.
    return NextResponse.json({
      success: true,
      suggestions: DEFAULT_SUGGESTIONS,
      fallback: true,
      error: (error as Error).message,
    });
  }
}
