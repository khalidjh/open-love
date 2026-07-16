import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface CodeApplicationState {
  stage: 'analyzing' | 'installing' | 'applying' | 'complete' | null;
  packages?: string[];
  installedPackages?: string[];
  filesGenerated?: string[];
  message?: string;
}

interface CodeApplicationProgressProps {
  state: CodeApplicationState;
}

export default function CodeApplicationProgress({ state }: CodeApplicationProgressProps) {
  if (!state.stage || state.stage === 'complete') return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="loading"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
        className="inline-flex items-center rounded-14 border border-[#d8d2e6] bg-white px-14 py-12 mt-2"
      >
        <div className="flex items-center gap-10">
          {/* Rotating loading indicator */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-16 h-16 shrink-0"
          >
            <svg className="w-full h-full" viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="31.416"
                strokeDashoffset="10"
                className="text-[#6147D4]"
              />
            </svg>
          </motion.div>

          {/* Simple loading text */}
          <div className="text-[14px] font-medium text-[#2a2635]">
            Applying to sandbox…
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}