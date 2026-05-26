import { describe, it, expect } from 'vitest';
import { alignWhisperToSource } from './tts';
import { charsToWords } from './words';

type WhisperWord = { word: string; start: number; end: number };

function near(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

describe('alignWhisperToSource', () => {
  it('uses exact whisper times when words match exactly', () => {
    const source = 'Hi yo';
    const whisper: WhisperWord[] = [
      { word: 'Hi', start: 0, end: 0.2 },
      { word: 'yo', start: 0.3, end: 0.5 },
    ];
    const out = alignWhisperToSource(source, whisper);
    expect(out.characters.join('')).toBe(source);
    // First char of "Hi" starts at 0
    expect(out.character_start_times_seconds[0]).toBe(0);
    // Last char of "Hi" ends at 0.2
    expect(out.character_end_times_seconds[1]).toBe(0.2);
    // First char of "yo" starts at 0.3
    expect(out.character_start_times_seconds[3]).toBe(0.3);
    // Last char of "yo" ends at 0.5
    expect(out.character_end_times_seconds[4]).toBe(0.5);
  });

  it('handles punctuation by stripping it for matching but keeping it in source chars', () => {
    const source = 'Hi, friend.';
    const whisper: WhisperWord[] = [
      { word: 'Hi', start: 0, end: 0.2 },
      { word: 'friend', start: 0.3, end: 0.9 },
    ];
    const out = alignWhisperToSource(source, whisper);
    expect(out.characters.join('')).toBe(source);
    // "Hi," (3 chars including comma) spans 0 → 0.2
    // "friend." spans 0.3 → 0.9
    expect(out.character_start_times_seconds[0]).toBe(0);
    expect(out.character_start_times_seconds[4]).toBe(0.3);
  });

  it('interpolates timing for a source word that whisper dropped', () => {
    const source = 'one two three';
    const whisper: WhisperWord[] = [
      { word: 'one', start: 0, end: 0.3 },
      { word: 'three', start: 0.7, end: 1.0 },
    ];
    const out = alignWhisperToSource(source, whisper);
    // "two" has no match. Its first char start must be > 0.3 and < 0.7,
    // and its last char end must also fall in (0.3, 0.7).
    const twoStartIdx = source.indexOf('two');
    const twoEndIdx = twoStartIdx + 'two'.length - 1;
    const ts = out.character_start_times_seconds[twoStartIdx];
    const te = out.character_end_times_seconds[twoEndIdx];
    expect(ts).toBeGreaterThan(0.3);
    expect(ts).toBeLessThan(0.7);
    expect(te).toBeGreaterThan(ts);
    expect(te).toBeLessThanOrEqual(0.7);
  });

  it('discards extra whisper words that have no source match', () => {
    const source = 'hi yo';
    const whisper: WhisperWord[] = [
      { word: 'hi', start: 0, end: 0.2 },
      { word: 'oh', start: 0.22, end: 0.28 }, // hallucinated insertion
      { word: 'yo', start: 0.3, end: 0.5 },
    ];
    const out = alignWhisperToSource(source, whisper);
    expect(out.character_start_times_seconds[0]).toBe(0);
    expect(out.character_end_times_seconds[1]).toBe(0.2);
    expect(out.character_start_times_seconds[3]).toBe(0.3);
    expect(out.character_end_times_seconds[4]).toBe(0.5);
  });

  it('treats a misheard substitution as a positional match', () => {
    // Whisper hears "Rob" instead of "Bob" — we still want Bob's time to align.
    const source = 'Bob jumped';
    const whisper: WhisperWord[] = [
      { word: 'Rob', start: 0, end: 0.3 },
      { word: 'jumped', start: 0.4, end: 0.9 },
    ];
    const out = alignWhisperToSource(source, whisper);
    // "Bob" should get Rob's time
    expect(out.character_start_times_seconds[0]).toBe(0);
    expect(out.character_end_times_seconds[2]).toBe(0.3);
    expect(out.character_start_times_seconds[4]).toBe(0.4);
  });

  it('produces an alignment compatible with charsToWords for multi-paragraph text', () => {
    const paragraphs = ['one', 'two three'];
    const source = paragraphs.join('\n\n');
    const whisper: WhisperWord[] = [
      { word: 'one', start: 0, end: 0.3 },
      { word: 'two', start: 0.5, end: 0.8 },
      { word: 'three', start: 0.9, end: 1.4 },
    ];
    const alignment = alignWhisperToSource(source, whisper);
    const words = charsToWords(paragraphs, alignment);
    expect(words.map((w) => [w.paragraphIndex, w.wordIndex, w.word])).toEqual([
      [0, 0, 'one'],
      [1, 0, 'two'],
      [1, 1, 'three'],
    ]);
    expect(near(words[0].start, 0)).toBe(true);
    expect(near(words[0].end, 0.3)).toBe(true);
    expect(near(words[1].start, 0.5)).toBe(true);
    expect(near(words[2].end, 1.4)).toBe(true);
  });

  it('handles case-insensitive and unicode (Swedish) matching', () => {
    const source = 'Hej Älskar';
    const whisper: WhisperWord[] = [
      { word: 'hej', start: 0, end: 0.3 },
      { word: 'älskar', start: 0.4, end: 1.0 },
    ];
    const out = alignWhisperToSource(source, whisper);
    expect(out.character_start_times_seconds[0]).toBe(0);
    expect(out.character_start_times_seconds[4]).toBe(0.4); // 'Ä'
    expect(out.character_end_times_seconds[9]).toBe(1.0);   // 'r'
  });

  it('falls back to uniform distribution when whisper returns no words', () => {
    const source = 'hi there';
    const out = alignWhisperToSource(source, [], { totalDuration: 1.0 });
    expect(out.characters.length).toBe(source.length);
    expect(out.character_start_times_seconds[0]).toBe(0);
    // All times monotonic non-decreasing
    for (let i = 1; i < out.character_start_times_seconds.length; i += 1) {
      expect(out.character_start_times_seconds[i]).toBeGreaterThanOrEqual(
        out.character_start_times_seconds[i - 1]
      );
    }
    // Last char ends near totalDuration
    expect(out.character_end_times_seconds[source.length - 1]).toBeCloseTo(1.0, 5);
  });

  it('returns monotonically non-decreasing character times', () => {
    const source = 'The quick brown fox jumps over the lazy dog.';
    const whisper: WhisperWord[] = [
      { word: 'The', start: 0, end: 0.2 },
      { word: 'quick', start: 0.25, end: 0.55 },
      { word: 'brown', start: 0.6, end: 0.95 },
      // "fox" missing — drift sim
      { word: 'jumps', start: 1.3, end: 1.7 },
      { word: 'over', start: 1.75, end: 2.0 },
      { word: 'the', start: 2.05, end: 2.2 },
      { word: 'lazy', start: 2.3, end: 2.65 },
      { word: 'dog', start: 2.7, end: 3.1 },
    ];
    const out = alignWhisperToSource(source, whisper);
    for (let i = 1; i < out.character_start_times_seconds.length; i += 1) {
      expect(out.character_start_times_seconds[i]).toBeGreaterThanOrEqual(
        out.character_start_times_seconds[i - 1] - 1e-9
      );
      expect(out.character_end_times_seconds[i]).toBeGreaterThanOrEqual(
        out.character_end_times_seconds[i - 1] - 1e-9
      );
    }
  });
});
