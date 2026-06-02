import { describe, it, expect } from 'vitest';
import { findActiveWordIndex } from './audioSync';
import type { WordTiming } from './types';

const w = (start: number, end: number): WordTiming => ({
  paragraphIndex: 0, wordIndex: 0, word: 'x', start, end,
});

describe('findActiveWordIndex', () => {
  const words: WordTiming[] = [
    w(0.0, 0.2),
    w(0.2, 0.5),
    w(0.5, 0.9),
    w(1.0, 1.4),
  ];

  it('returns -1 when there are no words', () => {
    expect(findActiveWordIndex([], 1)).toBe(-1);
  });

  it('returns -1 when time is before the first word', () => {
    expect(findActiveWordIndex(words, -0.5)).toBe(-1);
  });

  it('returns 0 at exactly the first start', () => {
    expect(findActiveWordIndex(words, 0.0)).toBe(0);
  });

  it('returns the index whose window contains the time', () => {
    expect(findActiveWordIndex(words, 0.1)).toBe(0);
    expect(findActiveWordIndex(words, 0.3)).toBe(1);
    expect(findActiveWordIndex(words, 0.7)).toBe(2);
    expect(findActiveWordIndex(words, 1.2)).toBe(3);
  });

  it('treats end times as exclusive', () => {
    expect(findActiveWordIndex(words, 0.2)).toBe(1);
  });

  it('returns the previous word when time falls in a gap', () => {
    expect(findActiveWordIndex(words, 0.95)).toBe(2);
  });

  it('returns the last index when past the last word end', () => {
    expect(findActiveWordIndex(words, 99)).toBe(3);
  });

  it('picks the smallest index when leading words share a start time', () => {
    // Simulates Whisper failing to align the first run of words: indexes
    // 0..3 all stamped (0,0), then 4 has (0, 1.34), then real timing starts.
    const broken: WordTiming[] = [
      w(0, 0), w(0, 0), w(0, 0), w(0, 0),
      w(0, 1.34),
      w(1.34, 2.0),
      w(2.0, 2.5),
    ];
    expect(findActiveWordIndex(broken, 0)).toBe(0);
    expect(findActiveWordIndex(broken, 0.5)).toBe(0);
    expect(findActiveWordIndex(broken, 1.34)).toBe(5);
    expect(findActiveWordIndex(broken, 2.2)).toBe(6);
  });
});
