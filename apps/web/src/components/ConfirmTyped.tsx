import { useState } from 'react';
import { useT } from '../i18n';

interface Props {
  title: string;
  body: string;
  /** Word the user must type verbatim to enable the destructive action. */
  word?: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export function ConfirmTyped({ title, body, word, onConfirm, onCancel }: Props) {
  const t = useT();
  const expected = (word ?? t('admin.confirmWord')).trim();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === expected;

  return (
    <div className="card delete-confirm no-print" style={{ marginTop: 16 }}>
      <div className="question">{title}</div>
      <p>{body}</p>
      <p className="subtle">{t('admin.confirmPrompt', { word: expected })}</p>
      <input
        type="text"
        autoFocus
        placeholder={t('admin.confirmPlaceholder')}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        disabled={busy}
      />
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn danger"
          disabled={!matches || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try { await onConfirm(); }
            catch (e) { setBusy(false); setError((e as Error).message); }
          }}
        >
          {busy ? '...' : t('admin.confirmGo')}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>
          {t('admin.confirmCancel')}
        </button>
      </div>
    </div>
  );
}
