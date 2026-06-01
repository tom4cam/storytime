import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { listStories } from '../api';
import { useT, useLang } from '../i18n';
import { getCreatorId } from '../creatorId';
import { LANG_FLAG } from '../lang';
import type { Lang, StoryGroupSummary } from '../types';

export function HomePage() {
  const t = useT();
  const { lang: uiLang } = useLang();
  const [recent, setRecent] = useState<StoryGroupSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showMineOnly, setShowMineOnly] = useState(false);
  const myId = getCreatorId();

  useEffect(() => {
    listStories(uiLang as Lang)
      .then(setRecent)
      .catch(() => { /* swallow */ })
      .finally(() => setLoaded(true));
  }, [uiLang]);

  const ownedCount = useMemo(
    () => recent.filter((g) => g.primary.creator_id === myId).length,
    [recent, myId]
  );
  const visible = useMemo(
    () => (showMineOnly ? recent.filter((g) => g.primary.creator_id === myId) : recent),
    [recent, myId, showMineOnly]
  );

  return (
    <Layout>
      <div className="hero">
        <h1>{t('home.heroTitle')}</h1>
        <p>{t('home.heroBody')}</p>
        <Link to="/create" className="btn sun">{t('home.heroCta')}</Link>
      </div>

      <h2 style={{ marginTop: 8 }}>{t('home.recentHeading')}</h2>
      {ownedCount > 0 && (
        <div className="filter-pills">
          <button
            type="button"
            className={showMineOnly ? '' : 'on'}
            onClick={() => setShowMineOnly(false)}
            aria-pressed={!showMineOnly}
          >
            {t('home.filterAll')}
          </button>
          <button
            type="button"
            className={showMineOnly ? 'on' : ''}
            onClick={() => setShowMineOnly(true)}
            aria-pressed={showMineOnly}
          >
            {t('home.filterMine')} ({ownedCount})
          </button>
        </div>
      )}

      {!loaded && <div className="subtle">{t('home.recentLoading')}</div>}
      {loaded && visible.length === 0 && (
        <div className="note">{t('home.recentEmpty')}</div>
      )}
      {visible.length > 0 && (
        <div className="recent-list">
          {visible.map((g) => (
            <Link key={g.primary.id} to={`/s/${g.primary.id}`} className="recent-card">
              <div className="thumb">
                {g.primary.cover_image_url
                  ? <img src={g.primary.cover_image_url} alt={g.primary.title} />
                  : <span style={{ fontSize: 60 }}>{'\u{1F4D6}'}</span>}
              </div>
              <div className="meta">
                <b>{g.primary.title}</b>
                <span>v{g.primary.latest_version}</span>
                {g.languages.length > 1 && (
                  <span className="flag-row" aria-label={`Available languages: ${g.languages.join(', ')}`}>
                    {g.languages.map((l) => (
                      <span
                        key={l}
                        className={`flag${l === g.primary.language ? ' flag--current' : ''}`}
                        aria-hidden="true"
                      >
                        {LANG_FLAG[l]}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}
