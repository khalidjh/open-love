// Kids have no login — their creations live in the browser. This is a tiny
// localStorage store: a stable per-creation id (used as the publish slug seed)
// plus a gallery of past creations shown on the start screen.

'use client';

export interface KidsCreation {
  id: string;
  title: string;
  prompt: string;
  html: string;
  publishUrl?: string;
  updatedAt: number;
}

const GALLERY_KEY = 'etlaq-kids:creations';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function newCreationId(): string {
  return uuid();
}

export function loadCreations(): KidsCreation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GALLERY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as KidsCreation[];
    return Array.isArray(list) ? list.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

export function saveCreation(creation: KidsCreation): void {
  if (typeof window === 'undefined') return;
  try {
    const list = loadCreations().filter((c) => c.id !== creation.id);
    list.unshift(creation);
    // Keep the gallery small so localStorage doesn't balloon with big HTML blobs.
    window.localStorage.setItem(GALLERY_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

export function deleteCreation(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const list = loadCreations().filter((c) => c.id !== id);
    window.localStorage.setItem(GALLERY_KEY, JSON.stringify(list));
  } catch {
    /* non-fatal */
  }
}
