'use client';

import { useState } from 'react';

export type DeployStage = 'publishing' | 'published' | 'error';

export interface DeployState {
  stage: DeployStage;
  url?: string;
  message?: string;
  // True while the host is still finishing processing after a successful deploy.
  processing?: boolean;
}

function StatusTag({ stage }: { stage: DeployStage }) {
  if (stage === 'publishing') {
    return (
      <span className="inline-flex items-center gap-6 rounded-full bg-[#fbf3e3] px-10 py-4 text-[12px] font-semibold text-[#a9730a]">
        <span className="h-8 w-8 animate-spin rounded-full border-[1.5px] border-[#e8c98a] border-t-[#a9730a]" />
        Publishing
      </span>
    );
  }
  if (stage === 'published') {
    return (
      <span className="inline-flex items-center gap-6 rounded-full bg-[#e9f8ef] px-10 py-4 text-[12px] font-semibold text-[#1a7f43]">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
          <path d="M5 13l4 4L19 7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Published
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-6 rounded-full bg-[#fdece9] px-10 py-4 text-[12px] font-semibold text-[#b23b2e]">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      Failed
    </span>
  );
}

export default function DeployStatus({ state }: { state: DeployState }) {
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    if (!state.url) return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); fail quietly.
    }
  };

  return (
    <div className="anim-fade-up flex flex-col gap-10 rounded-14 border border-[#ece8f4] bg-white px-14 py-12">
      <div className="flex items-center gap-8">
        <StatusTag stage={state.stage} />
        {state.stage === 'publishing' && (
          <span className="text-[13px] text-[#6b6577]">This can take a minute…</span>
        )}
      </div>

      {state.stage === 'error' && state.message && (
        <p className="text-[13px] leading-relaxed text-[#b23b2e]">{state.message}</p>
      )}

      {state.stage === 'published' && state.url && (
        <>
          <div className="flex items-center gap-8 rounded-10 border border-[#ece8f4] bg-[#faf9fe] px-10 py-8">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden className="shrink-0 text-[#6147D4]">
              <circle cx="10" cy="10" r="7.5" strokeWidth="1.3" />
              <path d="M2.5 10h15" strokeWidth="1.3" />
              <path d="M10 2.5c2.2 2.6 2.2 12.4 0 15M10 2.5c-2.2 2.6-2.2 12.4 0 15" strokeWidth="1.3" />
            </svg>
            <a
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-[#5b5668] transition-colors hover:text-[#6147D4]"
              title={state.url}
            >
              {state.url.replace(/^https?:\/\//, '')}
            </a>
            <button
              onClick={copyUrl}
              aria-label={copied ? 'Copied' : 'Copy URL'}
              title={copied ? 'Copied!' : 'Copy URL'}
              className="flex h-28 w-28 shrink-0 items-center justify-center rounded-8 text-[#6b6577] transition-colors hover:bg-[#f0ecfb] hover:text-[#6147D4]"
            >
              {copied ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
                  <path d="M5 13l4 4L19 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
                  <rect x="9" y="9" width="11" height="11" rx="2" strokeWidth="1.7" />
                  <path d="M5 15V5a2 2 0 012-2h10" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <a
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in new tab"
              title="Open in new tab"
              className="flex h-28 w-28 shrink-0 items-center justify-center rounded-8 text-[#6b6577] transition-colors hover:bg-[#f0ecfb] hover:text-[#6147D4]"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
                <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
          {state.processing && (
            <p className="text-[12px] text-[#6b6577]">Still finishing processing — the URL will be live shortly.</p>
          )}
        </>
      )}
    </div>
  );
}
