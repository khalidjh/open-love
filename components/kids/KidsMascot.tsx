'use client';

// The Etlaq Kids rocket mascot. Inline SVG so it can be sized/animated freely
// and used as chat avatar + empty-state hero.
export default function KidsMascot({
  size = 64,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      role="img"
      aria-label="صاروخ إطلاق كيدز"
    >
      <circle cx="60" cy="60" r="56" fill="#FFD93D" stroke="#2B2B2B" strokeWidth="4" />
      <path
        d="M60 96c-8 0-14-6-14-14 0 0 6 4 14 4s14-4 14-4c0 8-6 14-14 14z"
        fill="#FF6B6B"
        stroke="#2B2B2B"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M60 92c-4 0-7-3-7-7 0 0 3 2 7 2s7-2 7-2c0 4-3 7-7 7z" fill="#FFB84D" />
      <path
        d="M60 22c12 10 18 24 18 40v14H42V62c0-16 6-30 18-40z"
        fill="#4D96FF"
        stroke="#2B2B2B"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path d="M42 66c-8 2-12 8-12 16l12-4V66z" fill="#6BCB77" stroke="#2B2B2B" strokeWidth="3" strokeLinejoin="round" />
      <path d="M78 66c8 2 12 8 12 16l-12-4V66z" fill="#6BCB77" stroke="#2B2B2B" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="60" cy="52" r="12" fill="#FFF9F0" stroke="#2B2B2B" strokeWidth="4" />
      <circle cx="55" cy="50" r="2.2" fill="#2B2B2B" />
      <circle cx="65" cy="50" r="2.2" fill="#2B2B2B" />
      <path d="M54 56c2 3 10 3 12 0" stroke="#2B2B2B" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
