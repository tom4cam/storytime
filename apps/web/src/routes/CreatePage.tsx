import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { MicInput } from '../components/MicInput';
import { VoicePicker } from '../components/VoicePicker';
import { HelpYesNo } from '../components/HelpYesNo';
import { ApiError, createStory, getStory, moderateText } from '../api';
import { cancelSpeech, speakBest, stopAskVoice } from '../speech';
import { useLang, useT } from '../i18n';
import type { Lang } from '../types';
import { usePrefs } from '../prefs';
import { defaultVoiceFor, findVoiceByKey, VOICES } from '../voices';
import { QUESTION_HELPERS } from '../createHelpers';
import { LANGS } from '../types';
import type { StoryAnswer } from '../types';
import type { StringKey } from '../i18n/strings/en';

function langKey(code: string): string {
  return code.split('-')
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase())
    .join('');
}

interface Question {
  id: string;
  promptKey: StringKey;
  spokenKey: StringKey;
  placeholderKey: StringKey;
  required: boolean;
}

const QUESTIONS: Question[] = [
  { id: 'hero', promptKey: 'q.hero.prompt', spokenKey: 'q.hero.spoken', placeholderKey: 'q.hero.placeholder', required: true },
  { id: 'setting', promptKey: 'q.setting.prompt', spokenKey: 'q.setting.spoken', placeholderKey: 'q.setting.placeholder', required: true },
  { id: 'goal', promptKey: 'q.goal.prompt', spokenKey: 'q.goal.spoken', placeholderKey: 'q.goal.placeholder', required: true },
  { id: 'friend', promptKey: 'q.friend.prompt', spokenKey: 'q.friend.spoken', placeholderKey: 'q.friend.placeholder', required: false },
  { id: 'problem', promptKey: 'q.problem.prompt', spokenKey: 'q.problem.spoken', placeholderKey: 'q.problem.placeholder', required: false },
  { id: 'ending', promptKey: 'q.ending.prompt', spokenKey: 'q.ending.spoken', placeholderKey: 'q.ending.placeholder', required: false },
];

const OPENER_CHIPS: { id: string; labelKey: StringKey }[] = [
  { id: 'adventure', labelKey: 'opener.chip.adventure' },
  { id: 'silly',     labelKey: 'opener.chip.silly' },
  { id: 'animals',   labelKey: 'opener.chip.animals' },
  { id: 'bedtime',   labelKey: 'opener.chip.bedtime' },
  { id: 'magic',     labelKey: 'opener.chip.magic' },
  { id: 'mystery',   labelKey: 'opener.chip.mystery' },
  { id: 'surprise',  labelKey: 'opener.chip.surprise' },
];

const SAFE_CHIPS: { id: string; labelKey: StringKey }[] = [
  { id: 'adventure', labelKey: 'opener.chip.adventure' },
  { id: 'silly',     labelKey: 'opener.chip.silly' },
  { id: 'animals',   labelKey: 'opener.chip.animals' },
];

type StepKind = 'lang' | 'opener' | 'voice' | 'rhyme' | 'q';

