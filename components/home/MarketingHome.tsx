"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import AuthModal from "@/components/auth/AuthModal";
import BuildPrompt from "@/components/home/BuildPrompt";

const PRODUCT_NAME = "Etlaq";

export default function MarketingHome() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#fbfafd] text-[#191622]">
      {/* Layered brand mesh — a light-theme cinematic glow. */}
      <div className="pointer-events-none absolute inset-0 -z-0">
        <div
          className="absolute inset-x-0 bottom-[-20%] h-[85vh]"
          style={{
            background:
              "radial-gradient(70% 75% at 50% 100%, rgba(97,71,212,0.30) 0%, rgba(129,102,224,0.18) 32%, rgba(180,160,240,0.08) 55%, rgba(251,250,253,0) 78%)",
          }}
        />
        <div
          className="absolute left-[8%] bottom-[6%] h-[42vh] w-[42vw]"
          style={{
            background:
              "radial-gradient(circle at center, rgba(79,70,229,0.20) 0%, rgba(251,250,253,0) 68%)",
            filter: "blur(20px)",
          }}
        />
        <div
          className="absolute right-[6%] bottom-[10%] h-[40vh] w-[40vw]"
          style={{
            background:
              "radial-gradient(circle at center, rgba(217,70,160,0.16) 0%, rgba(251,250,253,0) 66%)",
            filter: "blur(20px)",
          }}
        />
        <div
          className="absolute inset-x-0 top-0 h-[30vh]"
          style={{
            background:
              "linear-gradient(180deg, rgba(251,250,253,0.9) 0%, rgba(251,250,253,0) 100%)",
          }}
        />
      </div>

      {/* Header */}
      <header
        className={`anim-fade-in sticky top-0 z-20 transition-all duration-300 ${
          scrolled
            ? "border-b border-[#eae6f3] bg-[#fbfafd]/80 backdrop-blur-md"
            : "border-b border-transparent"
        }`}
      >
        <nav
          className={`flex w-full items-center justify-between px-24 md:px-48 lg:px-80 xl:px-120 2xl:px-160 ${
            scrolled ? "py-10 md:py-12" : "py-16 md:py-20"
          }`}
        >
          <Link href="/" className="group flex items-center gap-10">
            <Image
              src="/etlaq-logo.svg"
              alt=""
              width={32}
              height={30}
              className="h-[30px] w-auto transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3"
              priority
            />
            <span className="text-[26px] font-semibold tracking-[-0.02em]">
              {PRODUCT_NAME}
            </span>
          </Link>

          <div className="flex items-center gap-10">
            <button
              type="button"
              onClick={() => {
                setAuthMode("signin");
                setAuthOpen(true);
              }}
              className="hidden md:inline-flex rounded-12 border border-[#e4e0ef] px-20 py-10 text-[15px] font-medium text-[#2a2635] transition-all hover:bg-[#f3f0fa] active:scale-[0.98]"
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("signup");
                setAuthOpen(true);
              }}
              className="rounded-12 bg-[#6147D4] px-16 md:px-20 py-9 md:py-10 text-[14px] md:text-[15px] font-semibold text-white transition-all hover:bg-[#5238c0] active:scale-[0.98]"
            >
              Get started
            </button>
            {/* Hamburger — mobile only */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={mobileMenuOpen}
              className="md:hidden flex h-40 w-40 items-center justify-center rounded-12 border border-[#e4e0ef] text-[#2a2635] transition-colors hover:bg-[#f3f0fa]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
                {mobileMenuOpen ? (
                  <path d="M6 6l12 12M18 6L6 18" strokeWidth="1.8" strokeLinecap="round" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="1.8" strokeLinecap="round" />
                )}
              </svg>
            </button>
          </div>
        </nav>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="md:hidden absolute inset-x-0 top-full z-30 mx-24 overflow-hidden rounded-16 border border-[#eae6f3] bg-white p-8 shadow-[0_12px_40px_rgba(23,20,31,0.12)]">
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setAuthMode("signin");
                setAuthOpen(true);
              }}
              className="flex w-full items-center rounded-10 px-12 py-12 text-left text-[15px] font-medium text-[#2a2635] transition-colors hover:bg-[#f3f0fa]"
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setAuthMode("signup");
                setAuthOpen(true);
              }}
              className="mt-4 flex w-full items-center rounded-10 px-12 py-12 text-left text-[15px] font-semibold text-[#6147D4] transition-colors hover:bg-[#f3f0fa]"
            >
              Get started
            </button>
          </div>
        )}
      </header>

      {/* Hero */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-24 pb-[10vh] text-center">
        <h1
          className="anim-fade-up font-bold tracking-[-0.025em] text-[#17141f]"
          style={{
            fontFamily: "var(--font-geist-sans)",
            fontSize: "clamp(2.5rem, 5.2vw, 3.75rem)",
            lineHeight: 1.05,
          }}
        >
          Build something with {PRODUCT_NAME}
        </h1>
        <p className="anim-fade-up anim-delay-2 mt-16 text-[18px] text-[#6b6577]">
          Create apps and websites by chatting with AI
        </p>

        <div className="anim-fade-up anim-delay-4 mt-40 w-full max-w-[800px]">
          <BuildPrompt />
        </div>
      </main>

      <AuthModal
        open={authOpen}
        initialMode={authMode}
        onClose={() => setAuthOpen(false)}
      />
    </div>
  );
}
