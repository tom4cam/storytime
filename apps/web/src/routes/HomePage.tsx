import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { listStories } from '../api';
import { useT } from '../i18n';
import type { StorySummary } from '../types';

export function HomePage() {
  const t = useT();
  const [recent, setRecent] = useState<StorySummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    listStories()
      .then((items) => setRecent(items))
      .catch(() => { /* swallow: home still works without recent list */ })
      .finally(() => setLoaded(true));
  }, []);

  return (
    <Layout>
      <div className="hero">
        <h1>{t('home.heroTitle')}</h1>
        <p>{t('home.heroBody')}</p>
        <Link to="/create" className="btn sun">{t('home.heroCta')}</Link>
      </div>

      <h2 style={{ marginTop: 8 }}>{t('home.recentHeading')}</h2>
      {!loaded && <div className="subtle">{t('home.recentLoading')}</div>}
      {loaded && recent.length === 0 && (
        <div className="note">{t('home.recentEmpty')}</div>
      )}
      {recent.length > 0 && (
        <div className="recent-list">
          {recent.map((s) => (
            <Link key={s.id} to={`/s/${s.id}`} className="recent-card">
              <div className="thumb">
                {s.cover_image_url
                  ? <img src={s.cover_image_url} alt={s.title} />
                  : <span style={{ fontSize: 60 }}>{'\u{1F4D6}'}</span>}
              </div>
              <div className="meta">
                <b>{s.title}</b>
                <span>v{s.latest_version}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}
