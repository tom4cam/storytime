// Admin observability page. Mounted at /admin.
// Prompts for ADMIN_TOKEN on first load (stored in sessionStorage only).
// Tabs: Cost tracking | Flagged stories.

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  adminDeleteStory,
  adminGetCosts,
  adminListFlagged,
  adminResetCosts,
  adminRestoreStory,
  ApiError,
} from '../api';
import type { FlaggedStorySummary, MonthlyCosts } from '../api';

const SESSION_KEY = 'storyMaker.adminSessionToken';

function getSessionToken(): string | null {
  try { return window.sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}
function setSessionToken(t: string): void {
  try { window.sessionStorage.setItem(SESSION_KEY, t); } catch { /* ignore */ }
}
function clearSessionToken(): void {
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

// ---- Token gate ----

function TokenGate({ onToken }: { onToken: (t: string) => void }) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = value.trim();
    if (!t) { setErr('Token required'); return; }
    setErr('');
    onToken(t);
  }

  return (
    <div className="page" style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 28, margin: '0 0 16px' }}>Admin</h1>
      <form onSubmit={submit} className="card">
        <label htmlFor="admin-token" style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>
          Admin token
        </label>
        <input
          id="admin-token"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ADMIN_TOKEN"
          style={{ marginBottom: 12 }}
          autoFocus
        />
        {err && <p style={{ color: '#c44536', margin: '0 0 8px', fontSize: 16 }}>{err}</p>}
        <button type="submit" className="btn" style={{ fontSize: 18, minHeight: 48, padding: '12px 24px' }}>
          Sign in
        </button>
      </form>
    </div>
  );
}

// ---- Costs tab ----

function pct(val: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, (val / cap) * 100);
}

function fmt(n: number): string {
  return `$${n.toFixed(4)}`;
}

