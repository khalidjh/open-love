import { generateText } from 'ai';
import { getProviderForModel } from '@/lib/ai/provider-manager';
import { detectFramework, type Framework } from '@/lib/templates';

// Language-agnostic framework routing. The old detectFramework() matches ENGLISH
// keywords, so an Arabic (or any non-English) backend-heavy request silently fell
// through to a static Vite SPA. This asks a fast model to classify the request by
// INTENT instead, and falls back to the keyword heuristic on any error/timeout so
// it never blocks project creation.

const CLASSIFY_MODEL = 'llama-3.1-8b-instant'; // Groq: fast, cheap, non-reasoning, and available on prod

const SYSTEM = `You decide what kind of web project a build request needs.
Reply with EXACTLY one lowercase word: "nextjs" or "vite". No punctuation, no explanation.

Answer "nextjs" if the app needs a backend or any server/data feature: user accounts or
login, a database or saving/sharing data, roles or permissions, file uploads, payments, an
AI assistant/chatbot, sending email, dashboards, or any multi-user data. Internal business
tools (CRM, orders, invoices, tasks, bookings, inventory) are ALWAYS "nextjs". This holds in
ANY language — the request is often in Arabic.

Answer "vite" ONLY for a purely static front-end with no saved data: a landing page,
portfolio, marketing/brochure site, a calculator, or a small game with no accounts or
persistence.

When unsure, answer "nextjs".`;

function buildModel(modelId: string) {
  const { client, actualModel } = getProviderForModel(modelId);
  // Z.AI needs .chat(); the classify model is Groq, so the plain call is correct —
  // but keep the guard in case CLASSIFY_MODEL changes.
  return modelId.startsWith('zai/')
    ? (client as any).chat(actualModel)
    : (client as any)(actualModel);
}

function fallbackTitle(src: string): string {
  const words = src.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  return words.length > 50 ? words.slice(0, 50) + '…' : words;
}

// A short, human title for a build request, in the request's own language. Falls
// back to a trimmed word-slice on any error/timeout so it never blocks creation.
export async function generateTitle(text?: string | null): Promise<string> {
  const src = (text || '').trim();
  if (!src) return 'تطبيق جديد';
  // Already short enough to be a title — keep it as-is (avoids an unneeded call).
  if (src.length <= 32 && !src.includes('\n')) return src;
  try {
    const res = (await Promise.race([
      generateText({
        model: buildModel(CLASSIFY_MODEL),
        system:
          'Create a SHORT app title (2 to 5 words) for this build request, in the SAME language ' +
          'as the request. Reply with ONLY the title — no quotes, no punctuation, no explanation.',
        prompt: src.slice(0, 2000),
        temperature: 0.2,
        maxOutputTokens: 24,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('title timeout')), 8000)),
    ])) as { text: string };
    const title = (res.text || '').trim().replace(/^["'«»\s]+|["'«»\s]+$/g, '').split('\n')[0];
    return title && title.length <= 60 ? title : fallbackTitle(src);
  } catch (e) {
    console.error('[generateTitle] fell back:', e);
    return fallbackTitle(src);
  }
}

export async function classifyFramework(prompt?: string | null): Promise<Framework> {
  const text = (prompt || '').trim();
  if (!text) return 'vite';
  try {
    const res = (await Promise.race([
      generateText({
        model: buildModel(CLASSIFY_MODEL),
        system: SYSTEM,
        prompt: text.slice(0, 2000),
        temperature: 0,
        maxOutputTokens: 8,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('classify timeout')), 8000)),
    ])) as { text: string };

    const answer = (res.text || '').toLowerCase();
    if (answer.includes('next')) return 'nextjs';
    if (answer.includes('vite')) return 'vite';
    return detectFramework(prompt); // unexpected output → keyword heuristic
  } catch (e) {
    console.error('[classifyFramework] model classify failed, using keywords:', e);
    return detectFramework(prompt);
  }
}
