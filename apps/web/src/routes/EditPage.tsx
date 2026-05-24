import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { getStory, updateStory } from '../api';
import type { Paragraph, StoryVersion } from '../types';

interface DraftParagraph extends Paragraph {
  regenerate_image?: boolean;
}

export function EditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [story, setStory] = useState<StoryVersion | null>(null);
  const [title, setTitle] = useState('');
  const [paragraphs, setParagraphs] = useState<DraftParagraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getStory(id)
      .then((s) => {
        setStory(s);
        setTitle(s.title);
        setParagraphs(s.paragraphs.map((p) => ({ ...p })));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  const updateParagraph = (i: number, patch: Partial<DraftParagraph>) => {
    setParagraphs((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const save = async () => {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateStory(
        id,
        paragraphs.map((p) => ({
          text: p.text,
          image_url: p.regenerate_image ? null : p.image_url,
          image_prompt: p.image_prompt,
          regenerate_image: !!p.regenerate_image,
        })),
        title
      );
      navigate(`/s/${next.id}`);
    } catch (e) {
      setSaving(false);
      setError((e as Error).message);
    }
  };

  if (loading) {
    return <Layout><div className="card loading"><div className="spinner" /><p>Loading the story...</p></div></Layout>;
  }
  if (error || !story) {
    return <Layout><div className="error">{error ?? 'Story not found.'}</div></Layout>;
  }
  if (saving) {
    return (
      <Layout>
        <div className="card loading">
          <div className="spinner" />
          <div className="question">Saving the new version...</div>
          <p className="subtle">Re recording the audio (and any new pictures).</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <h1 className="story-title">Edit story</h1>
      <p className="story-meta">Saving will create version {story.version + 1}.</p>

      <div className="card">
        <label className="question" htmlFor="title">Title</label>
        <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      {paragraphs.map((p, i) => (
        <div className="card" key={i}>
          <div className="question">Paragraph {i + 1}</div>
          <textarea
            value={p.text}
            rows={5}
            onChange={(e) => updateParagraph(i, { text: e.target.value })}
            aria-label={`Paragraph ${i + 1} text`}
          />
          <div className="row" style={{ marginTop: 12 }}>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={!!p.regenerate_image}
                onChange={(e) => updateParagraph(i, { regenerate_image: e.target.checked })}
              />
              Regenerate this picture when I save
            </label>
          </div>
          {p.image_url && !p.regenerate_image && (
            <div style={{ marginTop: 12 }}>
              <img src={p.image_url} alt={`Illustration ${i + 1}`} style={{ maxWidth: 240, borderRadius: 16, border: '3px solid var(--ink)' }} />
            </div>
          )}
        </div>
      ))}

      <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
        <Link to={`/s/${story.id}`} className="btn ghost">Cancel</Link>
        <button type="button" className="btn sun" onClick={save}>Save as new version</button>
      </div>
    </Layout>
  );
}
