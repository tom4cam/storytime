import { describe, it, expect, beforeEach } from 'vitest';
import { __shouldSendForTest, __markSentForTest, classifyError } from './alerts';

function makeR2Stub() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      return { async text() { return v; } };
    },
    async put(key: string, value: string) { store.set(key, value); },
  };
}

describe('alerts cooldown', () => {
  let r2: ReturnType<typeof makeR2Stub>;
  beforeEach(() => { r2 = makeR2Stub(); });

  it('allows the first send for a new (provider, kind)', async () => {
    expect(await __shouldSendForTest(r2 as never, 'openai', 'http_429')).toBe(true);
  });

  it('blocks repeat send inside the cooldown window', async () => {
    await __markSentForTest(r2 as never, 'openai', 'http_429');
    expect(await __shouldSendForTest(r2 as never, 'openai', 'http_429')).toBe(false);
  });

  it('allows send after the cooldown window passes', async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    r2.store.set('alerts/last-openai-http_429.txt', past);
    expect(await __shouldSendForTest(r2 as never, 'openai', 'http_429')).toBe(true);
  });

  it('separate (provider, kind) keys do not interfere', async () => {
    await __markSentForTest(r2 as never, 'openai', 'http_429');
    expect(await __shouldSendForTest(r2 as never, 'anthropic', 'http_429')).toBe(true);
    expect(await __shouldSendForTest(r2 as never, 'openai', 'http_5xx')).toBe(true);
  });
});

describe('classifyError', () => {
  it('maps 429 to http_429', () => { expect(classifyError(429)).toBe('http_429'); });
  it('maps 500 to http_5xx', () => { expect(classifyError(500)).toBe('http_5xx'); });
  it('maps 503 to http_5xx', () => { expect(classifyError(503)).toBe('http_5xx'); });
  it('returns null for 200', () => { expect(classifyError(200)).toBeNull(); });
  it('returns null for 400', () => { expect(classifyError(400)).toBeNull(); });
  it('maps a thrown error to network_error when no status', () => {
    expect(classifyError(undefined, new Error('econnreset'))).toBe('network_error');
  });
});
