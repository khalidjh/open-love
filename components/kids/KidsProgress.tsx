'use client';

import { useEffect, useState } from 'react';
import { kidsStages } from '@/lib/kids/brand';

// Friendly build progress. While the app streams in we cycle through cheerful
// stages (never technical logs); when publishing we pin the rocket stage.
const BUILD_STAGES = kidsStages.filter((s) => s.key !== 'publish');
const PUBLISH_STAGE = kidsStages.find((s) => s.key === 'publish')!;

export default function KidsProgress({
  phase,
}: {
  phase: 'building' | 'publishing';
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (phase !== 'building') return;
    const t = setInterval(() => setI((v) => (v + 1) % BUILD_STAGES.length), 2200);
    return () => clearInterval(t);
  }, [phase]);

  const stage = phase === 'publishing' ? PUBLISH_STAGE : BUILD_STAGES[i];

  return (
    <div className="k-card k-pop flex items-center gap-3" style={{ padding: '14px 18px' }}>
      <span className="k-wobble" style={{ fontSize: 30 }}>
        {stage.emoji}
      </span>
      <div className="flex-1">
        <div style={{ fontFamily: 'var(--k-font-display)', fontWeight: 800, fontSize: 18 }}>
          {stage.message}
        </div>
        {/* candy progress bar */}
        <div
          style={{
            marginTop: 8,
            height: 12,
            borderRadius: 999,
            border: '2px solid var(--k-ink)',
            background: '#fff',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: '100%',
              background:
                'repeating-linear-gradient(45deg, var(--k-coral) 0 14px, var(--k-sunny) 14px 28px, var(--k-sky) 28px 42px, var(--k-mint) 42px 56px)',
              backgroundSize: '200% 100%',
              animation: 'k-slide-stripes 1s linear infinite',
            }}
          />
        </div>
      </div>
      <style>{`@keyframes k-slide-stripes { from { background-position: 0 0; } to { background-position: 56px 0; } }`}</style>
    </div>
  );
}
