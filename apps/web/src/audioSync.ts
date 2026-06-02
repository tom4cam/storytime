import { useEffect, useRef, useState, type RefObject } from 'react';
import type { WordTiming } from './types';

/**
 * Returns the index of the word whose [start, end) window contains `t`.
 *   - Returns -1 if `t` is before the first word's start, or words is empty.
 *   - Returns the previous index when `t` falls in a gap between two words.
 *   - Returns the last index when `t` is past the last word's end.
 *
 * When multiple consecutive words share the same start time (e.g. Whisper
 * alignment failed and assigned 0 to a run of leading words), this picks
 * the SMALLEST such index. That way at t=0 the first word is highlighted,
 * not the last word of the broken-alignment run.
 */
export function findActiveWordIndex(words: WordTiming[], t: number): number {
  if (words.length === 0) return -1;
  if (t < words[0].start) return -1;
  let lo = 0;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (words[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  // Walk back to the first member of the tie group so degenerate alignment
  // data (a run of words all stamped with the same start) still highlights
  // the start of the run rather than its end.
  while (lo > 0 && words[lo - 1].start === words[lo].start) lo--;
  return lo;
}

/**
 * Returns the current active word index for the given audio element ref.
 * Updates only when the index changes — re-renders the consumer at word
 * boundaries, not every frame.
 *
 * Returns -1 when there's no audio, no timings, or playback hasn't begun.
 *
 * Audio elements report `currentTime` coarsely (Safari/Firefox update it
 * only every ~250ms during playback even though our rAF runs at 60Hz).
 * Reading currentTime directly produces a visible lag between voice and
 * highlight. We anchor on each `timeupdate`/`play`/`seeked` event and
 * extrapolate audio time between events using `performance.now()`, so
 * the highlight stays in sync to within one frame.
 */
export function useAudioSync(
  audioRef: RefObject<HTMLAudioElement | null>,
  words: WordTiming[] | undefined
): number {
  const [activeIndex, setActiveIndex] = useState(-1);
  const rafRef = useRef<number | null>(null);
  const lastIndexRef = useRef(-1);
  // Anchor: audio-time at the moment of the last currentTime update,
  // paired with the wall-clock reading at that same moment.
  const anchorAudioRef = useRef(0);
  const anchorWallRef = useRef(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !words || words.length === 0) {
      setActiveIndex(-1);
      lastIndexRef.current = -1;
      return;
    }

    const anchor = () => {
      anchorAudioRef.current = el.currentTime;
      anchorWallRef.current = performance.now();
    };

    const estimatedTime = (): number => {
      if (el.paused || el.ended) return el.currentTime;
      const elapsed = (performance.now() - anchorWallRef.current) / 1000;
      const rate = el.playbackRate || 1;
      return anchorAudioRef.current + elapsed * rate;
    };

    const tick = () => {
      const idx = findActiveWordIndex(words, estimatedTime());
      if (idx !== lastIndexRef.current) {
        lastIndexRef.current = idx;
        setActiveIndex(idx);
      }
      if (!el.paused && !el.ended) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    const onPlay = () => {
      anchor();
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
    };
    const onPauseOrEnd = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      anchor();
      tick();
    };
    const onSeek = () => { anchor(); tick(); };
    const onTimeUpdate = () => { anchor(); };
    const onRateChange = () => { anchor(); };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPauseOrEnd);
    el.addEventListener('ended', onPauseOrEnd);
    el.addEventListener('seeked', onSeek);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ratechange', onRateChange);

    anchor();
    if (!el.paused && !el.ended) onPlay();
    tick();

    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPauseOrEnd);
      el.removeEventListener('ended', onPauseOrEnd);
      el.removeEventListener('seeked', onSeek);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ratechange', onRateChange);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [audioRef, words]);

  return activeIndex;
}
