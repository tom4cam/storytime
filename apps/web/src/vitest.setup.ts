// Vitest setup: install a deterministic in-memory Web Storage.
//
// Node 25 exposes a built-in `localStorage`/`sessionStorage` as a *configurable
// accessor* that is non-functional unless launched with a valid
// --localstorage-file (its methods are missing or throw), and it shadows
// jsdom's own Storage. The accessor can also return inconsistent objects across
// calls, so probing whether it "works" is unreliable. Rather than probe, we
// replace it unconditionally on every run with a simple in-memory Storage.
// setupFiles run once per test file, so each file gets a fresh store.

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

function installStorage(target: Record<string, unknown>, name: string): void {
  try {
    Object.defineProperty(target, name, {
      value: makeMemoryStorage(),
      writable: true,
      configurable: true,
    });
  } catch {
    // Non-configurable existing property — fall back to delete + assign.
    try { delete target[name]; } catch { /* ignore */ }
    target[name] = makeMemoryStorage();
  }
}

const g = globalThis as unknown as Record<string, unknown>;
const w = (globalThis as { window?: unknown }).window;
const targets = w && w !== globalThis ? [g, w as Record<string, unknown>] : [g];

for (const target of targets) {
  installStorage(target, 'localStorage');
  installStorage(target, 'sessionStorage');
}
