// Single source of truth for the Etlaq Kids sub-brand.
// Everything kid-facing (name, palette, mascot, copy, idea chips) lives here so
// the whole experience can be re-themed or renamed by editing one file.

export const kidsBrand = {
  // Rename here to change the product name everywhere.
  name: 'إطلاق كيدز',
  nameLatin: 'Etlaq Kids',
  tagline: 'اصنع موقعك الأول… بضغطة زر! 🚀',
  mascotEmoji: '🚀',

  // Bright, happy palette. Kept as hex here and mirrored as CSS vars in
  // styles/kids.css so both TS and CSS can share the same source.
  palette: {
    sunny: '#FFD93D',
    coral: '#FF6B6B',
    sky: '#4D96FF',
    mint: '#6BCB77',
    grape: '#9B5DE5',
    ink: '#2B2B2B',
    cream: '#FFF9F0',
    cloud: '#FFFFFF',
  },
} as const;

// Fun idea chips shown on the start screen. `emoji` + `label` (Arabic) and the
// `prompt` we actually send to the model.
export const kidsIdeas: { emoji: string; label: string; prompt: string }[] = [
  {
    emoji: '🎮',
    label: 'اصنع لعبة!',
    prompt: 'اصنع لي لعبة بسيطة وممتعة ألعبها في المتصفح مع نقاط وأصوات مرحة',
  },
  {
    emoji: '🎡',
    label: 'عجلة الحظ',
    prompt: 'اصنع لي عجلة حظ ملوّنة أضغط عليها فتدور وتختار اسماً أو جائزة عشوائية',
  },
  {
    emoji: '✅',
    label: 'قائمة مهامي',
    prompt: 'اصنع لي قائمة مهام يومية أضيف إليها المهام وأشطبها عند إنجازها',
  },
  {
    emoji: '🎨',
    label: 'لوحة رسم',
    prompt: 'اصنع لي لوحة رسم ألوّن فيها بالفرشاة وأختار الألوان وأمسح',
  },
  {
    emoji: '🐾',
    label: 'موقع حيواني المفضل',
    prompt: 'اصنع لي موقعاً جميلاً عن حيواني المفضل مع صور وحقائق ممتعة',
  },
  {
    emoji: '🧮',
    label: 'آلة حاسبة',
    prompt: 'اصنع لي آلة حاسبة ملوّنة وسهلة الاستخدام',
  },
];

// Playful build-stage copy. The generation UI cycles through these while the app
// is being written so kids see friendly progress instead of technical logs.
export const kidsStages: { key: string; emoji: string; message: string }[] = [
  { key: 'thinking', emoji: '🤔', message: 'أفكّر في فكرتك…' },
  { key: 'page', emoji: '📄', message: 'نجهّز الصفحة…' },
  { key: 'colors', emoji: '🌈', message: 'نلوّن كل شي…' },
  { key: 'buttons', emoji: '🔘', message: 'نضيف الأزرار…' },
  { key: 'magic', emoji: '✨', message: 'نشغّل السحر…' },
  { key: 'publish', emoji: '🚀', message: 'ننشر موقعك للعالم…' },
];

// Encouraging one-liners the mascot says at random moments.
export const kidsCheers: string[] = [
  'رائع! فكرة خيالية 🌟',
  'هيا نبنيها معاً! 💪',
  'أنت مخترع حقيقي! 🧠',
  'موقعك أصبح أجمل! 🎉',
];
