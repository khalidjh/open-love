'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@/styles/kids.css';
import { kidsBrand, kidsIdeas, kidsCheers } from '@/lib/kids/brand';
import {
  KidsCreation,
  loadCreations,
  saveCreation,
  newCreationId,
} from '@/lib/kids/creations';
import KidsMascot from '@/components/kids/KidsMascot';
import KidsComposer from '@/components/kids/KidsComposer';
import KidsChat, { KidsMessage } from '@/components/kids/KidsChat';
import KidsProgress from '@/components/kids/KidsProgress';
import KidsPreview from '@/components/kids/KidsPreview';

type Phase = 'start' | 'building' | 'done';
type PublishState = 'idle' | 'publishing' | 'published' | 'unavailable';

// Strip any stray markdown fence the model might prepend while streaming, so the
// live preview never flashes a literal ```html line.
function cleanHtml(s: string): string {
  return s.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '');
}

// Make a PARTIAL (mid-stream) HTML doc renderable so the kid watches it paint
// live: close an open <style> (otherwise the browser swallows the whole body as
// CSS text until </style> arrives — nothing shows), and drop an incomplete
// trailing <script> whose half-written JS would just throw.
function makeRenderable(s: string): string {
  let html = s;
  const count = (re: RegExp) => (html.match(re) || []).length;
  if (count(/<style[^>]*>/gi) > count(/<\/style>/gi)) html += '\n</style>';
  if (count(/<script[^>]*>/gi) > count(/<\/script>/gi)) {
    const idx = html.toLowerCase().lastIndexOf('<script');
    if (idx !== -1) html = html.slice(0, idx);
  }
  return html;
}

let msgSeq = 0;
const nextMsgId = () => `m${++msgSeq}`;

