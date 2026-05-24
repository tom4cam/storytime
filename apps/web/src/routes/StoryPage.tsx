import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { getStory } from '../api';
import type { StoryVersion } from '../types';

export function StoryPage() {
  const { id, version } = useParams<{ id: string; version?: string }>();
  const [story, setStory] = useState<StoryVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const v = version ? parseInt(version, 10) : undefined;
    getStory(id, v)
      .then(setStory)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id, version]);

  if (loading) {
    return (
      <Layout>
        <div className="card loading">
          <div className="spinner" />
          <p>Opening the story...</p>
        </div>
      </Layout>
    );
  }

  if (error || !story) {
    return (
      <Layout>
        <div className="error">{error ?? 'Story not found.'}</div>
        <Link to="/" className="btn">Back to home</Link>
      </Layout>
    );
  }

  const versionLinks = Array.from({ length: story.version }, (_, i) => i + 1);

  return (
    <Layout>
      <h1 className="story-title">{story.title}</h1>
      <div className="story-meta">
        Version {story.version} (saved {formatDate(story.created_at)})
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
        <Link to={`/s/${story.id}/edit`} className="btn secondary">Edit this story</Link>
        <Link to="/create" className="btn">Make a new one</Link>
      </div>
    </Layout>
  );
}

function formatDate(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return s;
  }
}
