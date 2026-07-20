'use client';

import { useI18n } from '@/lib/i18n/LanguageProvider';

// A compact EN/العربية toggle. Flips the whole UI to RTL + Arabic (and back).
export default function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, toggle, t } = useI18n();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('common.language')}
      title={t('common.language')}
      className={`inline-flex items-center gap-6 rounded-10 border border-[#e6e3ee] bg-white px-10 py-6 text-[13px] font-medium text-[#2a2635] transition-colors hover:bg-[#f5f3fa] ${className}`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="opacity-70">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
      </svg>
      {/* Show the language you'd switch TO, so the action is clear */}
      <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
    </button>
  );
}
