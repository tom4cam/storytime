import type { WordTiming } from './types';

export interface CharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export function charsToWords(
  paragraphs: string[],
  alignment: CharacterAlignment,
  joiner = '\n\n'
): WordTiming[] {
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;

  const paraIndexAtChar: number[] = new Array(chars.length);
  let cursor = 0;
  for (let p = 0; p < paragraphs.length; p += 1) {
    const para = paragraphs[p];
    for (let i = 0; i < para.length; i += 1) {
      paraIndexAtChar[cursor + i] = p;
    }
    cursor += para.length;
    if (p < paragraphs.length - 1) {
      for (let j = 0; j < joiner.length; j += 1) {
        paraIndexAtChar[cursor + j] = -1;
      }
      cursor += joiner.length;
    }
  }

  const out: WordTiming[] = [];
  const wordIndexByParagraph: number[] = paragraphs.map(() => 0);

  let i = 0;
  while (i < chars.length) {
    while (i < chars.length && /\s/.test(chars[i])) i += 1;
    if (i >= chars.length) break;

    const startIdx = i;
    let endIdx = i;
    while (endIdx < chars.length && !/\s/.test(chars[endIdx])) endIdx += 1;

    const word = chars.slice(startIdx, endIdx).join('');
    const paragraphIndex = paraIndexAtChar[startIdx];
    if (paragraphIndex < 0) { i = endIdx; continue; }
    out.push({
      paragraphIndex,
      wordIndex: wordIndexByParagraph[paragraphIndex],
      word,
      start: starts[startIdx],
      end: ends[endIdx - 1],
    });
    wordIndexByParagraph[paragraphIndex] += 1;
    i = endIdx;
  }

  return smoothDegenerateWords(out);
}

// Spread out runs of words that share a single start time (typically
// when Whisper compressed a region: two surviving anchors landed at
// near-identical timestamps, and source words between them collapsed).
// A flat run of K words bracketed by t_left and t_right is redistributed
// across [t_left, t_right] proportionally — without this, the frontend
// keeps the highlight stuck on the first word for the whole compressed
// region while the audio races through several words.
function smoothDegenerateWords(words: WordTiming[]): WordTiming[] {
  const n = words.length;
  if (n < 2) return words;
  let i = 0;
  while (i < n) {
    // Find run of words that all share words[i].start.
    let j = i + 1;
    while (j < n && words[j].start === words[i].start) j += 1;
    const runLen = j - i;
    if (runLen >= 2) {
      const t0 = words[i].start;
      // Right edge: the next word's start, or the run's max end, or t0.
      const tRight = j < n ? words[j].start : Math.max(...words.slice(i, j).map((w) => w.end));
      if (tRight > t0) {
        const step = (tRight - t0) / runLen;
        for (let k = 0; k < runLen; k += 1) {
          const ws = t0 + step * k;
          const we = t0 + step * (k + 1);
          words[i + k] = { ...words[i + k], start: ws, end: we };
        }
      }
    }
    i = j;
  }
  return words;
}
