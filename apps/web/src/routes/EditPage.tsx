import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { getStory, updateStory } from '../api';
import { useT } from '../i18n';
import type { Paragraph, StoryVersion } from '../types';
import { imageAlt } from '../imageAlt';

interface DraftParagraph extends Paragraph {
  regenerate_image?: boolean;
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
    if (!id) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await updateStory(
        id,
        paragraphs.map((p) => ({
          text: p.text,
          image_url: p.regenerate_image ? null : p.image_url,
          image_prompt: p.image_prompt,
          regenerate_image: !!p.regenerate_image,
        })),
        title,
        summary
      );
      navigate(isOwner ? `/s/${next.id}` : `/s/${next.id}/v/${next.version}`);
    } catch (e) {
      setSaving(false);
      const msg = (e as Error).message || t('error.generic');
      const looksLikeTimeout = /load failed|network|timeout|fetch/i.test(msg);
      setSaveError(looksLikeTimeout ? `${msg}. ${t('edit.saveTimeoutHint')}` : msg);
    }
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
          <div className="row" style={{ marginTop: 12 }}>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={!!p.regenerate_image}
                onChange={(e) => updateParagraph(i, { regenerate_image: e.target.checked })}
              />
              {t('edit.regenerateImage')}
            </label>
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