export function CreatePage() {
  const t = useT();
  const { lang: uiLang } = useLang();
  const [prefs] = usePrefs();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Series support: ?series=<series_id>&from=<source_story_id>
  const seriesParam = searchParams.get('series') ?? undefined;
  const fromParam = searchParams.get('from') ?? undefined;
  const [sourceTitle, setSourceTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!fromParam) return;
    getStory(fromParam).then((s) => setSourceTitle(s.title)).catch(() => { /* swallow */ });
  }, [fromParam]);

  const [storyLang, setStoryLang] = useState<Lang | null>(null);
  const [storyType, setStoryType] = useState<string | null>(null);
  const [openerText, setOpenerText] = useState('');
  const [modRedirect, setModRedirect] = useState(false);
  const [voiceKey, setVoiceKey] = useState<string>(() => defaultVoiceFor(uiLang).key);
  const [rhyme, setRhyme] = useState(false);
  const [stepKind, setStepKind] = useState<StepKind>('lang');
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simplerOn, setSimplerOn] = useState<Record<string, boolean>>({});
  const [helping, setHelping] = useState<string | null>(null);
  const spokenForKeyRef = useRef<string>('');

  const q = QUESTIONS[qIndex];
  const totalDone = Object.keys(answers).length;
  const minDone = QUESTIONS.filter((x) => x.required).length;
  const canFinish = totalDone >= minDone;
  const isLastQuestion = qIndex >= QUESTIONS.length - 1;
  const voiceMeta = findVoiceByKey(voiceKey) ?? defaultVoiceFor(storyLang ?? uiLang);

  const speakKey = (key: StringKey) => {
    if (!storyLang) return;
    const text = t(key);
    void speakBest(text, {
      language: storyLang,
      voiceId: voiceMeta.voiceId,
      speed: prefs.slow ? 0.75 : undefined,
    });
  };

  // Speak whenever the spoken prompt for this step changes.
  useEffect(() => {
    if (!storyLang) return;
    let spokenKey: StringKey | null = null;
    let stepId = '';
    if (stepKind === 'opener') { spokenKey = 'opener.spoken'; stepId = 'opener'; }
    else if (stepKind === 'voice') { spokenKey = 'voice.stepTitle'; stepId = 'voice'; }
    else if (stepKind === 'q' && q) {
      spokenKey = (simplerOn[q.id] && QUESTION_HELPERS[q.id]?.simplerKey) || q.spokenKey;
      stepId = `q-${q.id}-${simplerOn[q.id] ? 'simpler' : 'normal'}`;
    }
    if (spokenKey && spokenForKeyRef.current !== stepId) {
      spokenForKeyRef.current = stepId;
      speakKey(spokenKey);
    }
    return () => { cancelSpeech(); stopAskVoice(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKind, qIndex, storyLang, simplerOn, voiceKey, prefs.slow]);

  useEffect(() => () => { cancelSpeech(); stopAskVoice(); }, []);

  const seriesBanner = seriesParam && (
    <div className="series-badge" style={{ display: 'block', marginBottom: 16 }}>
      {sourceTitle ? `This will be a sequel to "${sourceTitle}"` : 'This will be added to a series'}
    </div>
  );

  // -----------------------------------------------------------
  // STEP: pick story language
  // -----------------------------------------------------------
  if (!storyLang) {
    return (
      <Layout>
        {seriesBanner}
        <div className="card">
          <div className="question">{t('create.langStepTitle')}</div>
          <div className="lang-grid" style={{ marginTop: 16 }}>
            {LANGS.map((code) => (
              <button
                key={code}
                type="button"
                className={`btn${uiLang === code ? ' sun' : ''}`}
                onClick={() => { setStoryLang(code); setVoiceKey(defaultVoiceFor(code).key); setStepKind('opener'); }}
              >
                {t(`create.langStep${langKey(code)}` as 'create.langStepEn')}
              </button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <a
              href="mailto:tom.caswell@saylor.org?subject=Storytime%20language%20request&body=Please%20add%20support%20for%3A%20"
              className="btn ghost"
              style={{ fontSize: 16 }}
            >
              {t('create.requestLang')}
            </a>
          </div>
          <p className="subtle" style={{ marginTop: 16 }}>
            {t('home.heroBody')}
          </p>
        </div>
      </Layout>
    );
  }

  // -----------------------------------------------------------
  // STEP: story-type opener
  // -----------------------------------------------------------
  if (stepKind === 'opener') {
    const advanceWith = (typeId: string, typeLabel: string) => {
      setStoryType(typeId);
      setAnswers((prev) => ({ ...prev, type: typeLabel }));
      setModRedirect(false);
      setStepKind('voice');
    };
    const submitFreeText = async () => {
      const text = openerText.trim();
      if (!text) {
        setError(t('create.typeOrSpeak'));
        return;
      }
      setError(null);
      // Client-side moderation before storing.
      try {
        const { flagged } = await moderateText(text);
        if (flagged) { setModRedirect(true); return; }
      } catch { /* moderation network failure → let user proceed; server-side guard still runs */ }
      advanceWith('custom', text);
    };

    if (modRedirect) {
      return (
        <Layout>
          <div className="card">
            <div className="question">{t('mod.redirectTitle')}</div>
            <p>{t('mod.redirectBody')}</p>
            <div className="chip-grid">
              {SAFE_CHIPS.map((c) => (
                <button key={c.id} type="button" className="chip" onClick={() => advanceWith(c.id, t(c.labelKey))}>
                  {t(c.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </Layout>
      );
    }

    return (
      <Layout>
        <div className="card">
          <div className="question">{t('opener.title')}</div>
          <button type="button" className="btn ghost" onClick={() => speakKey('opener.spoken')}>
            {t('create.hearAgain')}
          </button>
          <div className="chip-grid">
            {OPENER_CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip${storyType === c.id ? ' selected' : ''}`}
                onClick={() => advanceWith(c.id, t(c.labelKey))}
              >
                {t(c.labelKey)}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <label htmlFor="opener-custom" className="sr-only">{t('opener.placeholder')}</label>
            <input
              id="opener-custom"
              type="text"
              value={openerText}
              placeholder={t('opener.placeholder')}
              onChange={(e) => setOpenerText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitFreeText(); }}
            />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row right" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={submitFreeText}>{t('create.next')}</button>
          </div>
        </div>
      </Layout>
    );
  }

  // -----------------------------------------------------------
  // STEP: voice picker
  // -----------------------------------------------------------
  if (stepKind === 'voice') {
    return (
      <Layout>
        <div className="card">
          <div className="question">{t('voice.stepTitle')}</div>
          <button type="button" className="btn ghost" onClick={() => speakKey('voice.stepTitle')}>
            {t('create.hearAgain')}
          </button>
          <div style={{ marginTop: 16 }}>
            <VoicePicker value={voiceKey} onChange={setVoiceKey} />
          </div>
          <div className="row right" style={{ marginTop: 12 }}>
            <button type="button" className="btn sun" onClick={() => { setStepKind('rhyme'); }}>
              {t('voice.next')}
            </button>
          </div>
          <p className="subtle" style={{ marginTop: 12 }}>
            {VOICES.length} {VOICES.length === 1 ? 'voice' : 'voices'} available.
          </p>
        </div>
      </Layout>
    );
  }

  // -----------------------------------------------------------
  // STEP: rhyme yes/no
  // -----------------------------------------------------------
  if (stepKind === 'rhyme') {
    return (
      <Layout showExit>
        <div className="card">
          <div className="question">{t('rhyme.stepTitle')}</div>
          <div className="row" style={{ justifyContent: 'center', gap: 16, marginTop: 16 }}>
            <button type="button" className="btn sun" onClick={() => { setRhyme(true); setStepKind('q'); setQIndex(0); }}>
              {t('rhyme.yes')}
            </button>
            <button type="button" className="btn ghost" onClick={() => { setRhyme(false); setStepKind('q'); setQIndex(0); }}>
              {t('rhyme.no')}
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // -----------------------------------------------------------
  // STEP: questions (existing flow)
  // -----------------------------------------------------------
  if (!q) {
    return (
      <Layout>
        <div className="card">
          <div className="question">{t('create.allSet')}</div>
          <p>{t('create.allSetHint')}</p>
        </div>
      </Layout>
    );
  }

  const acceptCurrent = () => {
    const trimmed = current.trim();
    if (!trimmed) {
      setError(t('create.typeOrSpeak'));
      return;
    }
    setError(null);
    setAnswers((prev) => ({ ...prev, [q.id]: trimmed }));
    setCurrent('');
    setQIndex((s) => s + 1);
  };

  const skipOptional = () => {
    setError(null);
    setCurrent('');
    setQIndex((s) => s + 1);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const payload: StoryAnswer[] = [];
    if (answers.type) payload.push({ question: t('opener.title'), answer: answers.type });
    for (const qq of QUESTIONS) {
      if (answers[qq.id]) {
        payload.push({ question: t(qq.promptKey), answer: answers[qq.id] });
      }
    }
    try {
      const story = await createStory(payload, storyLang, voiceMeta.voiceId, rhyme, seriesParam);
      navigate(`/s/${story.id}`);
    } catch (e) {
      setSubmitting(false);
      if (e instanceof ApiError && e.status === 422) {
        // Moderation reject. Reset the wizard so the user can pick
        // a safe theme from SAFE_CHIPS instead of seeing a raw error.
        setStoryType(null);
        setOpenerText('');
        setAnswers({});
        setCurrent('');
        setQIndex(0);
        setStepKind('opener');
        setModRedirect(true);
        setError(null);
        return;
      }
      setError((e as Error).message);
    }
  };

  if (submitting) {
    return (
      <Layout>
        <div className="card loading">
          <div className="spinner" />
          <div className="question">{t('create.sending')}</div>
        </div>
      </Layout>
    );
  }

  const helpers = QUESTION_HELPERS[q.id];
  const isSimpler = !!simplerOn[q.id];
  const displayPromptKey: StringKey = isSimpler && helpers?.simplerKey ? helpers.simplerKey : q.promptKey;
  const progressPct = Math.min(100, Math.round((qIndex / QUESTIONS.length) * 100));

  return (
    <Layout>
      <div className="progress" aria-hidden="true">
        <div style={{ width: `${progressPct}%` }} />
      </div>
      <div className="card">
        <div className="question">{t(displayPromptKey)}</div>
        <p className="subtle">
          {q.required ? t('create.required') : t('create.optional')}
        </p>
        <div className="helper-row">
          <button type="button" className="btn ghost" onClick={() => speakKey(displayPromptKey)}>
            {t('create.hearAgain')}
          </button>
          {helpers?.simplerKey && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setSimplerOn((s) => ({ ...s, [q.id]: !s[q.id] }))}
            >
              {isSimpler ? t('help.original') : t('help.simpler')}
            </button>
          )}
          {helpers?.tree && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setHelping(q.id)}
            >
              {t('help.yesno')}
            </button>
          )}
        </div>

        {helping === q.id && helpers?.tree && (
          <div style={{ marginTop: 16 }}>
            <HelpYesNo
              tree={helpers.tree}
              language={uiLang}
              onAnswer={(text) => {
                setCurrent((c) => (c ? c + ' ' + text : text));
                setHelping(null);
              }}
              onCancel={() => setHelping(null)}
            />
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <MicInput
            value={current}
            onChange={setCurrent}
            placeholder={t(q.placeholderKey)}
            ariaLabel={t(displayPromptKey)}
            language={storyLang}
          />
        </div>

        {error && <div className="error">{error}</div>}

        <div className="row between" style={{ marginTop: 16 }}>
          <div className="row">
            {!q.required && (
              <button type="button" className="btn ghost" onClick={skipOptional}>
                {t('create.skipThis')}
              </button>
            )}
          </div>
          <div className="row">
            {canFinish && !isLastQuestion && (
              <button type="button" className="btn secondary" onClick={submit}>
                {t('create.makeStory')}
              </button>
            )}
            <button type="button" className="btn" onClick={acceptCurrent}>
              {isLastQuestion ? t('create.saveAnswer') : t('create.next')}
            </button>
            {canFinish && isLastQuestion && (
              <button type="button" className="btn sun" onClick={submit}>
                {t('create.makeStory')}
              </button>
            )}
          </div>
        </div>
      </div>

      {totalDone > 0 && (
        <div className="card">
          <div className="subtle" style={{ marginBottom: 6 }}>{t('create.soFar')}</div>
          <ul className="answer-list">
            {answers.type && (
              <li>
                <b>{t('opener.title')}</b><br />
                {answers.type}
              </li>
            )}
            {QUESTIONS.filter((qq) => answers[qq.id]).map((qq) => (
              <li key={qq.id}>
                <b>{t(qq.promptKey)}</b><br />
                {answers[qq.id]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Layout>
  );
}
