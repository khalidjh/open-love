'use client';

import { useEffect } from 'react';
import AuthForm from './AuthForm';

interface AuthModalProps {
  open: boolean;
  initialMode?: 'signin' | 'signup';
  onClose: () => void;
}

export default function AuthModal({ open, initialMode = 'signin', onClose }: AuthModalProps) {
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
      className="fixed inset-0 z-[200] flex items-center justify-center p-24"
      role="dialog"
      aria-modal="true"
    >
      {/* Dimmed, blurred backdrop */}
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-[440px] rounded-24 border border-[#eae6f3] bg-white p-40 shadow-[0_24px_80px_-12px_rgba(25,22,34,0.4)] animate-in fade-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-20 top-20 flex h-32 w-32 items-center justify-center rounded-full text-[#8b8798] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622]"
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
