import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal typings for the Web Speech API, which isn't in the DOM lib.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number;[index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

interface Options {
  // Called with each finalized chunk of transcribed text.
  onTranscript: (text: string) => void;
  lang?: string;
}

/**
 * Voice dictation via the browser's Web Speech API, plus a live mic-level meter
 * (0–1, smoothed) so callers can render a reactive waveform. Returns support and
 * listening state, a toggle, and `audioLevel`. Finalized speech is streamed to
 * `onTranscript`; the caller decides how to append it.
 */
export function useSpeechDictation({ onTranscript, lang }: Options) {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  // We stop() on demand; track it so onend doesn't auto-restart after a manual stop.
  const manualStopRef = useRef(false);

  // Audio-metering resources (kept in refs so they survive re-renders).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    setIsSupported(getRecognitionCtor() !== null);
  }, []);

  const stopMetering = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setAudioLevel(0);
  }, []);

  const startMetering = useCallback(() => {
    const Ctx = getAudioContextCtor();
    if (!Ctx || typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        // If dictation was stopped before permission resolved, bail out.
        if (manualStopRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        let smoothed = 0;
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          // Scale up quiet speech, clamp, then ease toward the new value.
          const target = Math.min(1, rms * 3.2);
          smoothed = smoothed * 0.75 + target * 0.25;
          setAudioLevel(Math.round(smoothed * 100) / 100);
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => {
        /* metering is best-effort; dictation still works without the waveform */
      });
  }, []);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    recognitionRef.current?.stop();
    stopMetering();
    setIsListening(false);
  }, [stopMetering]);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    // Reuse an existing instance if one is mid-flight.
    if (recognitionRef.current) recognitionRef.current.abort();

    const recognition = new Ctor();
    recognition.lang = lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) onTranscriptRef.current(text);
        }
      }
    };
    recognition.onerror = () => {
      manualStopRef.current = true;
      stopMetering();
      setIsListening(false);
    };
    recognition.onend = () => {
      // Chrome ends the session after a pause; restart unless we stopped on purpose.
      if (!manualStopRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          /* fall through to stopped state */
        }
      }
      stopMetering();
      setIsListening(false);
    };

    manualStopRef.current = false;
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
      startMetering();
    } catch {
      stopMetering();
      setIsListening(false);
    }
  }, [lang, startMetering, stopMetering]);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  // Tear down on unmount so the mic is released.
  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      recognitionRef.current?.abort();
      stopMetering();
    };
  }, [stopMetering]);

  return { isSupported, isListening, audioLevel, start, stop, toggle };
}

export default useSpeechDictation;
