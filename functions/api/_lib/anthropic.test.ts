import { describe, it, expect } from 'vitest';

// We only test the parse step of translateStory — the network call is
// hand-verified. The parse step is exported as __parseTranslation.
import { __parseTranslation } from './anthropic';

describe('__parseTranslation', () => {
  it('extracts JSON object from a raw Claude response', () => {
    const out = __parseTranslation(`Here is the translation:\n{"title":"Hej","paragraphs":["A","B"]}\n`);
    expect(out).toEqual({ title: 'Hej', paragraphs: ['A', 'B'] });
  });
  it('handles code-fenced JSON', () => {
    const out = __parseTranslation('```json\n{"title":"X","paragraphs":["Y"]}\n```');
    expect(out).toEqual({ title: 'X', paragraphs: ['Y'] });
  });
  it('throws on malformed input', () => {
    expect(() => __parseTranslation('no json here')).toThrow(/translation/i);
  });
  it('throws when paragraphs is missing', () => {
    expect(() => __parseTranslation('{"title":"x"}')).toThrow(/paragraphs/i);
  });
});
