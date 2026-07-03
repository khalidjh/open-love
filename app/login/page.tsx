'use client';

import Link from 'next/link';
import AuthForm from '@/components/auth/AuthForm';

export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#faf9fc] text-[#191622]">
      {/* Soft brand-tinted wash, consistent with the home page */}
      <div className="pointer-events-none absolute inset-0 -z-0">
        <div
          className="absolute inset-x-0 bottom-[-30%] h-[70vh]"
          style={{
            background:
              'radial-gradient(60% 60% at 50% 100%, rgba(97,71,212,0.16) 0%, rgba(167,139,250,0.10) 34%, rgba(250,249,252,0) 72%)',
          }}
        />
      </div>

      {/* Back to home */}
      <Link
        href="/"
        className="absolute left-24 top-24 z-20 flex items-center gap-6 text-[14px] font-medium text-[#6b6577] transition-colors hover:text-[#191622]"
      >
        <span aria-hidden>←</span> Back
      </Link>

      {/* Centered card */}
      <div className="relative z-10 flex min-h-screen items-center justify-center p-24">
        <div className="anim-scale-in w-full max-w-[420px] rounded-24 border border-[#eae6f3] bg-white p-40 shadow-[0_12px_50px_rgba(97,71,212,0.08)]">
          <AuthForm />
        </div>
      </div>
    </div>
  );
}
