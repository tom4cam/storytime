import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { AudioBar, type AudioBarRef } from '../components/AudioBar';
import { ShareButton } from '../components/ShareButton';
import { deleteStory, deleteStoryVersion, getStory, setStars as apiSetStars, translateStory as apiTranslate, updateStoryListing } from '../api';
import { getCreatorId } from '../creatorId';
import { isAdmin } from '../adminToken';
import { ConfirmTyped } from '../components/ConfirmTyped';
import { useAudioSync } from '../audioSync';
import { useLang, useT, type Lang as UiLang } from '../i18n';
import { LOCALES } from '../i18n/locales';
import { LANG_FLAG } from '../lang';
import type { Lang, StoryVersionWithSiblings, WordTiming } from '../types';
import { imageAlt } from '../imageAlt';

const POLL_INTERVAL_MS = 10000;

export function StoryPage() {
  const t = useT();
  const { lang } = useLang();
  const navigate = useNavigate();
  const { id, version } = useParams<{ id: string; version?: string }>();
  const [story, setStory] = useState<StoryVersionWithSiblings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);
  const audioRef = useRef<AudioBarRef | null>(null);
  const activeIndex = useAudioSync(audioRef, story?.narration_words);
  const lastScrolledParaRef = useRef<number>(-1);
  // When the user clicks a word while audio is paused we play just that
  // one word and auto-pause. This ref holds the disarm function so a
  // follow-up click can cancel the pending pause before scheduling its own.
  const pendingPauseRef = useRef<(() => void) | null>(null);

  // Disarm any pending one-shot pause when the story changes or the
  // page unmounts, otherwise a listener could fire against a stale audio
  // element when the next story loads.
  useEffect(() => {
    return () => {
      pendingPauseRef.current?.();
      pendingPauseRef.current = null;
    };
  }, [story?.id, story?.version]);

  const onWordClick = (w: WordTiming) => {
    const el = audioRef.current;
    if (!el) return;
    // Whether playback should stop after this one word. "Auto-pause is
    // already armed" counts as paused so rapid clicks behave consistently.
    const wasPaused = el.paused || el.ended || pendingPauseRef.current !== null;
    pendingPauseRef.current?.();
    pendingPauseRef.current = null;
    el.currentTime = w.start;
    // Words with degenerate timing (e.g. Whisper alignment failures stamped
    // (0, 0)) have no usable duration. Falling into the auto-pause path
    // would pause the audio instantly without playing anything, so for the
    // paused case we just seek and let the user use the audio controls.
    const usableDuration = w.end - w.start > 0.05;
    if (wasPaused && usableDuration) {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener('timeupdate', onTime);
        window.clearTimeout(timer);
        pendingPauseRef.current = null;
        // Rewind to the word's start so pressing play resumes from this
        // word, not from the moment of auto-pause (which sits at w.end).
        try { el.currentTime = w.start; } catch { /* ignore */ }
      };
      const onTime = () => {
        if (el.currentTime >= w.end) { el.pause(); finish(); }
      };
      // Fallback timer in case timeupdate stalls. ElevenLabs word
      // durations are typically 150-400ms; a small buffer avoids
      // clipping the trailing phoneme.
      const rate = el.playbackRate || 1;
      const ms = Math.max(50, ((w.end - w.start) * 1000) / rate) + 40;
      const timer = window.setTimeout(() => { el.pause(); finish(); }, ms);
      el.addEventListener('timeupdate', onTime);
      pendingPauseRef.current = finish;
    }
    void el.play();
  };
  const myId = getCreatorId();
  const isOwner = !!story?.creator_id && story.creator_id !== 'system' && story.creator_id === myId;
  const admin = isAdmin();
  const [adminAction, setAdminAction] = useState<null | { kind: 'version'; version: number } | { kind: 'story' }>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [listed, setListedLocal] = useState<boolean>(story?.listed !== false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [translatePickerOpen, setTranslatePickerOpen] = useState(false);
  const [translatingLangs, setTranslatingLangs] = useState<Set<Lang>>(new Set());
  const [translatedLangs, setTranslatedLangs] = useState<Map<Lang, { id: string }>>(new Map());
  const [translateErrors, setTranslateErrors] = useState<Map<Lang, string>>(new Map());

  const onSetStars = async (stars: number | null) => {
    if (!story) return;
    const prev = story.stars;
    setStory((s) => s ? { ...s, stars: stars ?? undefined } : s);
    try {
      const result = await apiSetStars(story.id, stars);
      setStory((s) => s ? { ...s, stars: result.stars ?? undefined } : s);
    } catch {
      setStory((s) => s ? { ...s, stars: prev } : s);
    }
  };

  const onPickTranslation = async (target: Lang) => {
    if (!story) return;
    if (translatingLangs.has(target) || translatedLangs.has(target)) return;
    setTranslatingLangs((s) => { const n = new Set(s); n.add(target); return n; });
    setTranslateErrors((m) => { const n = new Map(m); n.delete(target); return n; });
    try {
      const next = await apiTranslate(story.id, target);
      setTranslatedLangs((m) => { const n = new Map(m); n.set(target, { id: next.id }); return n; });
    } catch (e) {
      setTranslateErrors((m) => {
        const n = new Map(m);
        n.set(target, `${t('story.translateError')} (${(e as Error).message})`);
        return n;
      });
    } finally {
      setTranslatingLangs((s) => { const n = new Set(s); n.delete(target); return n; });
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

  return (
    <Layout showExit>
      <h1 className="story-title">{story.title}</h1>
      {story.siblings.length > 0 && (
        <div className="flag-row" aria-label="Switch language">
          <span className="flag flag--current" aria-hidden="true">
            {LANG_FLAG[story.language as Lang]}
          </span>
          {story.siblings.map((s) => (
            <Link
              key={s.id}
              to={`/s/${s.id}`}
              className="flag"
              aria-label={`Switch to ${s.language}`}
            >
              {LANG_FLAG[s.language]}
            </Link>
          ))}
        </div>
      )}
      {story.series && (
        <div>
          <span className="series-badge" aria-label={`Part ${story.series.position} of ${story.series.members.length}`}>
            Part {story.series.position} of {story.series.members.length}
          </span>
        </div>
      )}
      {isOwner && (
        <div className="star-row" aria-label="Story rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={`star${(story.stars ?? 0) >= n ? ' star--on' : ''}`}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              aria-pressed={(story.stars ?? 0) >= n}
              onClick={() => onSetStars(n)}
            >
              {(story.stars ?? 0) >= n ? '★' : '☆'}
            </button>
          ))}
          {(story.stars ?? 0) > 0 && (
            <button
              type="button"
              className="star-clear"
              aria-label="Clear rating"
              title="Clear rating"
              onClick={() => onSetStars(null)}
            >
              {'✕'}
            </button>
          )}
        </div>
      )}
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

      {admin && (
        <div className="row no-print" style={{ justifyContent: 'center', marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
          <span className="subtle">{t('story.adminBadge')}:</span>
          {versionLinks.map((v) => (
            <button
              key={v}
              type="button"
              className="btn danger-ghost"
              onClick={() => { setAdminError(null); setAdminAction({ kind: 'version', version: v }); }}
            >
              {t('story.adminDeleteVersion')} (v{v})
            </button>
          ))}
        </div>
      )}

      {story.paragraphs.map((p, i) => (
        <div className={`paragraph ${i % 2 === 1 ? 'flip' : ''}`} key={i} data-para={i}>
          <div className="p-image">
            {p.image_url
              ? <img src={p.image_url} alt={imageAlt(p)} />
              : <div className="placeholder">No picture for this part.</div>}
          </div>
          <div className="p-text">
            {renderParagraph(p.text, i, words, activeIndex, onWordClick)}
          </div>
        </div>
      ))}

      {story.series && (() => {
        const { members, position } = story.series;
        const prev = members.find((m) => m.position === position - 1);
        const next = members.find((m) => m.position === position + 1);
        return (prev || next) ? (
          <div className="series-nav no-print">
            {prev
              ? <Link to={`/s/${prev.id}`} className="btn">← Part {prev.position}: {prev.title}</Link>
              : <span />}
            {next
              ? <Link to={`/s/${next.id}`} className="btn">Part {next.position}: {next.title} →</Link>
              : <span />}
          </div>
        ) : null;
      })()}

      <div className="row no-print" style={{ justifyContent: 'center', marginTop: 24 }}>
        <Link to={`/s/${story.id}/edit`} className="btn secondary">{t('story.editLink')}</Link>
        <button type="button" className="btn ghost" onClick={() => window.print()}>
          {t('story.download')}
        </button>
        <ShareButton title={story.title} />
        <button type="button" className="btn ghost" onClick={() => setTranslatePickerOpen((v) => !v)}>
          {t('story.translate')}
        </button>
        <Link to="/create" className="btn">{t('story.makeAnother')}</Link>
      </div>

      {translatePickerOpen && story && (
        <div className="card no-print" style={{ marginTop: 12 }}>
          <div className="question">{t('story.translateChoose')}</div>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
            {(['en','sv','bg','es','fr'] as const)
              .filter((c) => c !== story.language)
              .map((code) => {
                const label = t(`settings.language${code[0].toUpperCase()}${code[1]}` as 'settings.languageEn');
                const ready = translatedLangs.get(code);
                if (ready) {
                  return (
                    <Link key={code} to={`/s/${ready.id}`} className="btn">
                      {t('story.translateOpen', { lang: label })}
                    </Link>
                  );
                }
                const inFlight = translatingLangs.has(code);
                return (
                  <button
                    key={code}
                    type="button"
                    className="btn"
                    disabled={inFlight}
                    onClick={() => onPickTranslation(code)}
                  >
                    {inFlight ? `${label}…` : label}
                  </button>
                );
              })}
          </div>
          {translatingLangs.size > 0 && (
            <div className="subtle" style={{ marginTop: 8 }}>{t('story.translating')}</div>
          )}
          {Array.from(translateErrors.entries()).map(([code, msg]) => (
            <div key={code} className="error" style={{ marginTop: 8 }}>{msg}</div>
          ))}
        </div>
      )}

      {isOwner && (
        <div className="row no-print" style={{ justifyContent: 'center', marginTop: 16 }}>
          {story.series
            ? <Link to={`/create?series=${story.series.series_id}&from=${story.id}`} className="btn ghost">Make a sequel</Link>
            : <Link to={`/create?series=${story.id}&from=${story.id}`} className="btn ghost">Make a sequel</Link>}
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

      {admin && !adminAction && (
        <div className="row no-print" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button
            type="button"
            className="btn danger-ghost"
            onClick={() => { setAdminError(null); setAdminAction({ kind: 'story' }); }}
          >
            {t('story.adminForceDelete')}
          </button>
        </div>
      )}

      {adminError && <div className="error">{adminError}</div>}

      {admin && adminAction?.kind === 'version' && (
        <ConfirmTyped
          title={t('story.adminDeleteVersionConfirm', { n: String(adminAction.version) })}
          body={t('story.adminDeleteVersionBody')}
          onCancel={() => setAdminAction(null)}
          onConfirm={async () => {
            if (!story) return;
            try {
              const result = await deleteStoryVersion(story.id, adminAction.version);
              if (result.removedStory) {
                navigate('/');
                return;
              }
              // Navigate to the new latest (or stay on the still-existing one).
              if (result.newLatest !== undefined) {
                navigate(`/s/${story.id}`);
              }
              setAdminAction(null);
            } catch (e) {
              setAdminError((e as Error).message);
              throw e;
            }
          }}
        />
      )}

      {admin && adminAction?.kind === 'story' && (
        <ConfirmTyped
          title={t('story.adminForceDeleteConfirm')}
          body={t('story.adminForceDeleteBody')}
          onCancel={() => setAdminAction(null)}
          onConfirm={async () => {
            if (!story) return;
            try {
              await deleteStory(story.id);
              navigate('/');
            } catch (e) {
              setAdminError((e as Error).message);
              throw e;
            }
          }}
        />
      )}

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
  onWordClick: (w: WordTiming) => void,
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
    const isCurrent = flatIdx === activeIndex && activeIndex >= 0;
    return (
      <span key={`${w.paragraphIndex}-${w.wordIndex}`}>
        <button
          type="button"
          className={`word${isCurrent ? ' is-current' : ''}`}
          data-pw={`${w.paragraphIndex}-${w.wordIndex}`}
          onClick={() => onWordClick(w)}
        >
          {w.word}
        </button>
        {localIdx < wordsForPara.length - 1 ? ' ' : ''}
      </span>
    );
  });
}

function formatDate(s: string, lang: UiLang): string {
  try {
    const d = new Date(s);
    return d.toLocaleDateString(LOCALES[lang], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s; }
}
