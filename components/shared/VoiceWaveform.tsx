"use client";

// Per-bar sensitivity so the bars move like an equalizer instead of in unison.
const BAR_FACTORS = [0.45, 0.78, 1, 0.85, 0.55];

/**
 * A compact live equalizer for voice dictation. Bar heights are driven by
 * `level` (0–1, the smoothed mic amplitude), with a small floor so it still
 * reads as "listening" during silence.
 */
export default function VoiceWaveform({
  level,
  className = "",
  color = "#6147D4",
}: {
  level: number;
  className?: string;
  color?: string;
}) {
  return (
    <div
      className={`flex h-20 items-center gap-[3px] ${className}`}
      aria-hidden
    >
      {BAR_FACTORS.map((factor, i) => {
        const pct = Math.max(14, Math.min(100, 14 + level * factor * 150));
        return (
          <span
            key={i}
            className="w-[3px] rounded-full transition-[height] duration-100 ease-out"
            style={{ height: `${pct}%`, backgroundColor: color }}
          />
        );
      })}
    </div>
  );
}
