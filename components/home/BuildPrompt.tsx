"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { appConfig } from "@/config/app.config";
import { useSpeechDictation } from "@/hooks/useSpeechDictation";
import VoiceWaveform from "@/components/shared/VoiceWaveform";
import { toast } from "sonner";

const PRODUCT_NAME = "Etlaq";

const ROTATING_PLACEHOLDERS = [
  `Ask ${PRODUCT_NAME} to build a landing page…`,
  "…a todo app with a dark mode",
  "…a portfolio site for a photographer",
  "…a pricing page with three tiers",
];

interface Attachment {
  id: string;
  name: string;
  kind: "image" | "file";
  text?: string;
  dataUrl?: string;
}

interface Theme {
  id: string;
  label: string;
  swatches: string[]; // preview dots
  instruction: string; // the design steer sent to the model
}

// Friendly, non-technical color themes. `instruction` carries the concrete hexes
// so the model has a strong palette to honor; `swatches` are just for the preview.
const THEMES: Theme[] = [
  {
    id: "ocean",
    label: "Ocean",
    swatches: ["#0EA5E9", "#0F766E", "#E0F2FE"],
    instruction:
      "a cool ocean palette — deep teal and sky-blue accents (#0EA5E9, #0F766E) on airy near-white backgrounds (#F0F9FF), with slate text",
  },
  {
    id: "sunset",
    label: "Sunset",
    swatches: ["#F97316", "#DB2777", "#FFF7ED"],
    instruction:
      "a warm sunset palette — orange and pink accents (#F97316, #DB2777) on soft cream backgrounds (#FFF7ED), with warm dark text",
  },
  {
    id: "forest",
    label: "Forest",
    swatches: ["#16A34A", "#065F46", "#F0FDF4"],
    instruction:
      "a fresh forest palette — rich greens (#16A34A, #065F46) on warm off-white backgrounds (#F0FDF4), calm and natural",
  },
  {
    id: "midnight",
    label: "Midnight",
    swatches: ["#0B0B0F", "#7C3AED", "#22D3EE"],
    instruction:
      "a dark, moody theme — near-black backgrounds (#0B0B0F, #16151D) with electric violet and cyan accents (#7C3AED, #22D3EE) and light text",
  },
  {
    id: "candy",
    label: "Candy",
    swatches: ["#EC4899", "#8B5CF6", "#FDF2F8"],
    instruction:
      "a playful candy palette — vibrant pink and purple (#EC4899, #8B5CF6) on light backgrounds (#FDF2F8), fun and energetic",
  },
  {
    id: "mono",
    label: "Minimal",
    swatches: ["#111111", "#6B7280", "#FFFFFF"],
    instruction:
      "a minimal monochrome palette — black, white, and neutral grays with a single sharp accent, lots of whitespace and clean typography",
  },
  {
    id: "royal",
    label: "Royal",
    swatches: ["#6147D4", "#A78BFA", "#F5F2FE"],
    instruction:
      "a refined purple palette — deep violet as the dominant color (#6147D4) with lavender accents (#A78BFA) on light backgrounds (#F5F2FE)",
  },
  {
    id: "earth",
    label: "Earth",
    swatches: ["#C2410C", "#92400E", "#FEF3C7"],
    instruction:
      "a warm earthy palette — terracotta and clay tones (#C2410C, #92400E) on sandy backgrounds (#FEF3C7), grounded and organic",
  },
];

/**
 * The free-text "describe what to build" box. Stores the prompt (+ any attached
 * file contents and reference images) in sessionStorage and routes to /generation,
 * which auto-starts. Attached images are sent to the AI as vision input.
 * Shared between the marketing home and the logged-in dashboard.
 */
