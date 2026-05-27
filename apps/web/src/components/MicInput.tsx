import { useEffect, useRef, useState } from 'react';
import { listenOnce, speechRecognitionAvailable, type ListenHandle } from '../speech';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  language: 'en' | 'sv' | 'bg' | 'es' | 'fr';
}

export function MicInput({ value, onChange, placeholder, ariaLabel, language }: Props) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<ListenHandle | null>(null);
  const supported = speechRecognitionAvailable();

  useEffect(() => () => { handleRef.current?.stop(); }, []);

  const startListening = () => {
    setError(null);
    setListening(true);
    const STT_LOCALES = { en: 'en-US', sv: 'sv-SE', bg: 'bg-BG', es: 'es-419', fr: 'fr-FR' } as const;
    const sttLang = STT_LOCALES[language] ?? 'en-US';
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
          placeholder={placeholder ?? 'Type your answer, or tap the microphone.'}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ flex: 1, minWidth: 0 }}
        />
        {supported && (
          <button
            type="button"
            className={`mic-button ${listening ? 'listening' : ''}`}
            aria-label={listening ? 'Stop recording' : 'Speak your answer'}
            onClick={listening ? stopListening : startListening}
            title={listening ? 'Tap to stop' : 'Tap to speak'}
          >
            {listening ? '■' : '\u{1F3A4}'}
          </button>
        )}
      </div>
      {!supported && (
        <div className="note">
          Voice input is not supported in this browser. You can still type your
          answer. (Chrome and Edge work best for voice.)
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
