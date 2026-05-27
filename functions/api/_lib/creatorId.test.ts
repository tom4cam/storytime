import { describe, it, expect } from 'vitest';
import { readCreatorId } from './creatorId';

function req(cookieHeader: string | null): Request {
  const headers = new Headers();
  if (cookieHeader !== null) headers.set('Cookie', cookieHeader);
  return new Request('https://x.test', { headers });
}

describe('readCreatorId', () => {
  it('returns the creator_id value when present', () => {
    expect(readCreatorId(req('creator_id=abc-123'))).toBe('abc-123');
  });
  it('parses creator_id when other cookies are also present', () => {
    expect(readCreatorId(req('foo=bar; creator_id=uuid-here; baz=qux'))).toBe('uuid-here');
  });
  it('returns null when the cookie is missing', () => {
    expect(readCreatorId(req('foo=bar'))).toBeNull();
  });
  it('returns null when no Cookie header is present', () => {
    expect(readCreatorId(req(null))).toBeNull();
  });
  it('returns null for an empty creator_id value', () => {
    expect(readCreatorId(req('creator_id='))).toBeNull();
  });
  it('decodes URL-encoded values', () => {
    expect(readCreatorId(req('creator_id=a%20b'))).toBe('a b');
  });
});
