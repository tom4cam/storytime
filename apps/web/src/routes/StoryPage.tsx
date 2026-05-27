import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { AudioBar, type AudioBarRef } from '../components/AudioBar';
import { deleteStory, getStory, translateStory as apiTranslate, updateStoryListing } from '../api';
import { getCreatorId } from '../creatorId';
import { useAudioSync } from '../audioSync';
import { useLang, useT } from '../i18n';
import { LOCALES } from '../i18n/locales';
import type { StoryVersion, WordTiming } from '../types';

const POLL_INTERVAL_MS = 10000;

export function StoryPage() {
  const t = useT();
  const { lang } = useLang();
  const navigate = useNavigate();
  const { id, version } = useParams<{ id: string; version?: string }>();
  const [story, setStory] = useState<StoryVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);
  const audioRef = useRef<AudioBarRef | null>(null);
  const activeIndex = useAudioSync(audioRef, story?.narration_words);
  const lastScrolledParaRef = useRef<number>(-1);
  const myId = getCreatorId();
  const isOwner = !!story?.creator_id && story.creator_id !== 'system' && story.creator_id === myId;
  const [listed, setListedLocal] = useState<boolean>(story?.listed !== false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [translatePickerOpen, setTranslatePickerOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const onPickTranslation = async (target: 'en' | 'sv' | 'bg' | 'es' | 'fr') => {
    if (!story) return;
    setTranslating(true);
    setTranslateError(null);
    try {
      const next = await apiTranslate(story.id, target);
      navigate(`/s/${next.id}`);
    } catch (e) {
      setTranslating(false);
      setTranslateError(`${t('story.translateError')} (${(e as Error).message})`);
    }
  };

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

  // Toggle a body class while an audio bar is mounted, so global padding
  // keeps the last paragraph from being hidden behind the bottom-fixed bar.
  useEffect(() => {
    if (!story?.narration_url) return;
    document.body.classList.add('has-audio-bar');
    return () => document.body.classList.remove('has-audio-bar');
  }, [story?.narration_url]);

  // Auto-scroll the active paragraph into view whenever it changes.
  useEffect(() => {
    if (activeIndex < 0 || !story?.narration_words) return;
    const para = story.narration_words[activeIndex]?.paragraphIndex ?? -1;
    if (para < 0 || para === lastScrolledParaRef.current) return;
    lastScrolledParaRef.current = para;
    const el = document.querySelector<HTMLElement>(`[data-para="${para}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex, story?.narration_words]);

  // Sync listed state whenever the story changes.
  useEffect(() => {
    if (story) setListedLocal(story.listed !== false);
  }, [story?.id, story?.listed]);

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
  const words = story.narration_words;
  // Highlight just the active word plus the next one (2 words max).
  const windowStart = activeIndex;
  const windowEnd = activeIndex + 1;

  return (
    <Layout showExit>
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

      {story.paragraphs.map((p, i) => (
        <div className={`paragraph ${i % 2 === 1 ? 'flip' : ''}`} key={i} data-para={i}>
          <div className="p-image">
            {p.image_url
              ? <img src={p.image_url} alt={`Illustration for paragraph ${i + 1}`} />
              : <div className="placeholder">No picture for this part.</div>}
          </div>
          <div className="p-text">
            {renderParagraph(p.text, i, words, activeIndex, windowStart, windowEnd, audioRef)}
          </div>
        </div>
      ))}

      <div className="row no-print" style={{ justifyContent: 'center', marginTop: 24 }}>
        <Link to={`/s/${story.id}/edit`} className="btn secondary">{t('story.editLink')}</Link>
        <button type="button" className="btn ghost" onClick={() => window.print()}>
          {t('story.download')}
        </button>
        <button type="button" className="btn ghost" onClick={() => setTranslatePickerOpen((v) => !v)}>
          {t('story.translate')}
        </button>
        <Link to="/create" className="btn">{t('story.makeAnother')}</Link>
      </div>

      {translatePickerOpen && story && (
        <div className="card no-print" style={{ marginTop: 12 }}>
          <div className="question">{t('story.translateChoose')}</div>
          {translating && <div className="subtle">{t('story.translating')}</div>}
          {translateError && <div className="error">{translateError}</div>}
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
            {(['en','sv','bg','es','fr'] as const)
              .filter((c) => c !== story.language)
              .map((code) => (
                <button
                  key={code}
                  type="button"
                  className="btn"
                  disabled={translating}
                  onClick={() => onPickTranslation(code)}
                >
                  {t(`settings.language${code[0].toUpperCase()}${code[1]}` as 'settings.languageEn')}
                </button>
              ))}
          </div>
        </div>
      )}

      {isOwner && !confirmingDelete && (
        <div className="row no-print" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button
            type="button"
            className="btn ghost"
            onClick={async () => {
              if (!story) return;
              const next = !listed;
              setListedLocal(next);
              setListingError(null);
              try {
                await updateStoryListing(story.id, next);
              } catch (e) {
                setListedLocal(!next);
                setListingError(`${t('story.listingFailed')} (${(e as Error).message})`);
              }
            }}
          >
            {listed ? t('story.listed') : t('story.unlisted')}
          </button>
          <button type="button" className="btn danger-ghost" onClick={() => setConfirmingDelete(true)}>
            {t('story.delete')}
          </button>
        </div>
      )}

      {listingError && <div className="error">{listingError}</div>}

      {isOwner && confirmingDelete && (
        <div className="card delete-confirm no-print" style={{ marginTop: 16 }}>
          <div className="question">{t('story.deleteConfirmTitle')}</div>
          <p>{t('story.deleteConfirmBody')}</p>
          {deleteError && <div className="error">{deleteError}</div>}
          <div className="row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn danger"
              disabled={deleting}
              onClick={async () => {
                if (!id) return;
                setDeleting(true);
                setDeleteError(null);
                try {
                  await deleteStory(id);
                  navigate('/');
                } catch (e) {
                  setDeleting(false);
                  setDeleteError(`${t('story.deleteFailed')} (${(e as Error).message})`);
                }
              }}
            >
              {deleting ? '...' : t('story.deleteYes')}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={deleting}
              onClick={() => { setConfirmingDelete(false); setDeleteError(null); }}
            >
              {t('story.deleteNo')}
            </button>
          </div>
        </div>
      )}

      {story.narration_url && (
        <AudioBar ref={audioRef} src={story.narration_url} />
      )}
    </Layout>
  );
}

function renderParagraph(
  text: string,
  paragraphIndex: number,
  words: WordTiming[] | undefined,
  activeIndex: number,
  windowStart: number,
  windowEnd: number,
  audioRef: React.RefObject<HTMLAudioElement | null>
) {
  if (!words || words.length === 0) {
    return text;
  }
  const flatIndexes: number[] = [];
  const wordsForPara: WordTiming[] = [];
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].paragraphIndex === paragraphIndex) {
      flatIndexes.push(i);
      wordsForPara.push(words[i]);
    }
  }
  if (wordsForPara.length === 0) return text;

  return wordsForPara.map((w, localIdx) => {
    const flatIdx = flatIndexes[localIdx];
    const isCurrent = flatIdx >= windowStart && flatIdx <= windowEnd && activeIndex >= 0;
    return (
      <span key={`${w.paragraphIndex}-${w.wordIndex}`}>
        <button
          type="button"
          className={`word${isCurrent ? ' is-current' : ''}`}
          data-pw={`${w.paragraphIndex}-${w.wordIndex}`}
          onClick={() => {
            const el = audioRef.current;
            if (!el) return;
            el.currentTime = w.start;
            void el.play();
          }}
        >
          {w.word}
        </button>
        {localIdx < wordsForPara.length - 1 ? ' ' : ''}
      </span>
    );
  });
}

function formatDate(s: string, lang: 'en' | 'sv' | 'bg' | 'es' | 'fr'): string {
  try {
    const d = new Date(s);
    return d.toLocaleDateString(LOCALES[lang], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s; }
}