export default function BuildPrompt({ placeholder }: { placeholder?: string }) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [customTheme, setCustomTheme] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [phIndex, setPhIndex] = useState(0);
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  // Voice dictation: append transcribed speech to the prompt, spacing it out.
  const { isSupported: micSupported, isListening: micListening, audioLevel, toggle: toggleMic, stop: stopMic } = useSpeechDictation({
    onTranscript: (text) => {
      setPrompt((prev) => (prev ? `${prev.replace(/\s+$/, "")} ${text}` : text));
    },
  });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [prompt]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [attachMenuOpen]);

  useEffect(() => {
    if (!themeMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [themeMenuOpen]);

  // Gently cycle the placeholder while the box is untouched and no override is set.
  useEffect(() => {
    if (placeholder || prompt) return;
    const id = setInterval(() => {
      setPhIndex((i) => (i + 1) % ROTATING_PLACEHOLDERS.length);
    }, 3200);
    return () => clearInterval(id);
  }, [placeholder, prompt]);

  const handleAttachFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file, i) => {
      const isImage = file.type.startsWith("image/");
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setAttachments((prev) => [
          ...prev,
          {
            id: `${file.name}-${prev.length}-${i}`,
            name: file.name,
            kind: isImage ? "image" : "file",
            text: isImage ? undefined : result,
            dataUrl: isImage ? result : undefined,
          },
        ]);
      };
      if (isImage) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
  };

  const handleSubmit = () => {
    const value = prompt.trim();
    const fileAtts = attachments.filter((a) => a.kind === "file");
    const imageAtts = attachments
      .filter((a) => a.kind === "image" && a.dataUrl)
      .map((a) => a.dataUrl as string);
    if (!value && attachments.length === 0) {
      toast.error("Describe what you want to build");
      textareaRef.current?.focus();
      return;
    }
    const finalPrompt =
      value || (imageAtts.length ? "Build from the attached image(s)." : "Build using the attached file(s).");
    sessionStorage.setItem("initialBuildPrompt", finalPrompt);
    sessionStorage.setItem("selectedModel", appConfig.ai.defaultModel);
    sessionStorage.setItem("autoStart", "true");
    if (fileAtts.length) {
      sessionStorage.setItem(
        "initialBuildAttachments",
        JSON.stringify(fileAtts.map((a) => ({ name: a.name, text: a.text })))
      );
    } else {
      sessionStorage.removeItem("initialBuildAttachments");
    }
    if (imageAtts.length) {
      // Data URLs are large; sessionStorage can throw QuotaExceededError. Degrade
      // gracefully to a text-only build rather than blocking the user.
      try {
        sessionStorage.setItem("initialBuildImages", JSON.stringify(imageAtts));
      } catch {
        sessionStorage.removeItem("initialBuildImages");
        toast.error("Those images are a bit large to send — try smaller ones.");
      }
    } else {
      sessionStorage.removeItem("initialBuildImages");
    }
    // Optional color theme / palette the user picked for the generated site.
    if (activeTheme) {
      sessionStorage.setItem(
        "initialBuildTheme",
        JSON.stringify({ label: activeTheme.label, instruction: activeTheme.instruction })
      );
    } else {
      sessionStorage.removeItem("initialBuildTheme");
    }
    router.push("/generation");
  };

  const hasImages = attachments.some((a) => a.kind === "image");

  // Resolve the currently chosen theme (preset or custom free-text), or null.
  const activeTheme: { label: string; instruction: string } | null =
    selectedThemeId === "custom"
      ? customTheme.trim()
        ? { label: "Custom", instruction: customTheme.trim() }
        : null
      : (() => {
          const t = THEMES.find((x) => x.id === selectedThemeId);
          return t ? { label: t.label, instruction: t.instruction } : null;
        })();

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleAttachFiles(e.dataTransfer.files);
      }}
      className={`relative rounded-28 border border-white/70 bg-white/90 p-24 text-left shadow-[0_8px_40px_rgba(97,71,212,0.06)] backdrop-blur-xl transition-all duration-300 focus-within:border-[#c3b8ee] focus-within:shadow-[0_12px_50px_rgba(97,71,212,0.14)] ${isDragging ? "border-dashed border-[#6147D4] bg-[#f5f2fe]" : ""}`}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-28 bg-[#f5f2fe]/85 backdrop-blur-[2px] animate-in fade-in duration-150">
          <span className="text-[15px] font-semibold text-[#6147D4]">Drop to attach</span>
        </div>
      )}
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="mb-12 flex flex-wrap gap-8">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="anim-scale-in relative flex items-center gap-8 rounded-10 border border-[#e7e3f0] bg-[#faf9fc] py-6 pl-8 pr-24 text-[13px] text-[#2a2635]"
            >
              {a.kind === "image" && a.dataUrl ? (
                <img src={a.dataUrl} alt="" className="h-28 w-28 rounded-6 object-cover" />
              ) : (
                <span className="flex h-28 w-28 items-center justify-center rounded-6 bg-[#f0ecfb] text-[#6147D4]">
                  <FileIcon />
                </span>
              )}
              <span className="max-w-[160px] truncate">{a.name}</span>
              {a.kind === "image" && (
                <span className="rounded-4 bg-[#ece7fb] px-4 text-[10px] font-medium text-[#6147D4]">
                  vision
                </span>
              )}
              <button
                onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                className="absolute right-6 top-1/2 -translate-y-1/2 text-[#a29db0] hover:text-[#191622]"
                aria-label="Remove attachment"
              >
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor">
                  <path d="M5 5l10 10M15 5L5 15" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      {hasImages && (
        <p className="mb-8 px-4 text-[12px] text-[#8b8798]">
          Etlaq will look at your image(s) and build to match — great for a logo, a screenshot, or a design you like.
        </p>
      )}

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
        placeholder={placeholder ?? ROTATING_PLACEHOLDERS[phIndex]}
        className="max-h-[220px] min-h-[96px] w-full resize-none bg-transparent px-4 py-4 text-[16px] leading-relaxed text-[#191622] placeholder:text-[#a29db0] focus:outline-none"
      />

      <div className="mt-12 flex items-center justify-between">
       <div className="flex items-center gap-6">
        {/* Attach ("+") */}
        <div className="relative" ref={attachMenuRef}>
          <input
            ref={attachInputRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.csv"
            className="hidden"
            onChange={(e) => {
              handleAttachFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => setAttachMenuOpen((v) => !v)}
            aria-label="Add attachment"
            className="flex h-40 w-40 items-center justify-center rounded-full text-[#8b8798] transition-colors hover:bg-[#f3f0fa] hover:text-[#191622]"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor">
              <path d="M10 4v12M4 10h12" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
          {attachMenuOpen && (
            <div className="absolute top-full left-0 z-40 mt-8 w-[230px] overflow-hidden rounded-12 border border-[#eae6f3] bg-white p-6 animate-in fade-in slide-in-from-top-1 duration-150">
              <button
                type="button"
                onClick={() => {
                  setAttachMenuOpen(false);
                  attachInputRef.current?.click();
                }}
                className="flex w-full items-center gap-10 rounded-8 px-10 py-8 text-left text-[14px] font-medium text-[#2a2635] transition-colors hover:bg-[#f3f0fa]"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" className="text-[#8b8798]">
                  <path d="M13 7l-5 5a2 2 0 002.8 2.8l5.7-5.7a3.5 3.5 0 00-5-5l-6 6a5 5 0 007 7l4.5-4.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Attach file or image
              </button>
            </div>
          )}
        </div>

        {/* Themes / color palette */}
        <div className="relative" ref={themeMenuRef}>
          <button
            type="button"
            onClick={() => setThemeMenuOpen((v) => !v)}
            aria-label="Choose a color theme"
            aria-expanded={themeMenuOpen}
            className={`flex h-40 items-center gap-6 rounded-full pl-10 pr-14 text-[13px] font-medium transition-colors ${
              activeTheme
                ? "bg-[#f0ecfb] text-[#6147D4]"
                : "text-[#8b8798] hover:bg-[#f3f0fa] hover:text-[#191622]"
            }`}
          >
            <PaletteIcon />
            {activeTheme?.label ?? "Themes"}
          </button>
          {themeMenuOpen && (
            <div className="absolute top-full left-0 z-40 mt-8 w-[300px] rounded-14 border border-[#eae6f3] bg-white p-10 shadow-[0_12px_40px_rgba(25,22,34,0.10)] animate-in fade-in slide-in-from-top-1 duration-150">
              <p className="px-4 pb-8 text-[12px] font-medium text-[#8b8798]">
                Pick a look for your site
              </p>
              <div className="grid grid-cols-2 gap-6">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSelectedThemeId(t.id);
                      setThemeMenuOpen(false);
                    }}
                    className={`flex items-center gap-8 rounded-10 border px-8 py-8 text-left transition-colors ${
                      selectedThemeId === t.id
                        ? "border-[#6147D4] bg-[#f6f3fe]"
                        : "border-[#eee9f3] hover:bg-[#faf9fc]"
                    }`}
                  >
                    <span className="flex -space-x-4">
                      {t.swatches.map((c, i) => (
                        <span
                          key={i}
                          className="h-16 w-16 rounded-full border border-white"
                          style={{ background: c }}
                        />
                      ))}
                    </span>
                    <span className="text-[13px] font-medium text-[#2a2635]">{t.label}</span>
                  </button>
                ))}
              </div>
              <div className="mt-10 border-t border-[#f0edf6] pt-10">
                <input
                  value={customTheme}
                  onChange={(e) => {
                    setCustomTheme(e.target.value);
                    setSelectedThemeId("custom");
                  }}
                  placeholder="Or describe your own colors…"
                  className="w-full rounded-8 border border-[#eae6f3] px-10 py-8 text-[13px] text-[#191622] placeholder:text-[#a29db0] transition-colors focus:border-[#c3b8ee] focus:outline-none"
                />
              </div>
              {activeTheme && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedThemeId(null);
                    setCustomTheme("");
                    setThemeMenuOpen(false);
                  }}
                  className="mt-8 px-4 text-[12px] text-[#a29db0] transition-colors hover:text-[#6147D4]"
                >
                  Clear theme
                </button>
              )}
            </div>
          )}
        </div>
       </div>

        <div className="flex items-center gap-6">
          {/* Live waveform while dictating */}
          {micListening && (
            <div className="anim-scale-in mr-2 flex items-center gap-8 rounded-full bg-[#f3f0fa] px-12 py-6">
              <VoiceWaveform level={audioLevel} />
              <span className="text-[12px] font-medium text-[#6147D4]">Listening…</span>
            </div>
          )}
          {/* Voice dictation */}
          {micSupported && (
            <button
              type="button"
              onClick={toggleMic}
              aria-label={micListening ? "Stop dictation" : "Dictate with microphone"}
              aria-pressed={micListening}
              title={micListening ? "Stop dictation" : "Dictate"}
              className={`relative flex h-44 w-44 items-center justify-center rounded-full transition-colors ${
                micListening
                  ? "bg-[#6147D4] text-white"
                  : "text-[#8b8798] hover:bg-[#f3f0fa] hover:text-[#191622]"
              }`}
            >
              {micListening && (
                <span
                  className="absolute inset-0 rounded-full bg-[#6147D4]/25"
                  style={{ transform: `scale(${1 + audioLevel * 0.5})`, transition: "transform 100ms ease-out" }}
                  aria-hidden
                />
              )}
              {micListening ? <StopIcon /> : <MicIcon />}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              stopMic();
              handleSubmit();
            }}
            disabled={!prompt.trim() && attachments.length === 0}
            aria-label="Build"
            className="flex h-44 w-44 items-center justify-center rounded-full bg-[#6147D4] text-white transition-all hover:bg-[#5238c0] hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:bg-[#cabff1] disabled:text-white disabled:hover:scale-100"
          >
            <ArrowUp />
          </button>
        </div>
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

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden className="relative">
      <rect x="7.25" y="2.5" width="5.5" height="9" rx="2.75" strokeWidth="1.5" />
      <path
        d="M4.5 9a5.5 5.5 0 0011 0M10 14.5v3M7 17.5h6"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden className="relative">
      <rect x="5" y="5" width="10" height="10" rx="2.5" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M10 2.5c-4.14 0-7.5 3.13-7.5 7 0 3.04 2.46 4.5 4.5 4.5.9 0 1.5.6 1.5 1.5 0 .74.6 1.5 1.5 1.5 3.87 0 7.5-3.36 7.5-7.5 0-3.87-3.36-7-7.5-7z"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="6.5" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="10" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M5 3h6l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M11 3v4h4" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
