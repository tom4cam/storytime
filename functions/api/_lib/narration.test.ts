import { describe, it, expect } from 'vitest';
import { hashParagraph, __stitchAlignments } from './narration';

describe('hashParagraph', () => {
  it('is deterministic for the same voice + text', async () => {
    const a = await hashParagraph('daniel', 'Hello world.');
    const b = await hashParagraph('daniel', 'Hello world.');
    expect(a).toEqual(b);
  });

  it('changes when the text changes', async () => {
    const a = await hashParagraph('daniel', 'Hello world.');
    const b = await hashParagraph('daniel', 'Hello world!');
    expect(a).not.toEqual(b);
  });

  it('changes when the voice changes', async () => {
    const a = await hashParagraph('daniel', 'Hello world.');
    const b = await hashParagraph('fable', 'Hello world.');
    expect(a).not.toEqual(b);
  });

  it('treats undefined voice as empty', async () => {
    const a = await hashParagraph(undefined, 'Hi.');
    const b = await hashParagraph('', 'Hi.');
    expect(a).toEqual(b);
  });
});

describe('__stitchAlignments', () => {
  it('offsets later paragraphs by the cumulative duration and inserts zero-duration joiner chars', () => {
    // Paragraph 1: "Hi" — 2 chars over 1 second.
    // Paragraph 2: "Yo" — 2 chars over 0.5 seconds, but as part of the stitched
    // timeline must start at t=1 (= paragraph 1's end), not t=0.
    const p1 = {
      characters: ['H', 'i'],
      character_start_times_seconds: [0, 0.5],
      character_end_times_seconds: [0.5, 1.0],
    };
    const p2 = {
      characters: ['Y', 'o'],
      character_start_times_seconds: [0, 0.25],
      character_end_times_seconds: [0.25, 0.5],
    };
    const stitched = __stitchAlignments(['Hi', 'Yo'], [p1, p2]);
    expect(stitched.characters).toEqual(['H', 'i', '\n', '\n', 'Y', 'o']);
    expect(stitched.character_start_times_seconds).toEqual([0, 0.5, 1.0, 1.0, 1.0, 1.25]);
    expect(stitched.character_end_times_seconds).toEqual([0.5, 1.0, 1.0, 1.0, 1.25, 1.5]);
  });

  it('handles a single paragraph with no joiner', () => {
    const p1 = {
      characters: ['A'],
      character_start_times_seconds: [0],
      character_end_times_seconds: [0.5],
    };
    const stitched = __stitchAlignments(['A'], [p1]);
    expect(stitched.characters).toEqual(['A']);
    expect(stitched.character_end_times_seconds).toEqual([0.5]);
  });
});