export default function KidsPage() {
  const [phase, setPhase] = useState<Phase>('start');
  const [messages, setMessages] = useState<KidsMessage[]>([]);
  const [previewHtml, setPreviewHtml] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [publishState, setPublishState] = useState<PublishState>('idle');
  const [publishUrl, setPublishUrl] = useState<string | undefined>();
  const [creations, setCreations] = useState<KidsCreation[]>([]);
  const [confetti, setConfetti] = useState(false);
  // On small screens we show one panel at a time (toggle in the header).
  const [mobileView, setMobileView] = useState<'preview' | 'chat'>('preview');

  const creationIdRef = useRef<string>('');
  const titleRef = useRef<string>('موقعي');
  const fullRef = useRef<string>('');
  const throttleRef = useRef<number>(0);

  useEffect(() => {
    setCreations(loadCreations());
  }, []);

  const pushMessage = useCallback((role: 'kid' | 'bot', text: string) => {
    setMessages((m) => [...m, { id: nextMsgId(), role, text }]);
  }, []);

  // Throttle preview re-renders while tokens stream in (~140ms) so the kid sees
  // it paint smoothly without thrashing React on every chunk.
  const scheduleRender = useCallback(() => {
    const now = Date.now();
    if (now - throttleRef.current < 120) return;
    throttleRef.current = now;
    setPreviewHtml(makeRenderable(cleanHtml(fullRef.current)));
  }, []);

  const publish = useCallback(async (html: string) => {
    setPublishState('publishing');
    try {
      const res = await fetch('/api/kids/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creationId: creationIdRef.current, html, siteName: titleRef.current }),
      });
      const data = await res.json();
      if (data?.success && data?.url) {
        setPublishUrl(data.url);
        setPublishState('published');
        setConfetti(true);
        setTimeout(() => setConfetti(false), 4000);
        pushMessage('bot', `🎉 نشرتُ موقعك! افتحه من الزر وشاركه مع أصدقائك 🚀`);
        saveCreation({
          id: creationIdRef.current,
          title: titleRef.current,
          prompt: titleRef.current,
          html,
          publishUrl: data.url,
          updatedAt: Date.now(),
        });
        setCreations(loadCreations());
      } else {
        setPublishState('unavailable');
        pushMessage('bot', 'موقعك جاهز! 🎈 يمكنك حفظه على جهازك من زر «حفظ».');
      }
    } catch {
      setPublishState('unavailable');
      pushMessage('bot', 'موقعك جاهز! 🎈 تقدر تحفظه على جهازك من زر «حفظ».');
    }
  }, [pushMessage]);

  const startBuild = useCallback(
    async (prompt: string, opts: { isEdit?: boolean } = {}) => {
      const isEdit = !!opts.isEdit;
      if (!isEdit) {
        creationIdRef.current = newCreationId();
        titleRef.current = prompt.slice(0, 40);
        fullRef.current = '';
        setPreviewHtml('');
        setPublishUrl(undefined);
      }
      setPublishState('idle');
      setPhase('building');
      setStreaming(true);
      setMobileView('preview'); // on phones, jump to the preview to watch it build
      pushMessage('kid', prompt);
      pushMessage('bot', kidsCheers[Math.floor(Math.random() * kidsCheers.length)]);

      try {
        const res = await fetch('/api/kids/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            creationId: creationIdRef.current,
            previousHtml: isEdit ? fullRef.current : undefined,
          }),
        });
        if (!res.ok || !res.body) throw new Error('bad response');

        // For an edit we rebuild the doc from scratch in the stream.
        if (isEdit) fullRef.current = '';

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalHtml = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) continue;
            let evt: any;
            try {
              evt = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (evt.type === 'chunk') {
              fullRef.current += evt.text;
              scheduleRender();
            } else if (evt.type === 'done') {
              finalHtml = evt.html || cleanHtml(fullRef.current);
            } else if (evt.type === 'error') {
              throw new Error(evt.message || 'error');
            }
          }
        }

        const html = finalHtml || cleanHtml(fullRef.current);
        fullRef.current = html;
        setPreviewHtml(html);
        setStreaming(false);
        setPhase('done');
        // Save to the gallery as soon as it's built, so it's always there to
        // reopen later — even if publishing isn't available. publish() updates
        // this same entry (same id) with the live URL on success.
        saveCreation({
          id: creationIdRef.current,
          title: titleRef.current,
          prompt: titleRef.current,
          html,
          updatedAt: Date.now(),
        });
        setCreations(loadCreations());
        pushMessage('bot', 'اكتمل موقعك وأصبح رائعاً! ✨ دعني أنشره لك…');
        await publish(html);
      } catch {
        setStreaming(false);
        setPhase('done');
        pushMessage('bot', 'حدث خطأ بسيط أثناء البناء 😅 جرّب مرة أخرى!');
      }
    },
    [pushMessage, publish, scheduleRender],
  );

  const openCreation = useCallback((c: KidsCreation) => {
    creationIdRef.current = c.id;
    titleRef.current = c.title;
    fullRef.current = c.html;
    setPreviewHtml(c.html);
    setMessages([{ id: nextMsgId(), role: 'bot', text: 'أعدنا موقعك! يمكنك تعديله أو فتحه 🎨' }]);
    setPublishUrl(c.publishUrl);
    setPublishState(c.publishUrl ? 'published' : 'idle');
    setPhase('done');
  }, []);

  const resetToStart = useCallback(() => {
    setPhase('start');
    setMessages([]);
    setPreviewHtml('');
    fullRef.current = '';
    setPublishState('idle');
    setPublishUrl(undefined);
    setCreations(loadCreations());
  }, []);

  const rootClass = 'kids-root';
  const isBusy = streaming || publishState === 'publishing';

  return (
    <div dir="rtl" lang="ar" className={`${rootClass} min-h-screen w-full`}>
      {confetti && <Confetti />}
      {phase === 'start' ? (
        <StartScreen creations={creations} onSend={(p) => startBuild(p)} onOpen={openCreation} />
      ) : (
        <div className="mx-auto flex h-[100dvh] w-full max-w-[1400px] flex-col p-5 sm:p-8">
          {/* header */}
          <header className="mb-6 flex items-center gap-3">
            <button onClick={resetToStart} className="k-chip" type="button">جديد →</button>
            <div className="me-auto flex items-center gap-2">
              <KidsMascot size={40} />
              <span style={{ fontFamily: 'var(--k-font-display)', fontWeight: 800, fontSize: 20 }}>
                {kidsBrand.name}
              </span>
            </div>
            {/* Mobile-only: switch between the app and the chat */}
            <button
              onClick={() => setMobileView((v) => (v === 'chat' ? 'preview' : 'chat'))}
              className="k-chip lg:hidden"
              type="button"
            >
              {mobileView === 'chat' ? '👀 موقعي' : '💬 المحادثة'}
            </button>
          </header>

          <div className="flex min-h-0 flex-1 gap-5 lg:flex-row lg:gap-8">
            {/* Chat side (right in RTL) — messages scroll, composer pinned to bottom */}
            <section
              className={`${mobileView === 'chat' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col lg:flex lg:h-full lg:flex-none lg:w-[40%] lg:max-w-[480px] order-2 lg:order-1`}
            >
              <div className="flex-1 overflow-y-auto px-2 pb-2 lg:min-h-0">
                <KidsChat messages={messages} typing={streaming} />
                {isBusy && (
                  <div className="mt-5">
                    <KidsProgress phase={publishState === 'publishing' ? 'publishing' : 'building'} />
                  </div>
                )}
              </div>
              <div className="mt-4 shrink-0 px-2">
                <KidsComposer
                  variant="chat"
                  disabled={isBusy}
                  placeholder={isBusy ? 'نبني الآن…' : 'هل تريد تغيير شيء؟ اكتبه هنا…'}
                  onSend={(p) => startBuild(p, { isEdit: true })}
                />
              </div>
            </section>

            {/* Preview side (left in RTL) — fills the window */}
            <section
              className={`${mobileView === 'preview' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col lg:flex lg:h-full order-1 lg:order-2`}
            >
              <KidsPreview
                html={previewHtml}
                streaming={streaming}
                publishUrl={publishUrl}
                publishState={publishState}
              />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function StartScreen({
  creations,
  onSend,
  onOpen,
}: {
  creations: KidsCreation[];
  onSend: (prompt: string) => void;
  onOpen: (c: KidsCreation) => void;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[860px] flex-col items-center justify-center px-4 py-16">
      <div className="mb-10">
        <KidsMascot size={104} />
      </div>
      <h1 className="text-center leading-[1.3]" style={{ fontSize: 'clamp(30px, 6vw, 52px)' }}>
        ماذا تريد أن تبني اليوم؟
        <span className="k-rainbow" style={{ marginInlineStart: 12 }}>🎨</span>
      </h1>
      <p
        className="mb-14 mt-5 text-center"
        style={{ fontFamily: 'var(--k-font-body)', fontWeight: 700, fontSize: 'clamp(16px, 2.5vw, 20px)' }}
      >
        {kidsBrand.tagline}
      </p>

      <div className="w-full max-w-[640px]">
        <KidsComposer variant="hero" onSend={onSend} placeholder="مثال: اصنع لي لعبة صيد النجوم…" />
      </div>

      {/* Idea chips */}
      <div className="mx-auto mt-12 flex max-w-[720px] flex-wrap justify-center gap-x-5 gap-y-11">
        {kidsIdeas.map((idea) => (
          <button key={idea.label} className="k-chip" onClick={() => onSend(idea.prompt)} type="button">
            <span style={{ fontSize: 20 }}>{idea.emoji}</span> {idea.label}
          </button>
        ))}
      </div>

      {/* Gallery of the kid's past creations */}
      {creations.length > 0 && (
        <div className="mt-10 w-full">
          <h2 className="mb-3 text-center" style={{ fontSize: 22 }}>
            🧸 أعمالي السابقة
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {creations.map((c) => (
              <button
                key={c.id}
                className="k-card k-pop p-3 text-start"
                onClick={() => onOpen(c)}
                type="button"
                style={{ borderRadius: 20 }}
              >
                <div className="mb-1 text-2xl">{c.publishUrl ? '🌍' : '🎨'}</div>
                <div className="truncate" style={{ fontFamily: 'var(--k-font-display)', fontWeight: 800 }}>
                  {c.title || 'موقعي'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// A quick burst of confetti when an app publishes.
function Confetti() {
  const colors = ['#FFD93D', '#FF6B6B', '#4D96FF', '#6BCB77', '#9B5DE5'];
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }).map((_, i) => ({
        left: (i * 97) % 100,
        delay: (i % 10) * 0.15,
        dur: 2.4 + (i % 5) * 0.4,
        color: colors[i % colors.length],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return (
    <>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="k-confetti"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
          }}
        />
      ))}
    </>
  );
}
