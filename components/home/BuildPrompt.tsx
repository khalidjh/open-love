"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { appConfig } from "@/config/app.config";
import { toast } from "sonner";

const PRODUCT_NAME = "Etlaq";

/**
 * The free-text "describe what to build" box. Stores the prompt in
 * sessionStorage and routes to /generation, which auto-starts the build.
 * The model is fixed to the app default (not surfaced to the user).
 * Shared between the marketing home and the logged-in dashboard.
 */
export default function BuildPrompt({ placeholder }: { placeholder?: string }) {
  const [prompt, setPrompt] = useState("");
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [prompt]);

  const handleSubmit = () => {
    const value = prompt.trim();
    if (!value) {
      toast.error("Describe what you want to build");
      textareaRef.current?.focus();
      return;
    }
    sessionStorage.setItem("initialBuildPrompt", value);
    sessionStorage.setItem("selectedModel", appConfig.ai.defaultModel);
    sessionStorage.setItem("autoStart", "true");
    router.push("/generation");
  };

  return (
    <div className="rounded-28 border border-white/70 bg-white/90 p-24 text-left shadow-[0_2px_6px_rgba(25,22,34,0.04),0_24px_60px_-12px_rgba(97,71,212,0.28)] backdrop-blur-xl transition-colors focus-within:border-[#c3b8ee]">
      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        rows={1}
        placeholder={placeholder ?? `Ask ${PRODUCT_NAME} to build a landing page...`}
        className="max-h-[220px] min-h-[96px] w-full resize-none bg-transparent px-4 py-4 text-[16px] leading-relaxed text-[#191622] placeholder:text-[#a29db0] focus:outline-none"
      />

      <div className="mt-12 flex items-center justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!prompt.trim()}
          aria-label="Build"
          className="flex h-44 w-44 items-center justify-center rounded-full bg-[#6147D4] text-white shadow-[0_2px_10px_rgba(97,71,212,0.4)] transition-all hover:bg-[#5238c0] hover:scale-105 disabled:cursor-not-allowed disabled:bg-[#cabff1] disabled:text-white disabled:shadow-none disabled:hover:scale-100"
        >
          <ArrowUp />
        </button>
      </div>
    </div>
  );
}

function ArrowUp() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 16V4M10 4L5 9M10 4L15 9"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
