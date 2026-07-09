import { NextRequest } from 'next/server';
import { createGroq } from '@ai-sdk/groq';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';
import { appConfig } from '@/config/app.config';

// Streaming route — no sandbox, no build. The model returns ONE self-contained
// Arabic HTML document that the kid watches paint live in an iframe.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Providers (same wiring as the adult generate route, kept local so this
// lean kids flow has no coupling to it). All can be proxied via AI Gateway. ---
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

// Kids apps want good design + reliable single-file HTML. Overridable via env.
const KIDS_MODEL = process.env.KIDS_MODEL || appConfig.ai.defaultModel;

function resolveProvider(model: string) {
  if (model.startsWith('anthropic/')) return { provider: anthropic, id: model.replace('anthropic/', ''), isZai: false };
  if (model.startsWith('openai/')) return { provider: openai, id: model.replace('openai/', ''), isOpenAI: true, isZai: false };
  if (model.startsWith('google/')) return { provider: googleGenerativeAI, id: model.replace('google/', ''), isZai: false };
  if (model.startsWith('zai/')) return { provider: zai, id: model.replace('zai/', ''), isZai: true };
  if (model === 'moonshotai/kimi-k2-instruct-0905') return { provider: groq, id: model, isZai: false };
  return { provider: groq, id: model, isZai: false };
}

const KIDS_SYSTEM_PROMPT = `You are a joyful web-building assistant for CHILDREN. A kid describes an app or website, and you build it for them so they can see it come alive instantly. Make them feel proud and amazed.

# OUTPUT FORMAT — READ CAREFULLY
- Output ONE complete, valid HTML5 document and NOTHING ELSE. No markdown, no code fences, no explanations before or after.
- Order the document so the child watches it build LIVE — visible CONTENT first, then styling, then behaviour. Use EXACTLY this order:
  1. \`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>…</title></head><body>\`
  2. ALL the visible HTML content (headings, buttons, inputs, etc.) — written FIRST so it appears immediately as it streams.
  3. THEN one single \`<style>\` block (its FIRST line is the Google Fonts @import).
  4. THEN one single \`<script>\` block.
  5. \`</body></html>\`
- Putting \`<style>\` after the content is intentional and required here (it lets the page paint progressively). Everything stays inline in this one self-contained file — no external CSS/JS, no build step.

# LANGUAGE
- ALL visible text must be in ARABIC (Modern Standard, simple and warm for children). Buttons, labels, titles, messages — everything Arabic.
- The document is right-to-left (\`dir="rtl"\`).

# LOOK & FEEL (kids brand)
- Bright, happy, playful. Big bold rounded typography. Thick borders (3–4px, dark). Big rounded corners. Chunky hard drop-shadows (e.g. \`box-shadow: 6px 6px 0 #2b2b2b\`).
- Cheerful palette — use colors like #FFD93D (sunny), #FF6B6B (coral), #4D96FF (sky), #6BCB77 (mint), #9B5DE5 (grape), #2B2B2B (ink), on a warm cream background (#FFF9F0).
- Load a playful Arabic Google Font as the FIRST line inside \`<style>\`, e.g. \`@import url('https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400..800&family=Tajawal:wght@400;700;800&display=swap');\` and use "Baloo Bhaijaan 2" for headings and "Tajawal" for body.
- Big tap targets (min 44px), lots of emojis, gentle CSS animations and hover effects. Make it delightful and full of personality — never plain or boring.

# BEHAVIOUR & DATA — NO BACKEND
- NO server, NO backend, NO \`fetch\`, NO external APIs or CDNs of any kind EXCEPT the Google Fonts \`@import\` above. NO external JS libraries — vanilla JavaScript only.
- If the app needs to remember things (scores, todos, drawings, notes), use the browser's \`localStorage\`. Seed with cheerful MOCK/sample data so it looks alive on first open.
- Everything must work offline in a plain iframe.

# QUALITY & FITTING THE WINDOW
- The app MUST fit inside the window without being cut off. Design it to fill the available space and adapt to ANY size — laptop and iPad, wide or short. Use relative units (%, vh, vw, \`clamp()\`), flexbox/grid, and \`box-sizing: border-box\`. NEVER use fixed pixel heights/widths that overflow the screen.
- Prefer a layout that fits on ONE screen with no scrolling. Size things down (with clamp/vh) so everything is visible at once — e.g. a calculator's buttons should shrink to fit, not run off the bottom. If content is genuinely taller than the screen, let the page scroll smoothly and never clip content off-screen.
- Fully responsive and touch-friendly (min 44px targets). No horizontal scrolling ever.
- Prioritize something that WORKS and DELIGHTS immediately. Keep it to a single focused screen unless the child asked for more.
- Write complete, correct, working code. Never truncate, never use "..." placeholders, always close every tag and bracket.

Remember: output ONLY the HTML document.`;

function sse(controller: ReadableStreamDefaultController, encoder: TextEncoder, obj: unknown) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
}

