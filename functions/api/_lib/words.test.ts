import { describe, it, expect } from 'vitest';
import { charsToWords } from './words';

function fakeAlignment(text: string, msPerChar = 100) {
  const characters = [...text];
  const character_start_times_seconds = characters.map((_, i) => (i * msPerChar) / 1000);
  const character_end_times_seconds = characters.map((_, i) => ((i + 1) * msPerChar) / 1000);
  return { characters, character_start_times_seconds, character_end_times_seconds };
}

describe('charsToWords', () => {
  it('handles a single-word paragraph', () => {
    const out = charsToWords(['Hi'], fakeAlignment('Hi'));
    expect(out).toEqual([
      { paragraphIndex: 0, wordIndex: 0, word: 'Hi', start: 0.0, end: 0.2 },
    ]);
  });

  it('numbers words 0-indexed within a paragraph', () => {
    const out = charsToWords(['one two three'], fakeAlignment('one two three'));
    expect(out.map((w) => [w.wordIndex, w.word])).toEqual([
      [0, 'one'],
      [1, 'two'],
      [2, 'three'],
    ]);
  });

  it('uses the first char start and last char end for each word', () => {
    const out = charsToWords(['hi yo'], fakeAlignment('hi yo', 100));
    expect(out[0]).toMatchObject({ word: 'hi', start: 0.0, end: 0.2 });
    expect(out[1]).toMatchObject({ word: 'yo', start: 0.3, end: 0.5 });
  });

  it('starts paragraphIndex from 0 and resets wordIndex per paragraph', () => {
    const out = charsToWords(['one', 'two three'], fakeAlignment('one\n\ntwo three'));
    expect(out.map((w) => [w.paragraphIndex, w.wordIndex, w.word])).toEqual([
      [0, 0, 'one'],
      [1, 0, 'two'],
      [1, 1, 'three'],
    ]);
  });

  it('keeps punctuation attached to its word', () => {
    const out = charsToWords(['Hi, friend.'], fakeAlignment('Hi, friend.'));
    expect(out.map((w) => w.word)).toEqual(['Hi,', 'friend.']);
  });

  it('ignores leading and trailing whitespace gracefully', () => {
    const out = charsToWords(['  hi  '], fakeAlignment('  hi  '));
    expect(out.map((w) => w.word)).toEqual(['hi']);
    expect(out[0]).toMatchObject({ paragraphIndex: 0, wordIndex: 0 });
  });

  it('spreads runs of identical-start words across the gap to the next word', () => {
    // Simulates a Whisper-compressed region: three source words landed on
    // the same start time because two surrounding anchors collapsed.
    // The smoother should redistribute them across the gap to "next".
    const characters = [...'a b c d'];
    // chars: a(0) (1) b(2) (3) c(4) (5) d(6)
    // Force a,b,c to share start=1.0, end varies, and d starts at 4.0.
    const character_start_times_seconds = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 4.0];
    const character_end_times_seconds =   [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 4.0];
    const out = charsToWords(['a b c d'], {
      characters, character_start_times_seconds, character_end_times_seconds,
    });
    // Without the smoother, a/b/c would all have start=end=1.0.
    expect(out.map((w) => w.word)).toEqual(['a', 'b', 'c', 'd']);
    expect(out[0].start).toBe(1.0);
    expect(out[1].start).toBeGreaterThan(out[0].start);
    expect(out[2].start).toBeGreaterThan(out[1].start);
    expect(out[2].end).toBeLessThanOrEqual(out[3].start);
    expect(out[3].start).toBe(4.0);
  });

  it('handles three paragraphs', () => {
    const out = charsToWords(['a b', 'c', 'd e f'], fakeAlignment('a b\n\nc\n\nd e f'));
    expect(out.map((w) => [w.paragraphIndex, w.wordIndex])).toEqual([
      [0, 0], [0, 1],
      [1, 0],
      [2, 0], [2, 1], [2, 2],
    ]);
  });
});
