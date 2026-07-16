"use client";

import { Toaster } from "sonner";

/**
 * App-wide toast host. Sonner's `toast()` calls (e.g. in BuildPrompt) only
 * render if a <Toaster> is mounted — this is it. Styled to match the Etlaq
 * light theme (purple accent, rounded-12, soft shadow) with a gentle slide.
 */
export default function AppToaster() {
  return (
    <Toaster
      position="top-center"
      theme="light"
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-12 !border !border-[#d6d0e6] !bg-white !text-[#191622] !shadow-[0_12px_40px_rgba(23,20,31,0.12)]",
          title: "!text-[14px] !font-medium",
          description: "!text-[13px] !text-[#6b6577]",
          actionButton: "!rounded-8 !bg-[#6147D4] !text-white",
          cancelButton: "!rounded-8 !bg-[#f3f0fa] !text-[#5b5668]",
          error: "!text-[#b23b2e]",
          success: "!text-[#191622]",
        },
      }}
    />
  );
}