function CostsTab({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  const [data, setData] = useState<{ costs: MonthlyCosts; cap_usd: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const d = await adminGetCosts(token);
      setData(d);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) { onAuthError(); return; }
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, onAuthError]);

  useEffect(() => { void load(); }, [load]);

  async function handleReset() {
    if (!confirm('Reset cost data for the current month to zero?')) return;
    setResetting(true);
    try {
      const r = await adminResetCosts(token);
      setData((prev) => prev ? { ...prev, costs: r.costs } : null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) { onAuthError(); return; }
      setErr((e as Error).message);
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <p className="subtle">Loading costs…</p>;
  if (err) return <p style={{ color: '#c44536' }}>{err}</p>;
  if (!data) return null;

  const { costs, cap_usd } = data;
  const barPct = pct(costs.total_usd, cap_usd);

  return (
    <div>
      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 20 }}>Month: {costs.month}</strong>
          <span className="subtle" style={{ fontSize: 15 }}>
            Last updated: {costs.updated_at ? new Date(costs.updated_at).toLocaleString() : '—'}
          </span>
        </div>

        <p style={{ margin: '0 0 4px', fontSize: 18 }}>
          Total: <strong>{fmt(costs.total_usd)}</strong> / cap: <strong>{fmt(cap_usd)}</strong>
          {costs.cost_alerted && (
            <span style={{ marginLeft: 10, color: '#c44536', fontWeight: 700 }}>⚠ Alert sent</span>
          )}
        </p>
        <div className="progress">
          <div style={{ width: `${barPct}%`, background: barPct >= 100 ? '#c44536' : undefined }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div className="card" style={{ margin: 0, padding: 16, fontSize: 16 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>By provider</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {(['anthropic', 'openai', 'fal', 'elevenlabs'] as const).map((p) => (
                  <tr key={p}>
                    <td style={{ padding: '2px 0', color: 'var(--ink-soft)' }}>{p}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(costs.by_provider[p] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card" style={{ margin: 0, padding: 16, fontSize: 16 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>By kind</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {(['story_gen', 'translation', 'tts', 'image', 'moderation'] as const).map((k) => (
                  <tr key={k}>
                    <td style={{ padding: '2px 0', color: 'var(--ink-soft)' }}>{k}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(costs.by_kind[k])}</td>
                    <td style={{ textAlign: 'right', color: 'var(--ink-soft)', paddingLeft: 8 }}>×{costs.count_by_kind[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="row">
          <button className="btn ghost" style={{ fontSize: 16, minHeight: 40, padding: '8px 16px' }} onClick={() => void load()}>
            Refresh
          </button>
          <button
            className="btn danger-ghost"
            onClick={() => void handleReset()}
            disabled={resetting}
          >
            {resetting ? 'Resetting…' : 'Reset month'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Flagged stories tab ----

function FlaggedTab({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  const [stories, setStories] = useState<FlaggedStorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const d = await adminListFlagged(token);
      setStories(d.flagged);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) { onAuthError(); return; }
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, onAuthError]);

  useEffect(() => { void load(); }, [load]);

  async function handleRestore(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await adminRestoreStory(token, id);
      setStories((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) { onAuthError(); return; }
      alert(`Restore failed: ${(e as Error).message}`);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Permanently delete "${title}"?`)) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await adminDeleteStory(token, id);
      setStories((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) { onAuthError(); return; }
      alert(`Delete failed: ${(e as Error).message}`);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  if (loading) return <p className="subtle">Loading flagged stories…</p>;
  if (err) return <p style={{ color: '#c44536' }}>{err}</p>;
  if (stories.length === 0) return (
    <div className="card">
      <p className="subtle" style={{ margin: 0 }}>No hidden stories.</p>
      <button className="btn ghost" style={{ fontSize: 16, minHeight: 40, padding: '8px 16px', marginTop: 12 }} onClick={() => void load()}>Refresh</button>
    </div>
  );

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="subtle">{stories.length} hidden {stories.length === 1 ? 'story' : 'stories'}</span>
        <button className="btn ghost" style={{ fontSize: 15, minHeight: 36, padding: '6px 14px' }} onClick={() => void load()}>Refresh</button>
      </div>
      {stories.map((s) => (
        <div key={s.id} className="card" style={{ marginBottom: 12 }}>
          <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 18, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.title}
              </strong>
              <span className="subtle" style={{ fontSize: 14 }}>
                {s.language} · {s.status} · {new Date(s.created_at).toLocaleDateString()}
                {s.creator_id ? ` · ${s.creator_id.slice(0, 12)}…` : ''}
              </span>
              {s.error && (
                <p style={{ margin: '4px 0 0', fontSize: 14, color: '#c44536', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.error}
                </p>
              )}
            </div>
            <div className="row" style={{ flexShrink: 0, gap: 6 }}>
              <Link
                to={`/s/${s.id}`}
                className="btn ghost"
                style={{ fontSize: 14, minHeight: 36, padding: '6px 12px' }}
                target="_blank"
                rel="noreferrer"
              >
                View
              </Link>
              <Link
                to={`/s/${s.id}/edit`}
                className="btn secondary"
                style={{ fontSize: 14, minHeight: 36, padding: '6px 12px' }}
                target="_blank"
                rel="noreferrer"
              >
                Edit
              </Link>
              <button
                className="btn sun"
                style={{ fontSize: 14, minHeight: 36, padding: '6px 12px' }}
                disabled={busy[s.id]}
                onClick={() => void handleRestore(s.id)}
              >
                {busy[s.id] ? '…' : 'Restore'}
              </button>
              <button
                className="btn danger-ghost"
                disabled={busy[s.id]}
                onClick={() => void handleDelete(s.id, s.title)}
              >
                {busy[s.id] ? '…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Main page ----

type Tab = 'costs' | 'flagged';

export function AdminPage() {
  const [token, setToken] = useState<string | null>(getSessionToken);
  const [tab, setTab] = useState<Tab>('costs');

  function handleToken(t: string) {
    setSessionToken(t);
    setToken(t);
  }

  function handleAuthError() {
    clearSessionToken();
    setToken(null);
  }

  if (!token) return <TokenGate onToken={handleToken} />;

  return (
    <div className="page">
      <div className="header">
        <Link to="/" className="brand" style={{ fontSize: 18 }}>← Home</Link>
        <h1 style={{ margin: 0, fontSize: 24 }}>Admin</h1>
        <button
          className="btn ghost"
          style={{ fontSize: 14, minHeight: 36, padding: '6px 14px' }}
          onClick={() => { clearSessionToken(); setToken(null); }}
        >
          Sign out
        </button>
      </div>

      <div className="row" style={{ marginBottom: 20 }}>
        <button
          className={`btn ${tab === 'costs' ? '' : 'ghost'}`}
          style={{ fontSize: 16, minHeight: 44, padding: '10px 20px' }}
          onClick={() => setTab('costs')}
        >
          Costs
        </button>
        <button
          className={`btn ${tab === 'flagged' ? '' : 'ghost'}`}
          style={{ fontSize: 16, minHeight: 44, padding: '10px 20px' }}
          onClick={() => setTab('flagged')}
        >
          Flagged stories
        </button>
      </div>

      {tab === 'costs' && <CostsTab token={token} onAuthError={handleAuthError} />}
      {tab === 'flagged' && <FlaggedTab token={token} onAuthError={handleAuthError} />}
    </div>
  );
}
