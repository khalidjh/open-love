'use client';

import { useEffect, useState } from 'react';
import { kidsStages } from '@/lib/kids/brand';
import KidsMascot from './KidsMascot';

// Shown in the preview during the short wait before the app starts painting (the
// model's time-to-first-token). Keeps kids watching with bouncing blocks, the
// mascot, and cheerful cycling messages so it never feels stuck or blank.
const STAGES = kidsStages.filter((s) => s.key !== 'publish');
const BLOCKS = ['#FFD93D', '#FF6B6B', '#4D96FF', '#6BCB77', '#9B5DE5'];

export default function KidsBuildingScene() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % STAGES.length), 1600);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-7 p-8 text-center">
      {/* stacking / bouncing blocks */}
      <div className="flex items-end gap-2" aria-hidden>
        {BLOCKS.map((c, k) => (
          <span
            key={k}
            style={{
              width: 28,
              height: 28,
              background: c,
              border: '3px solid #2B2B2B',
              borderRadius: 9,
              boxShadow: '3px 3px 0 #2B2B2B',
              animation: `k-build-bounce 1s ${k * 0.12}s infinite ease-in-out`,
            }}
          />
        ))}
      </div>

      <KidsMascot size={76} />

      <p
        key={i}
        className="k-pop"
        style={{ fontFamily: 'var(--k-font-display)', fontWeight: 800, fontSize: 22 }}
      >
        {STAGES[i].emoji} {STAGES[i].message}
      </p>

      {/* candy progress hint */}
      <div
        style={{
          width: 200,
          height: 14,
          borderRadius: 999,
          border: '3px solid var(--k-ink)',
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: '100%',
            background:
              'repeating-linear-gradient(45deg, var(--k-coral) 0 16px, var(--k-sunny) 16px 32px, var(--k-sky) 32px 48px, var(--k-mint) 48px 64px)',
            animation: 'k-slide-stripes 1s linear infinite',
          }}
        />
      </div>
      <style>{`@keyframes k-slide-stripes { from { background-position: 0 0; } to { background-position: 64px 0; } }`}</style>
    </div>
  );
}
