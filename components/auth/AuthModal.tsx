'use client';

import { useEffect } from 'react';
import { useI18n } from "@/lib/i18n/LanguageProvider";
import AuthForm from './AuthForm';

interface AuthModalProps {
  open: boolean;
  initialMode?: 'signin' | 'signup';
  onClose: () => void;
}

export default function AuthModal({ open, initialMode = 'signin', onClose }: AuthModalProps) {
  const { t } = useI18n();
  // Close on Escape and lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-stretch justify-center p-0 md:items-center md:p-24"
      role="dialog"
      aria-modal="true"
    >
      {/* Dimmed, blurred backdrop (desktop only — mobile is a full-screen page) */}
      <div
        className="absolute inset-0 hidden bg-black/45 backdrop-blur-sm animate-in fade-in duration-200 md:block"
        onClick={onClose}
      />

      {/* Card — full-screen on mobile, centered card on desktop */}
      <div className="relative z-10 flex h-full w-full max-w-none flex-col overflow-y-auto rounded-none border-0 bg-white p-24 pt-64 animate-in fade-in duration-200 md:h-auto md:max-w-[440px] md:rounded-24 md:border md:border-[#d6d0e6] md:p-40 md:pt-40 md:zoom-in-95">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute right-16 top-16 flex h-36 w-36 items-center justify-center rounded-full text-[#6b6577] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622] md:right-20 md:top-20 md:h-32 md:w-32"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
              d="M5 5L15 15M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <AuthForm initialMode={initialMode} onSuccess={onClose} />
      </div>
    </div>
  );
}
