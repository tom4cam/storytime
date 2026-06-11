import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { LOCALES } from '../i18n/locales';
import { listenOnce, speechRecognitionAvailable, type ListenHandle } from '../speech';
import type { Lang } from '../types';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  language: Lang;
}

export function MicInput({ value, onChange, placeholder, ariaLabel, language }: Props) {
  const t = useT();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<ListenHandle | null>(null);
  const supported = speechRecognitionAvailable();

  useEffect(() => () => { handleRef.current?.stop(); }, []);

  const startListening = () => {
    setError(null);
    setListening(true);
    const sttLang = LOCALES[language] ?? 'en-US';
    handleRef.current = listenOnce(
      (transcript) => {
        setListening(false);
        if (transcript) onChange((value ? value + ' ' : '') + transcript);
      },
      (err) => {
        setListening(false);
        setError(err);
      },
      { lang: sttLang }
    );
    if (!handleRef.current) setListening(false);
  };

  const stopListening = () => {
    handleRef.current?.stop();
    setListening(false);
  };

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <textarea
          aria-label={ariaLabel}
          value={value}
          placeholder={placeholder ?? t('mic.placeholder')}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ flex: 1, minWidth: 0 }}
        />
        {supported && (
          <button
            type="button"
            className={`mic-button ${listening ? 'listening' : ''}`}
            aria-label={listening ? t('mic.stop') : t('mic.start')}
            onClick={listening ? stopListening : startListening}
            title={listening ? t('mic.stop') : t('mic.start')}
          >
            {listening ? '■' : '\u{1F3A4}'}
          </button>
        )}
      </div>
      {!supported && (
        <div className="note">{t('mic.unavailable')}</div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
