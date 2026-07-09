'use client';

import { useEffect, useRef } from 'react';
import KidsMascot from './KidsMascot';

export interface KidsMessage {
  id: string;
  role: 'kid' | 'bot';
  text: string;
}

// The chat transcript: big speech bubbles, mascot avatar on bot messages, and a
// playful typing indicator while the app is being built.
export default function KidsChat({
  messages,
  typing = false,
}: {
  messages: KidsMessage[];
  typing?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  return (
    <div className="flex flex-col gap-6">
      {messages.map((m) => (
        <div key={m.id} className={`flex items-start gap-2 ${m.role === 'kid' ? 'flex-row-reverse' : ''}`}>
          {m.role === 'bot' && (
            <div className="shrink-0" style={{ marginTop: 2 }}>
              <KidsMascot size={40} />
            </div>
          )}
          <div className={`k-bubble k-pop ${m.role === 'kid' ? 'k-bubble--kid' : 'k-bubble--bot'}`}>
            {m.text}
          </div>
        </div>
      ))}

      {typing && (
        <div className="flex items-center gap-2">
          <div className="shrink-0">
            <KidsMascot size={40} />
          </div>
          <div className="k-bubble k-bubble--bot k-dots" aria-label="يكتب">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
