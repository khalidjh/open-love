'use client';

import { useCallback, useRef, useState } from 'react';
import useSpeechDictation from '@/hooks/useSpeechDictation';
import VoiceWaveform from '@/components/shared/VoiceWaveform';

// Big, friendly input for kids: a chunky text box, a mic button (Arabic speech),
// and a bright send button. `variant="hero"` is the large start-screen version;
// `variant="chat"` is the compact one in the build screen.
export default function KidsComposer({
  onSend,
  disabled = false,
  placeholder = 'اكتب فكرتك هنا…',
  variant = 'hero',
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  variant?: 'hero' | 'chat';
}) {
  const [value, setValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const appendTranscript = useCallback((text: string) => {
    setValue((v) => (v ? `${v} ${text}` : text));
  }, []);

  const { isSupported, isListening, audioLevel, toggle } = useSpeechDictation({
    onTranscript: appendTranscript,
    lang: 'ar-SA',
  });

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
    taRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const big = variant === 'hero';

  return (
    <div
      className="k-card"
      style={{ padding: big ? 14 : 10, borderRadius: 28 }}
    >
      <div className="flex items-end gap-2">
        {/* Mic */}
        {isSupported && (
          <button
            type="button"
            onClick={toggle}
            aria-label={isListening ? 'إيقاف' : 'تكلّم'}
            className="k-btn"
            style={{
              padding: 0,
              width: big ? 56 : 46,
              height: big ? 56 : 46,
              justifyContent: 'center',
              background: isListening ? 'var(--k-coral)' : 'var(--k-sunny)',
              color: isListening ? '#fff' : 'var(--k-ink)',
              flexShrink: 0,
            }}
          >
            {isListening ? (
              <VoiceWaveform level={audioLevel} color="#fff" className="!h-6" />
            ) : (
              <span style={{ fontSize: big ? 24 : 20 }}>🎤</span>
            )}
          </button>
        )}

        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          dir="rtl"
          className="flex-1 resize-none bg-transparent outline-none"
          style={{
            fontFamily: 'var(--k-font-body)',
            fontWeight: 600,
            fontSize: big ? 20 : 17,
            color: 'var(--k-ink)',
            maxHeight: 140,
            padding: big ? '10px 8px' : '8px 6px',
          }}
        />

        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="k-btn k-btn--grape"
          style={{
            padding: 0,
            width: big ? 56 : 46,
            height: big ? 56 : 46,
            justifyContent: 'center',
            flexShrink: 0,
          }}
          aria-label="ابدأ"
        >
          <span style={{ fontSize: big ? 26 : 22 }}>🚀</span>
        </button>
      </div>
    </div>
  );
}
