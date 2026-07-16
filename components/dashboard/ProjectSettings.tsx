"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type ProjectInfo = {
  id: string;
  name: string;
  deployUrl: string | null;
  deployTarget: "static" | "fullstack" | null;
  framework: "vite" | "nextjs" | null;
  updatedAt: string;
};

// Friendly, non-technical label for what kind of app this is.
function typeLabel(p: ProjectInfo): string {
  if (p.deployTarget === "fullstack" || p.framework === "nextjs") return "Full-stack app";
  return "Website";
}

export default function ProjectSettings({ project }: { project: ProjectInfo }) {
  const router = useRouter();
  const [deployUrl, setDeployUrl] = useState(project.deployUrl);
  const [confirm, setConfirm] = useState<null | "unpublish" | "delete">(null);
  const [busy, setBusy] = useState(false);

  const isLive = Boolean(deployUrl);

  async function copyUrl() {
    if (!deployUrl) return;
    try {
      await navigator.clipboard.writeText(deployUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  }

  async function unpublish() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/deploy`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to take the app offline");
      setDeployUrl(null);
      setConfirm(null);
      toast.success("Your app is now offline");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to delete the project");
      toast.success("Project deleted");
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#fbfafd] text-[#191622]">
      <div className="mx-auto max-w-[720px] px-20 py-32">
        {/* Back */}
        <Link
          href="/dashboard"
          className="mb-24 inline-flex items-center gap-6 text-[13px] font-medium text-[#6b6577] transition-colors hover:text-[#6147D4]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
          All projects
        </Link>

        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-16">
          <div className="min-w-0">
            <h1 className="truncate text-[24px] font-semibold tracking-tight">{project.name}</h1>
            <p className="mt-2 text-[13px] text-[#8b8798]">{typeLabel(project)}</p>
          </div>
          <Link
            href={`/generation?project=${project.id}`}
            className="shrink-0 rounded-full bg-[#6147D4] px-16 py-8 text-[13px] font-medium text-white transition-colors hover:bg-[#5238c0]"
          >
            Open editor
          </Link>
        </div>

        {/* Status card */}
        <section className="mt-24 rounded-16 border border-[#ece8f4] bg-white p-24">
          <div className="flex items-center gap-8">
            <span
              className={`inline-block h-8 w-8 shrink-0 rounded-full ${isLive ? "bg-[#1a7f4b]" : "bg-[#cfc9db]"}`}
              aria-hidden
            />
            <h2 className="text-[15px] font-semibold">{isLive ? "Live" : "Not published"}</h2>
          </div>

          {isLive && deployUrl ? (
            <div className="mt-16">
              <div className="flex items-center gap-8 rounded-12 border border-[#eae6f3] bg-[#faf9fd] px-12 py-10">
                <a
                  href={deployUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#6147D4] hover:underline"
                >
                  {deployUrl.replace(/^https:\/\//, "")}
                </a>
                <button
                  type="button"
                  onClick={copyUrl}
                  title="Copy link"
                  className="grid h-28 w-28 shrink-0 place-items-center rounded-8 text-[#6b6577] transition-colors hover:bg-[#f3f0fa] hover:text-[#6147D4]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
                <a
                  href={deployUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Visit site"
                  className="grid h-28 w-28 shrink-0 place-items-center rounded-8 text-[#6b6577] transition-colors hover:bg-[#f3f0fa] hover:text-[#6147D4]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M15 3h6v6" />
                    <path d="M10 14 21 3" />
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  </svg>
                </a>
              </div>
              <div className="mt-16 flex items-center gap-8">
                <button
                  type="button"
                  onClick={() => setConfirm("unpublish")}
                  className="rounded-full border border-[#e2ddef] bg-white px-16 py-8 text-[13px] font-medium text-[#5a5566] transition-colors hover:border-[#c3b8ee] hover:text-[#6147D4]"
                >
                  Take offline
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-12 text-[14px] leading-relaxed text-[#6b6577]">
              This app isn&rsquo;t online yet. Open the editor and press{" "}
              <span className="font-medium text-[#191622]">Publish</span> to give it a live link
              anyone can visit.
            </p>
          )}
        </section>

        {/* Danger zone */}
        <section className="mt-24 rounded-16 border border-[#f3d9d4] bg-white p-24">
          <h2 className="text-[15px] font-semibold text-[#191622]">Delete this project</h2>
          <p className="mt-6 text-[14px] leading-relaxed text-[#6b6577]">
            This permanently removes the project, its live site, and its history. This can&rsquo;t be
            undone.
          </p>
          <button
            type="button"
            onClick={() => setConfirm("delete")}
            className="mt-16 rounded-full border border-[#e7bcb4] bg-white px-16 py-8 text-[13px] font-medium text-[#c0392b] transition-colors hover:bg-[#fdf0ee]"
          >
            Delete project
          </button>
        </section>
      </div>

      {/* Confirm dialogs */}
      {confirm === "unpublish" && (
        <ConfirmDialog
          title="Take this app offline?"
          body="Your live link will stop working. You can publish it again anytime from the editor."
          confirmLabel="Take offline"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={unpublish}
        />
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          title={`Delete "${project.name}"?`}
          body="This permanently deletes the project, takes its live site offline, and removes its history. This can't be undone."
          confirmLabel="Delete project"
          danger
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-20"
      onClick={busy ? undefined : onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="anim-fade-up w-full max-w-[400px] rounded-16 border border-[#ece8f4] bg-white p-24 shadow-[0_20px_60px_rgba(24,22,34,0.18)]"
      >
        <h3 className="text-[16px] font-semibold text-[#191622]">{title}</h3>
        <p className="mt-8 text-[14px] leading-relaxed text-[#6b6577]">{body}</p>
        <div className="mt-24 flex items-center justify-end gap-8">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full px-16 py-8 text-[13px] font-medium text-[#5a5566] transition-colors hover:bg-[#f3f0fa] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-full px-16 py-8 text-[13px] font-medium text-white transition-colors disabled:opacity-60 ${
              danger ? "bg-[#c0392b] hover:bg-[#a93226]" : "bg-[#6147D4] hover:bg-[#5238c0]"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
