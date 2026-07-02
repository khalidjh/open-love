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
      {/* Sidebar */}
      <aside
        className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-[#ece8f4] bg-white transition-[width] duration-200 ${
          collapsed ? "w-[68px]" : "w-[264px]"
        }`}
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
            className="flex h-28 w-28 items-center justify-center rounded-8 text-[#8b8798] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622]"
          >
            <SidebarIcon />
          </button>
        </div>

        {/* Workspace */}
        {!collapsed && (
          <div className="mx-12 mb-8 flex items-center gap-10 rounded-12 border border-[#eee9f5] px-10 py-8">
            <span className="flex h-28 w-28 items-center justify-center rounded-8 bg-[#6147D4] text-[13px] font-semibold text-white">
              {initial}
            </span>
            <span className="truncate text-[14px] font-medium">
              {firstName}&rsquo;s {PRODUCT_NAME}
            </span>
          </div>
        )}

        {/* Nav */}
        <nav className="flex flex-col gap-2 px-12">
          <NavItem href="/dashboard" active collapsed={collapsed} icon={<HomeIcon />} label="Dashboard" />
        </nav>

        {/* Recents */}
        {!collapsed && (
          <div className="mt-24 flex-1 overflow-y-auto px-12">
            {recents.length > 0 && (
              <>
                <p className="px-10 pb-6 text-[12px] font-medium uppercase tracking-wide text-[#a29db0]">
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
        <div className="relative mt-auto border-t border-[#ece8f4] p-12" ref={accountRef}>
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
            <div className="absolute bottom-full left-12 right-12 z-30 mb-8 overflow-hidden rounded-12 border border-[#eae6f3] bg-white p-6">
              <div className="px-12 py-8">
                <p className="text-[12px] text-[#8b8798]">Signed in as</p>
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
            <h1 className="text-center text-[32px] font-bold tracking-[-0.025em] text-[#17141f]">
              Ready to build, {firstName}?
            </h1>

            <div className="mt-32">
              <BuildPrompt placeholder={`Ask ${PRODUCT_NAME} to build a landing page...`} />
            </div>
          </div>

          {/* Projects */}
          <section className="pb-64">
            <div className="mb-16 flex items-center justify-between">
              <h2 className="text-[18px] font-semibold">Your projects</h2>
              <span className="text-[14px] text-[#8b8798]">
                {projects.length} {projects.length === 1 ? "project" : "projects"}
              </span>
            </div>

            {projects.length === 0 ? (
              <div className="rounded-16 border border-dashed border-[#dcd6ec] bg-white/60 p-48 text-center">
                <p className="text-[15px] text-[#6b6577]">
                  You haven&rsquo;t built anything yet. Describe an app above to get started.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p) => (
                  <Link
                    key={p.id}
                    href={`/generation?project=${p.id}`}
                    className="group flex flex-col rounded-16 border border-[#ece8f4] bg-white p-20 transition-all hover:border-[#c3b8ee]"
                  >
                    <div className="flex items-start justify-between gap-8">
                      <h3 className="truncate text-[15px] font-medium text-[#191622]">
                        {p.name}
                      </h3>
                      {p.deployUrl && (
                        <span className="shrink-0 rounded-6 bg-[#e7f7ee] px-8 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#1a7f4b]">
                          live
                        </span>
                      )}
                    </div>
                    {p.sourceUrl && (
                      <p className="mt-4 truncate text-[13px] text-[#a29db0]">{p.sourceUrl}</p>
                    )}
                    <div className="mt-20 flex items-center justify-between text-[12px] text-[#a29db0]">
                      <span className="truncate">{p.model || "app"}</span>
                      <span className="shrink-0">{timeAgo(p.updatedAt)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

/* ---------- sidebar nav item + icons ---------- */

function NavItem({
  href,
  label,
  icon,
  active = false,
  collapsed,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-10 rounded-10 px-10 py-8 text-[14px] font-medium transition-colors ${
        collapsed ? "justify-center" : ""
      } ${
        active
          ? "bg-[#f0ecfb] text-[#6147D4]"
          : "text-[#5b5668] hover:bg-[#f3f0fa] hover:text-[#191622]"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function SidebarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4V16" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M4 9L10 4L16 9V16H12V12H8V16H4V9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
