'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import KidsMascot from './KidsMascot';
import KidsBuildingScene from './KidsBuildingScene';

// The live app. We feed the streamed HTML straight into an iframe via srcDoc —
// no sandbox, no server. Includes a fullscreen button and, once published, a
// big friendly URL badge the kid can open or copy.
export default function KidsPreview({
  html,
  streaming,
  publishUrl,
  publishState,
}: {
  html: string;
  streaming: boolean;
  publishUrl?: string;
  publishState: 'idle' | 'publishing' | 'published' | 'unavailable';
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [copied, setCopied] = useState(false);

  const hasApp = html.trim().length > 0;
  // Only switch from the building scene to the iframe once real body content has
  // arrived — the head/meta stream first and would flash a blank iframe.
  const bodyPainted = /<body[^>]*>[\s\S]*?\S/i.test(html);

  // Scale the generated app to always fit the preview window: if it's taller
  // than the available height, render it at its full height and shrink the whole
  // iframe (centered) so nothing is clipped or needs scrolling. Apps that already
  // fit just fill the window (scale 1).
  const fit = useCallback(() => {
    const iframe = iframeRef.current;
    const screen = wrapRef.current;
    if (!iframe || !screen) return;
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      return;
    }
    if (!doc || !doc.documentElement) return;
    const availW = screen.clientWidth;
    const availH = screen.clientHeight;
    if (!availW || !availH) return;
    // Reset, then measure the app's natural height at full width.
    iframe.style.transform = 'none';
    iframe.style.width = availW + 'px';
    iframe.style.height = availH + 'px';
    const contentH = Math.max(
      doc.documentElement.scrollHeight,
      doc.body ? doc.body.scrollHeight : 0,
    );
    if (contentH <= availH + 2) return; // fits — fill the window, no scaling
    const scale = availH / contentH;
    iframe.style.height = contentH + 'px';
    iframe.style.transformOrigin = 'top center';
    iframe.style.transform = `scale(${scale})`;
  }, []);

  // Re-fit whenever the app changes (streaming + final) — with a few passes so
  // late layout shifts (webfonts loading) are caught.
  useEffect(() => {
    if (!hasApp) return;
    const timers = [60, 350, 900].map((d) => setTimeout(fit, d));
    return () => timers.forEach(clearTimeout);
  }, [html, hasApp, fit]);

  // Re-fit on any size change (window resize, entering/exiting fullscreen).
  useEffect(() => {
    const screen = wrapRef.current;
    if (!screen) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(screen);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [fit]);

  const goFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  const copyUrl = async () => {
    if (!publishUrl) return;
    try {
      await navigator.clipboard.writeText(publishUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — non-fatal */
    }
  };

  const download = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'موقعي.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap px-1">
        <span
          style={{ fontFamily: 'var(--k-font-display)', fontWeight: 800, fontSize: 18 }}
          className="me-auto flex items-center gap-2"
        >
          <span>👀</span> شاهد موقعك وهو يُبنى!
        </span>
        {hasApp && (
          <>
            <button className="k-chip" onClick={download} type="button">
              ⬇️ حفظ
            </button>
            <button className="k-chip" onClick={goFullscreen} type="button">
              ⛶ ملء الشاشة
            </button>
          </>
        )}
      </div>

      {/* Screen */}
      <div
        ref={wrapRef}
        className="k-card relative flex-1 overflow-hidden bg-white"
        style={{ borderRadius: 26, minHeight: 320 }}
      >
        {bodyPainted ? (
          <iframe
            ref={iframeRef}
            title="موقع الطفل"
            srcDoc={html}
            onLoad={fit}
            // allow-same-origin is required so the generated app's localStorage
            // works — without it, storage access throws and breaks every button.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock"
            style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#fff' }}
          />
        ) : streaming ? (
          <KidsBuildingScene />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
            <div>
              <KidsMascot size={92} />
            </div>
            <p style={{ fontFamily: 'var(--k-font-display)', fontWeight: 800, fontSize: 20 }}>
              موقعك سيظهر هنا! 🎨
            </p>
          </div>
        )}

        {streaming && hasApp && (
          <div
            className="absolute top-3 left-3 k-shadow-sm k-border"
            style={{
              background: 'var(--k-mint)',
              color: '#fff',
              borderRadius: 999,
              padding: '4px 12px',
              fontFamily: 'var(--k-font-display)',
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            ✍️ يُبنى الآن…
          </div>
        )}
      </div>

      {/* Publish badge */}
      {publishState === 'publishing' && (
        <div className="k-card flex items-center gap-3" style={{ padding: '12px 16px', background: 'var(--k-sunny)' }}>
          <span style={{ fontSize: 24 }}>🚀</span>
          <span style={{ fontFamily: 'var(--k-font-display)', fontWeight: 800 }}>ننشر موقعك للعالم…</span>
        </div>
      )}

      {publishState === 'published' && publishUrl && (
        <div className="k-card k-pop" style={{ padding: 16, background: 'var(--k-mint)', color: '#fff' }}>
          <div className="flex items-center gap-2" style={{ fontFamily: 'var(--k-font-display)', fontWeight: 800, fontSize: 19 }}>
            🎉 مبروك! موقعك صار على الإنترنت!
          </div>
          <div
            className="mt-2 truncate rounded-2xl bg-white px-3 py-2"
            style={{ color: 'var(--k-ink)', border: '2px solid var(--k-ink)', fontWeight: 700, direction: 'ltr', textAlign: 'left' }}
          >
            {publishUrl}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="k-btn k-btn--grape" href={publishUrl} target="_blank" rel="noreferrer">
              🚀 افتح بملء الشاشة
            </a>
            <button className="k-btn" onClick={copyUrl} type="button">
              {copied ? '✅ تم النسخ' : '📋 انسخ الرابط'}
            </button>
          </div>
        </div>
      )}

      {publishState === 'unavailable' && hasApp && (
        <div className="k-card" style={{ padding: 14, background: 'var(--k-sunny)' }}>
          <span style={{ fontFamily: 'var(--k-font-display)', fontWeight: 800 }}>
            موقعك جاهز! 🎈 احفظه على جهازك بزر «حفظ» في الأعلى.
          </span>
        </div>
      )}
    </div>
  );
}
