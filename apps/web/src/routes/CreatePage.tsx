import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { MicInput } from '../components/MicInput';
import { createStory } from '../api';
import { cancelSpeech, speak } from '../speech';
import type { StoryAnswer } from '../types';

interface Question {
  id: string;
  prompt: string;
  spoken: string;
  placeholder: string;
  required: boolean;
}

// The first three are required. The remaining ones are offered as optional
// extras once the kid has the basics; this matches the spec's "2 to 6
// adaptive questions" intent.
const QUESTIONS: Question[] = [
  {
    id: 'hero',
    prompt: 'Who is the hero of your story?',
    spoken: 'Who is the hero of your story? Tell me a name and what they are like.',
    placeholder: 'Example: a brave bunny named Pip who loves cookies',
    required: true,
  },
  {
    id: 'setting',
    prompt: 'Where does the story happen?',
    spoken: 'Where does the story happen?',
    placeholder: 'Example: in a magic forest, or on a pirate ship',
    required: true,
  },
  {
    id: 'goal',
    prompt: 'What does your hero want or need?',
    spoken: 'What does your hero want or need?',
    placeholder: 'Example: to find the world’s biggest pancake',
    required: true,
  },
  {
    id: 'friend',
    prompt: 'Is there a friend or a helper? Who is it?',
    spoken: 'Is there a friend or a helper? Who is it?',
    placeholder: 'Example: a wise old turtle named Sage',
    required: false,
  },
  {
    id: 'problem',
    prompt: 'What problem do they have to solve?',
    spoken: 'What problem do they have to solve?',
    placeholder: 'Example: the bridge to the pancake mountain is broken',
    required: false,
  },
  {
    id: 'ending',
    prompt: 'How should the story end?',
    spoken: 'How should the story end? Happy, silly, or surprising?',
    placeholder: 'Example: happy and silly, with a big pancake party',
    required: false,
  },
];

export function CreatePage() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spokenForRef = useRef<number>(-1);
  const navigate = useNavigate();

  const q = QUESTIONS[step];
  const totalDone = Object.keys(answers).length;
  const minDone = QUESTIONS.filter((x) => x.required).length;
  const canFinish = totalDone >= minDone;
  const isLastQuestion = step >= QUESTIONS.length - 1;

  useEffect(() => {
    if (!q) return;
    if (spokenForRef.current === step) return;
    spokenForRef.current = step;
    speak(q.spoken);
    return () => cancelSpeech();
  }, [step, q]);

  useEffect(() => () => cancelSpeech(), []);

  if (!q) {
    return (
      <Layout>
        <div className="card">
          <div className="question">All set.</div>
          <p>Tap "Make my story" to put it all together.</p>
        </div>
      </Layout>
    );
  }

  const acceptCurrent = () => {
    const trimmed = current.trim();
    if (!trimmed) {
      setError('Please type or speak an answer first.');
      return;
    }
    setError(null);
    setAnswers((prev) => ({ ...prev, [q.id]: trimmed }));
    setCurrent('');
    setStep((s) => s + 1);
  };

  const skipOptional = () => {
    setError(null);
    setCurrent('');
    setStep((s) => s + 1);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const payload: StoryAnswer[] = QUESTIONS
      .filter((qq) => answers[qq.id])
      .map((qq) => ({ question: qq.prompt, answer: answers[qq.id] }));
    try {
      const story = await createStory(payload);
      navigate(`/s/${story.id}`);
    } catch (e) {
      setSubmitting(false);
      setError((e as Error).message);
    }
  };

  if (submitting) {
    return (
      <Layout>
        <div className="card loading">
          <div className="spinner" />
          <div className="question">Making your story...</div>
          <p className="subtle">
            Writing the words, drawing the pictures, and recording the
            voice. This takes about a minute.
          </p>
        </div>
      </Layout>
    );
  }

  const progressPct = Math.min(100, Math.round(((step) / QUESTIONS.length) * 100));

  return (
    <Layout>
      <div className="progress" aria-hidden="true">
        <div style={{ width: `${progressPct}%` }} />
      </div>
      <div className="card">
        <div className="question">{q.prompt}</div>
        <p className="subtle">
          {q.required
            ? 'You need to answer this one.'
            : 'This one is optional. Add more if you want, or skip ahead.'}
        </p>
        <button type="button" className="btn ghost" onClick={() => speak(q.spoken)}>
          Hear the question again
        </button>

        <div style={{ marginTop: 16 }}>
          <MicInput
            value={current}
            onChange={setCurrent}
            placeholder={q.placeholder}
            ariaLabel={q.prompt}
          />
        </div>

        {error && <div className="error">{error}</div>}

        <div className="row between" style={{ marginTop: 16 }}>
          <div className="row">
            {!q.required && (
              <button type="button" className="btn ghost" onClick={skipOptional}>
                Skip this
              </button>
            )}
          </div>
          <div className="row">
            {canFinish && !isLastQuestion && (
              <button type="button" className="btn secondary" onClick={submit}>
                Make my story
              </button>
            )}
            <button type="button" className="btn" onClick={acceptCurrent}>
              {isLastQuestion ? 'Save answer' : 'Next'}
            </button>
            {canFinish && isLastQuestion && (
              <button type="button" className="btn sun" onClick={submit}>
                Make my story
              </button>
            )}
          </div>
        </div>
      </div>

      {totalDone > 0 && (
        <div className="card">
          <div className="subtle" style={{ marginBottom: 6 }}>So far:</div>
          <ul className="answer-list">
            {QUESTIONS.filter((qq) => answers[qq.id]).map((qq) => (
              <li key={qq.id}>
                <b>{qq.prompt}</b><br />
                {answers[qq.id]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Layout>
  );
}
