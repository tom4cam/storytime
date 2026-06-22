import { useEffect, useState } from 'react';
import { voicesForLang, type VoiceMeta } from '../voices';
import type { Lang } from '../types';
import { useT } from '../i18n';

interface Props {
  value: string;
  onChange: (key: string) => void;
  language: Lang;
}

export function VoicePicker({ value, onChange, language }: Props) {
  const t = useT();
  const [playing, setPlaying] = useState<string | null>(null);
  const voices = voicesForLang(language);

  // If the current selection isn't valid for this language (e.g. the user
  // chose Oliver in an English create flow then switched to French), snap
  // to the first option for the language so we never send an unsupported
  // voice to the backend.
  useEffect(() => {
    if (voices.length === 0) return;
    if (!voices.some((v) => v.key === value)) {
      onChange(voices[0].key);
    }
  }, [language, value, voices, onChange]);

  const playSample = (v: VoiceMeta) => {
    const a = new Audio(v.sampleUrl);
    setPlaying(v.key);
    a.onended = () => setPlaying((p) => (p === v.key ? null : p));
    a.onerror = () => setPlaying((p) => (p === v.key ? null : p));
    void a.play().catch(() => setPlaying((p) => (p === v.key ? null : p)));
  };

  return (
    <ul className="voice-list">
      {voices.map((v) => {
        const checked = value === v.key;
        return (
          <li key={v.key} className={`voice-row${checked ? ' selected' : ''}`}>
            <label className="voice-main">
              <input type="radio" name="voice" checked={checked} onChange={() => onChange(v.key)} />
              <span className="voice-name">{v.displayName}</span>
              <span className="voice-tag">{v.gender === 'f' ? '♀' : '♂'}</span>
            </label>
            <button
              type="button"
              className={`btn ghost voice-sample${playing === v.key ? ' is-playing' : ''}`}
              onClick={() => playSample(v)}
            >
              {'▶'} {t('voice.playSample')}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
