// Browser speech helpers: text to speech for prompts, and a thin wrapper
// around the Web Speech API for short answers. STT support varies by browser
// (Chrome and Edge are best). Callers must always provide a keyboard fallback.

export function speak(text: string, opts?: { rate?: number; pitch?: number }): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = opts?.rate ?? 0.95;
      u.pitch = opts?.pitch ?? 1.05;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}

export function cancelSpeech() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

// --- ElevenLabs-quality question audio with a browser-TTS fallback ---

const askCache = new Map<string, Blob>();
let askAudio: HTMLAudioElement | null = null;

export interface AskVoiceOpts {
  language: 'en' | 'sv';
  voiceId: string;
  speed?: number;
}

export async function playAskVoice(text: string, opts: AskVoiceOpts): Promise<void> {
  const cacheKey = `${opts.language}|${opts.voiceId}|${opts.speed ?? 1}|${text}`;
  let blob = askCache.get(cacheKey);
  if (!blob) {
    const res = await fetch('/.netlify/functions/askVoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: opts.language, voiceId: opts.voiceId, speed: opts.speed }),
    });
    if (!res.ok) throw new Error(`askVoice failed (${res.status})`);
    blob = await res.blob();
    askCache.set(cacheKey, blob);
  }
  if (askAudio) { askAudio.pause(); askAudio.src = ''; }
  askAudio = new Audio(URL.createObjectURL(blob));
  await askAudio.play();
}

export function stopAskVoice() {
  if (askAudio) { askAudio.pause(); askAudio = null; }
}

export async function speakBest(text: string, opts: AskVoiceOpts): Promise<void> {
  try {
    await playAskVoice(text, opts);
  } catch {
    speak(text);
  }
}

// Some browsers expose SpeechRecognition under a webkit prefix.
type SRConstructor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getRecognitionCtor(): SRConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionAvailable(): boolean {
  return getRecognitionCtor() !== null;
}

export interface ListenHandle {
  stop: () => void;
}

export function listenOnce(
  onResult: (transcript: string) => void,
  onError?: (err: string) => void,
  opts?: { lang?: string }
): ListenHandle | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    onError?.('Speech recognition is not available in this browser. Please type your answer.');
    return null;
  }
  const r = new Ctor();
  r.lang = opts?.lang ?? 'en-US';
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.continuous = false;
  r.onresult = (e) => {
    const first = e.results[0]?.[0]?.transcript ?? '';
    onResult(first.trim());
  };
  r.onerror = (e) => {
    onError?.(e.error || 'Sorry, I did not catch that. Please try again.');
  };
  r.onend = () => { /* no-op */ };
  try {
    r.start();
  } catch (err) {
    onError?.((err as Error).message);
    return null;
  }
  return { stop: () => r.stop() };
}
