import { useState } from 'react';
import { VOICES, type VoiceMeta } from '../voices';
import { useT } from '../i18n';

interface Props {
  value: string;
  onChange: (key: string) => void;
}

export function VoicePicker({ value, onChange }: Props) {
  const t = useT();
  const [playing, setPlaying] = useState<string | null>(null);

  const playSample = (v: VoiceMeta) => {
    const a = new Audio(v.sampleUrl);
    setPlaying(v.key);
    a.onended = () => setPlaying((p) => (p === v.key ? null : p));
    a.onerror = () => setPlaying((p) => (p === v.key ? null : p));
    void a.play().catch(() => setPlaying((p) => (p === v.key ? null : p)));
  };

  return (
    <ul className="voice-list">
      {VOICES.map((v) => {
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
