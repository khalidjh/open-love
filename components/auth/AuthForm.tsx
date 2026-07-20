'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/LanguageProvider';

const PRODUCT_NAME = 'Etlaq';

interface AuthFormProps {
  initialMode?: 'signin' | 'signup';
  /** Called after a successful sign-in. If omitted, navigates to home. */
  onSuccess?: () => void;
}

export default function AuthForm({ initialMode = 'signin', onSuccess }: AuthFormProps) {
  const router = useRouter();
  const { t } = useI18n();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        setMessage(t('auth.checkEmail'));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSuccess?.();
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message || t('auth.genericError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Brand + heading */}
      <div className="flex flex-col items-start">
        <Image
          src="/etlaq-logo.svg"
          alt=""
          width={34}
          height={32}
          className="h-[40px] w-auto md:h-[32px]"
          priority
        />
        <p className="mt-24 text-[16px] text-[#6b6577] md:mt-20">{t('auth.startBuilding')}</p>
        <h1 className="mt-4 text-[30px] font-semibold tracking-tight text-[#191622] md:text-[24px]">
          {mode === 'signin' ? t('auth.loginTitle') : t('auth.signupTitle')}
        </h1>
      </div>

      <form onSubmit={submit} className="mt-24 space-y-12 text-start">
        <input
          type="email"
          required
          placeholder={t("auth.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-12 border border-[#d4cde4] bg-white px-16 py-12 text-[15px] text-[#191622] placeholder:text-[#8b8798] transition-colors focus:border-[#6147D4] focus:outline-none focus:ring-2 focus:ring-[#6147D4]/15"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder={t("auth.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-12 border border-[#d4cde4] bg-white px-16 py-12 text-[15px] text-[#191622] placeholder:text-[#8b8798] transition-colors focus:border-[#6147D4] focus:outline-none focus:ring-2 focus:ring-[#6147D4]/15"
        />

        {error && <p className="text-[14px] text-red-600">{error}</p>}
        {message && <p className="text-[14px] text-green-600">{message}</p>}

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-8 rounded-12 bg-[#6147D4] py-12 text-center text-[15px] font-semibold text-white transition-all hover:bg-[#5238c0] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
        >
          {loading && (
            <span className="h-16 w-16 shrink-0 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
          )}
          {loading ? t('auth.pleaseWait') : mode === 'signin' ? t('auth.continue') : t('auth.createAccount')}
        </button>
      </form>

      <p className="mt-20 text-[14px] text-[#6b6577]">
        {mode === 'signin' ? t('auth.noAccount') : t('auth.haveAccount')}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setMessage(null);
          }}
          className="font-medium text-[#6147D4] hover:underline"
        >
          {mode === 'signin' ? t('auth.signUp') : t('auth.logIn')}
        </button>
      </p>
    </div>
  );
}
