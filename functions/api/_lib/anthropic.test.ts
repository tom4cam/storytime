import { describe, it, expect } from 'vitest';

// We only test the parse step of translateStory — the network call is
// hand-verified. The parse step is exported as __parseTranslation.
import { __parseTranslation, __coerceStoryInput, __coerceQcVerdict } from './anthropic';

describe('__coerceQcVerdict', () => {
  it('accepts a clean verdict', () => {
    expect(__coerceQcVerdict({ ok: true, problems: [] })).toEqual({ ok: true, problems: [] });
  });

  it('rejects only when not-ok AND a concrete problem is named', () => {
    expect(__coerceQcVerdict({ ok: false, problems: ['third arm'] })).toEqual({ ok: false, problems: ['third arm'] });
  });

  it('treats not-ok with no named problem as acceptable', () => {
    expect(__coerceQcVerdict({ ok: false, problems: [] }).ok).toBe(true);
  });

  it('filters blank problem strings and accepts', () => {
    const v = __coerceQcVerdict({ ok: false, problems: ['', '   '] });
    expect(v).toEqual({ ok: true, problems: [] });
  });

  it('errs toward acceptable on a malformed verdict', () => {
    expect(__coerceQcVerdict(null).ok).toBe(true);
    expect(__coerceQcVerdict('nope').ok).toBe(true);
    expect(__coerceQcVerdict({}).ok).toBe(true);
  });
});

describe('__coerceStoryInput', () => {
  it('normalises a well-formed submit_story tool input', () => {
    const out = __coerceStoryInput({
      title: 'Mo Bakes Bread',
      character_bible: 'Mo: a small brown mouse.',
      paragraphs: [
        { text: 'Mo woke up hungry.', image_prompt: 'Mo the mouse in a sunny kitchen.' },
        { text: 'He found some flour.', image_prompt: 'Mo holding a flour bag.' },
      ],
    });
    expect(out.title).toBe('Mo Bakes Bread');
    expect(out.character_bible).toBe('Mo: a small brown mouse.');
    expect(out.paragraphs).toHaveLength(2);
    expect(out.paragraphs[1]).toEqual({ text: 'He found some flour.', image_prompt: 'Mo holding a flour bag.' });
  });

  it('omits character_bible when the model leaves it blank', () => {
    const out = __coerceStoryInput({
      title: 'X',
      paragraphs: [{ text: 'A', image_prompt: 'B' }],
    });
    expect('character_bible' in out).toBe(false);
  });

  it('recovers when paragraphs arrives as a stringified JSON array', () => {
    const out = __coerceStoryInput({
      title: 'X',
      paragraphs: '[{"text":"А","image_prompt":"B"}]',
    });
    expect(out.paragraphs).toEqual([{ text: 'А', image_prompt: 'B' }]);
  });

  it('defaults a missing image_prompt to an empty string', () => {
    const out = __coerceStoryInput({ title: 'X', paragraphs: [{ text: 'A' }] });
    expect(out.paragraphs[0].image_prompt).toBe('');
  });

  it('throws when the title is missing', () => {
    expect(() => __coerceStoryInput({ paragraphs: [{ text: 'A', image_prompt: 'B' }] })).toThrow(/title/i);
  });

  it('throws when there are no paragraphs', () => {
    expect(() => __coerceStoryInput({ title: 'X', paragraphs: [] })).toThrow(/paragraph/i);
  });

  it('throws when a paragraph has no text', () => {
    expect(() => __coerceStoryInput({ title: 'X', paragraphs: [{ image_prompt: 'B' }] })).toThrow(/text/i);
  });
});

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