export async function POST(request: NextRequest) {
  let prompt = '';
  let previousHtml: string | undefined;
  try {
    const body = await request.json();
    prompt = (body?.prompt || '').toString();
    previousHtml = body?.previousHtml ? String(body.previousHtml) : undefined;
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (!prompt.trim()) return new Response('Missing prompt', { status: 400 });

  const encoder = new TextEncoder();
  const model = KIDS_MODEL;
  const { provider, id, isZai, isOpenAI } = resolveProvider(model);

  // For an edit, hand the model the current app plus the change request.
  const userContent = previousHtml
    ? `هذا هو الموقع الحالي للطفل (HTML كامل):\n\n${previousHtml}\n\n---\nالطفل يريد هذا التغيير: "${prompt}"\n\nأعد كتابة المستند بالكامل مع تطبيق التغيير، بنفس القواعد.`
    : `الطفل يريد أن يبني: "${prompt}"\n\nابنِ له الموقع الآن كمستند HTML واحد كامل.`;

  const stream = new ReadableStream({
    async start(controller) {
      const streamOptions: any = {
        model: isZai ? (zai as any).chat(id) : provider(id),
        messages: [
          { role: 'system', content: KIDS_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        maxTokens: 16000,
      };
      if (!model.startsWith('openai/gpt-5')) streamOptions.temperature = 0.8;
      if (isOpenAI) streamOptions.experimental_providerMetadata = { openai: { reasoningEffort: 'medium' } };

      let full = '';
      try {
        sse(controller, encoder, { type: 'start' });

        // Local dev has no usable model keys, so KIDS_MOCK=1 streams a canned
        // Arabic app in chunks — lets the whole build/preview/publish UX be
        // exercised locally. No effect in production (env unset).
        if (process.env.KIDS_MOCK === '1') {
          const mock = MOCK_HTML;
          const step = 60;
          for (let i = 0; i < mock.length; i += step) {
            full += mock.slice(i, i + step);
            sse(controller, encoder, { type: 'chunk', text: mock.slice(i, i + step) });
            await new Promise((r) => setTimeout(r, 40));
          }
          sse(controller, encoder, { type: 'done', html: extractHtml(full) });
          controller.close();
          return;
        }

        let result;
        let attempt = 0;
        // Small retry loop for transient provider errors.
        while (true) {
          try {
            result = await streamText(streamOptions);
            break;
          } catch (err) {
            if (attempt++ >= 2) throw err;
            await new Promise((r) => setTimeout(r, 800 * attempt));
          }
        }

        for await (const delta of result.textStream) {
          full += delta;
          sse(controller, encoder, { type: 'chunk', text: delta });
        }

        const html = extractHtml(full);
        sse(controller, encoder, { type: 'done', html });
      } catch (err) {
        console.error('[kids/generate] error:', err);
        sse(controller, encoder, {
          type: 'error',
          message: 'حدث خطأ بسيط أثناء البناء 😅 جرّب مرة أخرى!',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

// Canned app used only when KIDS_MOCK=1 (local dev without model keys).
const MOCK_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>صيد النجوم</title>
</head>
<body>
<h1>🌟 صيد النجوم 🌟</h1>
<div class="score">نقاطك: <span id="score">0</span> · أفضل نتيجة: <span id="best">0</span></div>
<div id="play"></div>
<button onclick="reset()">🔄 من جديد</button>
<style>
@import url('https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400..800&family=Tajawal:wght@400;700;800&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body { font-family: 'Tajawal', sans-serif; background: #FFF9F0; color: #2B2B2B; height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: clamp(12px, 3vh, 24px); text-align: center; }
h1 { font-family: 'Baloo Bhaijaan 2', cursive; font-size: clamp(24px, 5vw, 40px); color: #9B5DE5; }
.score { font-family: 'Baloo Bhaijaan 2'; font-size: clamp(16px, 3vw, 24px); background: #FFD93D; border: 3px solid #2B2B2B; border-radius: 999px; padding: 8px 20px; box-shadow: 4px 4px 0 #2B2B2B; }
#play { position: relative; width: 100%; max-width: 520px; flex: 1; min-height: 0; background: #4D96FF; border: 4px solid #2B2B2B; border-radius: 28px; box-shadow: 8px 8px 0 #2B2B2B; overflow: hidden; }
.star { position: absolute; font-size: clamp(32px, 6vw, 44px); cursor: pointer; transition: transform .1s; user-select: none; }
.star:active { transform: scale(1.4); }
button { font-family: 'Baloo Bhaijaan 2'; font-size: clamp(16px, 3vw, 20px); background: #FF6B6B; color: #fff; border: 3px solid #2B2B2B; border-radius: 999px; padding: 12px 26px; box-shadow: 5px 5px 0 #2B2B2B; cursor: pointer; }
button:active { transform: translate(4px,4px); box-shadow: 1px 1px 0 #2B2B2B; }
</style>
<script>
let score = 0;
const best = () => +(localStorage.getItem('bestStars') || 0);
document.getElementById('best').textContent = best();
function spawn() {
  const s = document.createElement('div');
  s.className = 'star'; s.textContent = '⭐';
  s.style.left = Math.random() * 85 + '%';
  s.style.top = Math.random() * 80 + '%';
  s.onclick = () => {
    score++; document.getElementById('score').textContent = score;
    if (score > best()) { localStorage.setItem('bestStars', score); document.getElementById('best').textContent = score; }
    s.remove(); spawn();
  };
  document.getElementById('play').appendChild(s);
}
function reset() { score = 0; document.getElementById('score').textContent = 0; }
spawn(); spawn(); spawn();
</script>
</body>
</html>`;

// Defensively pull the HTML document out of the model output: strip markdown
// fences and any stray prose around the document.
function extractHtml(raw: string): string {
  let s = raw.trim();
  // Remove ```html ... ``` fences if the model added them.
  s = s.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '');
  const start = s.search(/<!DOCTYPE html>|<html[\s>]/i);
  if (start > 0) s = s.slice(start);
  const end = s.toLowerCase().lastIndexOf('</html>');
  if (end !== -1) s = s.slice(0, end + '</html>'.length);
  return s.trim();
}
