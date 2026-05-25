import { useEffect, useState } from 'react';

export interface Prefs {
  slow: boolean;
}

const KEY = 'storyMaker.prefs';
const DEFAULT: Prefs = { slow: false };

function read(): Prefs {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT, ...parsed };
  } catch { return DEFAULT; }
}
function write(p: Prefs) {
  try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(read);
  useEffect(() => { write(prefs); }, [prefs]);
  return [prefs, (patch) => setPrefs((p) => ({ ...p, ...patch }))];
}
