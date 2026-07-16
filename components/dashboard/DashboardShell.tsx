"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BuildPrompt from "@/components/home/BuildPrompt";

const PRODUCT_NAME = "Etlaq";

interface ProjectItem {
  id: string;
  name: string;
  sourceUrl: string | null;
  deployUrl: string | null;
  model: string | null;
  updatedAt: string;
}

interface DashboardShellProps {
  email: string;
  name: string;
  projects: ProjectItem[];
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function DashboardShell({ email, name, projects }: DashboardShellProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  const firstName = name.charAt(0).toUpperCase() + name.slice(1);
  const initial = (name || email || "U").charAt(0).toUpperCase();
  const recents = projects.slice(0, 5);

  useEffect(() => {
    if (!accountOpen) return;
    const onClick = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [accountOpen]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen bg-[#fbfafd] text-[#191622]">
      {/* Mobile drawer backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar — off-canvas drawer on mobile, in-flow on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[264px] shrink-0 flex-col border-r border-[#d8d2e6] bg-white transition-transform duration-200 md:sticky md:top-0 md:z-auto md:translate-x-0 md:transition-[width] ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:w-[68px]" : "md:w-[264px]"}`}
      >
        {/* Brand + collapse */}
        <div className="flex items-center justify-between px-16 py-18">
          <Link href="/dashboard" className="flex items-center gap-10 overflow-hidden">
            <Image
              src="/etlaq-logo.svg"
              alt=""
              width={28}
              height={26}
              className="h-[26px] w-auto shrink-0"
              priority
            />
            {!collapsed && (
              <span className="text-[19px] font-semibold tracking-[-0.02em]">
                {PRODUCT_NAME}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label="Toggle sidebar"
            className="hidden h-28 w-28 items-center justify-center rounded-8 text-[#6b6577] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622] md:flex"
          >
            <SidebarIcon />
          </button>
          {/* Mobile drawer close */}
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
            className="flex h-28 w-28 items-center justify-center rounded-8 text-[#6b6577] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622] md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
              <path d="M5 5l10 10M15 5L5 15" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Recents */}
        {!collapsed && (
          <div className="mt-8 flex-1 overflow-y-auto px-12">
            {recents.length > 0 && (
              <>
                <p className="px-10 pb-6 text-[12px] font-medium uppercase tracking-wide text-[#8b8798]">
                  Recents
                </p>
                <div className="flex flex-col">
                  {recents.map((p) => (
                    <Link
                      key={p.id}
                      href={`/generation?project=${p.id}`}
                      className="truncate rounded-8 px-10 py-8 text-[14px] text-[#5b5668] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622]"
                    >
                      {p.name}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Account */}
        <div className="relative mt-auto border-t border-[#d8d2e6] p-12" ref={accountRef}>
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            className={`flex w-full items-center gap-10 rounded-10 px-8 py-8 transition-colors hover:bg-[#f3f0fa] ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <span className="flex h-32 w-32 shrink-0 items-center justify-center rounded-full bg-[#6147D4] text-[14px] font-semibold text-white">
              {initial}
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1 truncate text-left text-[14px] font-medium">
                {email}
              </span>
            )}
          </button>

          {accountOpen && (
            <div className="absolute bottom-full left-12 right-12 z-30 mb-8 overflow-hidden rounded-12 border border-[#d6d0e6] bg-white p-6">
              <div className="px-12 py-8">
                <p className="text-[12px] text-[#6b6577]">Signed in as</p>
                <p className="truncate text-[14px] font-medium">{email}</p>
              </div>
              <div className="my-6 h-px bg-[#eee9f5]" />
              <button
                type="button"
                onClick={signOut}
                className="block w-full rounded-8 px-12 py-8 text-left text-[14px] text-[#c0392b] transition-colors hover:bg-[#fdf0ee]"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="relative flex-1 overflow-hidden">
        {/* Mobile top bar — hamburger + centered logo */}
        <div className="relative z-20 flex items-center justify-between px-16 py-12 md:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="flex h-40 w-40 items-center justify-center rounded-full border border-[#d8d2e6] bg-white text-[#2a2635] transition-colors hover:bg-[#f3f0fa]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <Link href="/dashboard" className="flex items-center gap-8">
            <Image src="/etlaq-logo.svg" alt="" width={26} height={24} className="h-[24px] w-auto" priority />
            <span className="text-[18px] font-semibold tracking-[-0.02em]">{PRODUCT_NAME}</span>
          </Link>
          <span className="h-40 w-40" aria-hidden />
        </div>

        {/* Brand gradient wash behind the hero */}
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[520px]">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(80% 120% at 50% 0%, rgba(97,71,212,0.20) 0%, rgba(129,102,224,0.12) 34%, rgba(217,70,160,0.08) 58%, rgba(251,250,253,0) 82%)",
            }}
          />
        </div>

        <div className="relative z-10 mx-auto max-w-[860px] px-24">
          {/* Hero — vertically centered in the viewport */}
          <div className="flex min-h-[80vh] flex-col justify-center">
            <h1 className="anim-fade-up text-center text-[26px] font-bold tracking-[-0.025em] text-[#17141f] md:text-[32px]">
              Ready to build, {firstName}?
            </h1>

            {/* relative z-30: the anim-fade-up transform makes this wrapper a
                stacking context, so the z-index that lifts the open theme/attach
                dropdown above the projects list must live here, not inside BuildPrompt. */}
            <div className="relative z-30 anim-fade-up anim-delay-2 mt-32">
              <BuildPrompt placeholder={`Ask ${PRODUCT_NAME} to build a landing page...`} />
            </div>
          </div>

          {/* Projects */}
          <section className="pb-64">
            <div className="anim-fade-up anim-delay-3 mb-16 flex items-center justify-between">
              <h2 className="text-[18px] font-semibold">Your projects</h2>
              <span className="text-[14px] text-[#6b6577]">
                {projects.length} {projects.length === 1 ? "project" : "projects"}
              </span>
            </div>

            {projects.length === 0 ? (
              <div className="anim-fade-up rounded-16 border border-dashed border-[#dcd6ec] bg-white/60 p-48 text-center">
                <p className="text-[15px] text-[#6b6577]">
                  You haven&rsquo;t built anything yet. Describe an app above to get started.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p, index) => (
                  <div
                    key={p.id}
                    style={{ animationDelay: `${Math.min(index * 45, 400)}ms` }}
                    className="group anim-fade-up hover-lift relative flex flex-col rounded-16 border border-[#d8d2e6] bg-white p-20 transition-all hover:border-[#c3b8ee] hover:shadow-[0_12px_40px_rgba(97,71,212,0.12)]"
                  >
                    {/* Full-card link to the editor; interactive controls sit above it. */}
                    <Link
                      href={`/generation?project=${p.id}`}
                      aria-label={`Open ${p.name}`}
                      className="absolute inset-0 z-0 rounded-16"
                    />
                    <div className="pointer-events-none relative z-10 flex flex-1 flex-col">
                      <div className="flex items-start justify-between gap-8">
                        <h3 className="truncate text-[15px] font-medium text-[#191622]">
                          {p.name}
                        </h3>
                        <div className="flex shrink-0 items-center gap-6">
                          {p.deployUrl && (
                            <span className="rounded-6 bg-[#e7f7ee] px-8 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#1a7f4b]">
                              live
                            </span>
                          )}
                          <Link
                            href={`/dashboard/projects/${p.id}`}
                            aria-label={`Manage ${p.name}`}
                            title="Manage"
                            className="pointer-events-auto grid h-24 w-24 place-items-center rounded-8 text-[#8b8798] transition-colors hover:bg-[#f3f0fa] hover:text-[#6147D4]"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <circle cx="12" cy="12" r="3" />
                              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                            </svg>
                          </Link>
                        </div>
                      </div>
                      {p.sourceUrl && (
                        <p className="mt-4 truncate text-[13px] text-[#8b8798]">{p.sourceUrl}</p>
                      )}
                      <div className="mt-20 flex items-center justify-between text-[12px] text-[#8b8798]">
                        <span className="truncate">{p.model || "app"}</span>
                        <span className="shrink-0">{timeAgo(p.updatedAt)}</span>
                      </div>
                      <span className="mt-12 flex items-center gap-4 self-end text-[13px] font-medium text-[#6147D4] opacity-0 translate-x-[-4px] transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
                        Open
                        <span aria-hidden className="transition-transform group-hover:translate-x-1">
                          &rarr;
                        </span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

/* ---------- sidebar icons ---------- */

function SidebarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4V16" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
