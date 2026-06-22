import type { Lang } from './types';
export type { Lang } from './types';

export interface VoiceMeta {
  key: 'daniel' | 'rachel' | 'sanna' | 'adam' | 'ava' | 'oliver';
  displayName: string;
  gender: 'm' | 'f';
  voiceId: string;
  sampleUrl: string;
  // Which languages this voice is appropriate for. 'all' means it carries
  // across any language (OpenAI's neutral-American presets). An explicit
  // array narrows the voice to its cultural anchor (e.g. Sanna is a Swedish
  // persona; Oliver has a British accent that reads odd in Romance langs).
  langs: 'all' | Lang[];
}

// OpenAI tts-1 voices have no language affinity in the model itself — the
// same voice speaks any language from the input text — but the underlying
// accent (British, neutral American) carries cultural weight, so we narrow
// the picker per language. The picker slots are kept (Daniel/Rachel/
// Sanna/Adam/Ava/Oliver) so existing UI copy and saved stories stay
// meaningful; each is a friendly label over one OpenAI voice id.
export const VOICES: VoiceMeta[] = [
  { key: 'daniel', displayName: 'Daniel', gender: 'm', voiceId: 'onyx',    sampleUrl: '/voice-samples/daniel.mp3', langs: 'all' },
  { key: 'rachel', displayName: 'Rachel', gender: 'f', voiceId: 'nova',    sampleUrl: '/voice-samples/rachel.mp3', langs: 'all' },
  { key: 'sanna',  displayName: 'Sanna',  gender: 'f', voiceId: 'shimmer', sampleUrl: '/voice-samples/sanna.mp3',  langs: ['sv'] },
  { key: 'adam',   displayName: 'Adam',   gender: 'm', voiceId: 'echo',    sampleUrl: '/voice-samples/adam.mp3',   langs: 'all' },
  { key: 'ava',    displayName: 'Ava',    gender: 'f', voiceId: 'alloy',   sampleUrl: '/voice-samples/ava.mp3',    langs: 'all' },
  { key: 'oliver', displayName: 'Oliver (British)', gender: 'm', voiceId: 'fable', sampleUrl: '/voice-samples/oliver.mp3', langs: ['en'] },
];

export function voiceSupportsLang(v: VoiceMeta, lang: Lang): boolean {
  return v.langs === 'all' || v.langs.includes(lang);
}

export function voicesForLang(lang: Lang): VoiceMeta[] {
  return VOICES.filter((v) => voiceSupportsLang(v, lang));
}

export function defaultVoiceFor(lang: Lang): VoiceMeta {
  // Match the backend defaults (Daniel on ElevenLabs, Oliver/fable on
  // OpenAI) for British male as the lead pick when available in this lang.
  return voicesForLang(lang).find((v) => v.key === 'oliver')
    ?? voicesForLang(lang)[0]
    ?? VOICES[0];
}

export function findVoiceByKey(key: string): VoiceMeta | undefined {
  return VOICES.find((v) => v.key === key);
}
