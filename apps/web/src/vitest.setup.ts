// Vitest setup: fix Node 25's broken built-in localStorage stub.
// Node 25 exposes `globalThis.localStorage` when no --localstorage-file is
// given, but its methods are missing or throw. jsdom tests need a real
// in-memory Storage. We probe the implementation by actually calling it and
// replace it (on both globalThis and window) when it misbehaves.

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    key(n: number) { return [...store.keys()][n] ?? null; },
    getItem(k: string) { return store.get(k) ?? null; },
    setItem(k: string, v: string) { store.set(k, String(v)); },
    removeItem(k: string) { store.delete(k); },
    clear() { store.clear(); },
  };
}

function storageBroken(s: unknown): boolean {
  if (!s) return true;
  const st = s as Storage;
  try {
    if (typeof st.getItem !== 'function' || typeof st.setItem !== 'function'
      || typeof st.removeItem !== 'function' || typeof st.clear !== 'function') return true;
    st.setItem('__vitest_probe__', '1');
    const ok = st.getItem('__vitest_probe__') === '1';
    st.removeItem('__vitest_probe__');
    return !ok;
  } catch {
    return true;
  }
}

const targets: Array<Record<string, unknown>> = [globalThis as unknown as Record<string, unknown>];
const w = (globalThis as { window?: unknown }).window;
if (w && w !== globalThis) targets.push(w as Record<string, unknown>);

for (const target of targets) {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (storageBroken(target[name])) {
      Object.defineProperty(target, name, {
        value: makeMemoryStorage(),
        writable: true,
        configurable: true,
      });
    }
  }
}
