import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { getStory, updateStory } from '../api';
import { useT } from '../i18n';
import type { Paragraph, StoryVersion } from '../types';
import { imageAlt } from '../imageAlt';

interface DraftParagraph extends Paragraph {
  regenerate_image?: boolean;
  regenerate_text?: boolean;
  change_instruction?: string;
}

export function EditPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [story, setStory] = useState<StoryVersion | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [paragraphs, setParagraphs] = useState<DraftParagraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getStory(id)
      .then((s) => {
        setStory(s);
        setTitle(s.title);
        setSummary(s.summary ?? '');
        setParagraphs(s.paragraphs.map((p) => ({ ...p })));
      })
      .catch((e) => setLoadError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  const isOwner = !!story?.is_owner;

  const updateParagraph = (i: number, patch: Partial<DraftParagraph>) => {
    setParagraphs((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const save = async () => {
    if (!id || !story) return;
    setSaving(true);
    setSaveError(null);

    // updateStory saves a "generating" stub up front, then rebuilds (~60s) in
    // the same request. We fire it and keep the promise alive in the
    // background — an in-flight fetch survives client-side navigation, so the
    // build finishes server-side even after we leave. As soon as the stub is
    // surely saved we navigate to the story page, which polls until it's ready,
    // so the user can watch it regenerate instead of waiting on a spinner.
    const targetVersion = isOwner ? story.version : story.version + 1;
    const dest = isOwner ? `/s/${id}` : `/s/${id}/v/${targetVersion}`;

    const request = updateStory(
      id,
      paragraphs.map((p) => ({
        text: p.text,
        image_url: p.regenerate_image ? null : p.image_url,
        image_prompt: p.image_prompt,
        regenerate_image: !!p.regenerate_image,
        regenerate_text: !!p.regenerate_text,
        change_instruction: p.change_instruction?.trim() || undefined,
      })),
      title,
      summary
    );

    // Race the request against a short timer. A fast failure (validation,
    // network, over the monthly cap) keeps us on the edit page with the form
    // intact; once the stub is up (well under this) we navigate away.
    const STUB_READY_MS = 1500;
    const outcome = await Promise.race([
      request.then(() => ({ kind: 'done' as const })).catch((e: unknown) => ({ kind: 'error' as const, error: e as Error })),
      new Promise<{ kind: 'pending' }>((resolve) => setTimeout(() => resolve({ kind: 'pending' }), STUB_READY_MS)),
    ]);

    if (outcome.kind === 'error') {
      setSaving(false);
      const msg = outcome.error.message || t('error.generic');
      const looksLikeTimeout = /load failed|network|timeout|fetch/i.test(msg);
      setSaveError(looksLikeTimeout ? `${msg}. ${t('edit.saveTimeoutHint')}` : msg);
      return;
    }

    // Build still running (or already done). Keep the background request from
    // surfacing as an unhandled rejection — any failure is reflected on the
    // story page (owner edits revert; new versions show a failed state).
    request.catch(() => { /* handled server-side */ });
    navigate(dest);
  };

  if (loading) {
    return <Layout><div className="card loading"><div className="spinner" /><p>{t('edit.loading')}</p></div></Layout>;
  }
  if (loadError || !story) {
    return <Layout><div className="error">{loadError ?? t('edit.notFound')}</div></Layout>;
  }
  if (saving) {
    return (
      <Layout>
        <div className="card loading">
          <div className="spinner" />
          <div className="question">{t('edit.sending')}</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <h1 className="story-title">{t('edit.heading')}</h1>
      <p className="story-meta">
        {isOwner ? t('edit.savingInPlace') : t('edit.versionNote', { next: String(story.version + 1) })}
      </p>

      <div className="card">
        <label className="question" htmlFor="title">{t('edit.titleLabel')}</label>
        <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="card">
        <label className="question" htmlFor="summary">{t('edit.summaryLabel')}</label>
        <p className="subtle">{t('edit.summaryHint')}</p>
        <textarea
          id="summary"
          value={summary}
          rows={5}
          onChange={(e) => setSummary(e.target.value)}
          placeholder={t('edit.summaryPlaceholder')}
        />
      </div>

      {paragraphs.map((p, i) => (
        <div className="card" key={i}>
          <div className="question">{t('edit.paragraphLabel', { n: String(i + 1) })}</div>
          <textarea
            value={p.text}
            rows={5}
            onChange={(e) => updateParagraph(i, { text: e.target.value })}
            aria-label={t('edit.paragraphLabel', { n: String(i + 1) })}
          />
          <div className="row" style={{ marginTop: 12, gap: 16, flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={!!p.regenerate_image}
                onChange={(e) => updateParagraph(i, { regenerate_image: e.target.checked })}
              />
              {t('edit.regenerateImage')}
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={!!p.regenerate_text}
                onChange={(e) => updateParagraph(i, { regenerate_text: e.target.checked })}
              />
              {t('edit.regenerateText')}
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            <label htmlFor={`change-${i}`} className="subtle" style={{ display: 'block', marginBottom: 4 }}>
              {t('edit.changeLabel')}
            </label>
            <input
              id={`change-${i}`}
              type="text"
              value={p.change_instruction ?? ''}
              placeholder={t('edit.changePlaceholder')}
              onChange={(e) => updateParagraph(i, { change_instruction: e.target.value })}
            />
          </div>
          {p.image_url && !p.regenerate_image && (
            <div style={{ marginTop: 12 }}>
              <img src={p.image_url} alt={imageAlt(p)} style={{ maxWidth: 240, borderRadius: 16, border: '3px solid var(--ink)' }} />
            </div>
          )}
        </div>
      ))}

      {saveError && (
        <div className="error" role="alert" style={{ marginTop: 16 }}>
          {saveError}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
        <Link to={`/s/${story.id}`} className="btn ghost">{t('edit.cancel')}</Link>
        <button type="button" className="btn sun" onClick={save}>
          {saveError ? t('edit.tryAgain') : isOwner ? t('edit.saveInPlace') : t('edit.save')}
        </button>
      </div>
    </Layout>
  );
}
