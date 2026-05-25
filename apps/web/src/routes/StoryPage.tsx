import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { getStory } from '../api';
import { useLang, useT } from '../i18n';
import type { StoryVersion } from '../types';

const POLL_INTERVAL_MS = 10000;

export function StoryPage() {
  const t = useT();
  const { lang } = useLang();
  const { id, version } = useParams<{ id: string; version?: string }>();
  const [story, setStory] = useState<StoryVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setStory(null);
    let cancelled = false;
    const v = version ? parseInt(version, 10) : undefined;

    const tick = () => {
      getStory(id, v)
        .then((s) => {
          if (cancelled) return;
          setStory(s);
          setLoading(false);
          if (s.status === 'generating') {
            pollingRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
          }
        })
        .catch((e) => {
          if (cancelled) return;
          setError((e as Error).message);
          setLoading(false);
        });
    };
    tick();

    return () => {
      cancelled = true;
      if (pollingRef.current) window.clearTimeout(pollingRef.current);
    };
  }, [id, version]);

  if (loading) {
    return (
      <Layout>
        <div className="card loading">
          <div className="spinner" />
          <p>{t('story.opening')}</p>
        </div>
      </Layout>
    );
  }

  if (error || !story) {
    return (
      <Layout>
        <div className="error">{error ?? t('story.notFound')}</div>
        <Link to="/" className="btn">{t('story.backHome')}</Link>
      </Layout>
    );
  }

  if (story.status === 'generating') {
    return (
      <Layout>
        <div className="card loading">
          <div className="spinner" />
          <div className="question">{t('story.makingTitle')}</div>
          <p className="subtle">{t('story.makingHint')}</p>
        </div>
      </Layout>
    );
  }

  if (story.status === 'failed') {
    return (
      <Layout>
        <div className="card">
          <div className="question">{t('story.failedTitle')}</div>
          <p>{story.error ?? t('story.failedDefault')}</p>
          <div className="row">
            <Link to="/create" className="btn">{t('story.tryNew')}</Link>
            <Link to="/" className="btn ghost">{t('story.backHome')}</Link>
          </div>
        </div>
      </Layout>
    );
  }

  const versionLinks = Array.from({ length: story.version }, (_, i) => i + 1);

  return (
    <Layout>
      <h1 className="story-title">{story.title}</h1>
      <div className="story-meta">
        {t('story.versionPrefix')} {story.version} ({t('story.savedPrefix')} {formatDate(story.created_at, lang)})
      </div>

      {story.version > 1 && (
        <div className="versions">
          {versionLinks.map((v) => (
            <Link
              key={v}
              to={`/s/${story.id}/v/${v}`}
              className={v === story.version && !version ? 'current' : v === Number(version) ? 'current' : ''}
            >
              v{v}
            </Link>
          ))}
        </div>
      )}

      {story.narration_url && (
        <div className="audio-bar">
          <span aria-hidden="true" style={{ fontSize: 28 }}>{'\u{1F509}'}</span>
          <audio controls src={story.narration_url} preload="metadata" />
        </div>
      )}

      {story.paragraphs.map((p, i) => (
        <div className={`paragraph ${i % 2 === 1 ? 'flip' : ''}`} key={i}>
          <div className="p-image">
            {p.image_url
              ? <img src={p.image_url} alt={`Illustration for paragraph ${i + 1}`} />
              : <div className="placeholder">No picture for this part.</div>}
          </div>
          <div className="p-text">{p.text}</div>
        </div>
      ))}

      <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
        <Link to={`/s/${story.id}/edit`} className="btn secondary">{t('story.editLink')}</Link>
        <Link to="/create" className="btn">{t('story.makeAnother')}</Link>
      </div>
    </Layout>
  );
}

function formatDate(s: string, lang: 'en' | 'sv'): string {
  try {
    const d = new Date(s);
    const locale = lang === 'sv' ? 'sv-SE' : 'en-US';
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return s;
  }
}
