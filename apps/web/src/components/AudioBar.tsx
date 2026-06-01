import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useT } from '../i18n';

interface Props {
  src: string;
}

export type AudioBarRef = HTMLAudioElement;

// Auto-hide thresholds.
const HIDE_BELOW = 80; // bar always visible above this scrollY
const SCROLL_DELTA = 10; // minimum delta to flip hidden/visible

export const AudioBar = forwardRef<AudioBarRef, Props>(function AudioBar({ src }, ref) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ended, setEnded] = useState(false);
  const [hidden, setHidden] = useState(false);

  useImperativeHandle(ref, () => audioRef.current as HTMLAudioElement, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => { setIsPlaying(true); setEnded(false); };
    const onPause = () => setIsPlaying(false);
    const onEnded = () => { setIsPlaying(false); setEnded(true); };
    const onTime = () => setCurrentTime(el.currentTime);
    const onMeta = () => {
      const d = Number.isFinite(el.duration) ? el.duration : 0;
      if (d > 0) setDuration(d);
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('canplay', onMeta);
    onMeta();
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('canplay', onMeta);
    };
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = Math.max(0, window.scrollY);
      const delta = y - lastY;
      if (y < HIDE_BELOW) {
        setHidden(false);
      } else if (delta > SCROLL_DELTA) {
        setHidden(true);
      } else if (delta < -SCROLL_DELTA) {
        setHidden(false);
      }
      if (Math.abs(delta) > SCROLL_DELTA) lastY = y;
    };
    const onPointer = () => setHidden(false);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused || el.ended) {
      if (el.ended) el.currentTime = 0;
      void el.play();
    } else {
      el.pause();
    }
  };

  const onProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = pct * duration;
  };

  const onProgressKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const STEP = 5; // seconds per arrow key press
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      el.currentTime = Math.min(duration, el.currentTime + STEP);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      el.currentTime = Math.max(0, el.currentTime - STEP);
    } else if (e.key === 'Home') {
      e.preventDefault();
      el.currentTime = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      el.currentTime = duration;
    }
  };

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const label = ended ? t('audio.replay') : isPlaying ? t('audio.pause') : t('audio.play');

  return (
    <div className={`audio-bar${hidden ? ' audio-bar-hidden' : ''}`} aria-hidden={hidden}>
      <button
        type="button"
        className={`play-btn ${isPlaying ? 'is-playing' : ''}`}
        onClick={toggle}
        aria-label={label}
        aria-pressed={isPlaying}
      >
        {isPlaying ? '❚❚' : '▶'}
      </button>
      <div
        className="audio-progress"
        role="slider"
        aria-label={t('audio.progress')}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, Math.round(duration))}
        aria-valuenow={Math.round(currentTime)}
        tabIndex={0}
        onClick={onProgressClick}
        onKeyDown={onProgressKey}
      >
        <div className="audio-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="audio-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>
      <audio ref={audioRef} src={src} preload="metadata" hidden />
    </div>
  );
});

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
