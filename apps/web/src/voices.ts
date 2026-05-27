export type Lang = 'en' | 'sv' | 'bg' | 'es' | 'fr';

export interface VoiceMeta {
  key: 'daniel' | 'rachel' | 'sanna' | 'adam';
  displayName: string;
  gender: 'm' | 'f';
  voiceId: string;
  sampleUrl: string;
}

// OpenAI tts-1 voices have no language affinity — the same voice speaks
// English or Swedish based on the input text. The four picker slots are
// kept (Daniel/Rachel/Sanna/Adam) so existing UI copy and saved stories
// stay meaningful; each is just a friendly label for one OpenAI voice.
export const VOICES: VoiceMeta[] = [
  { key: 'daniel', displayName: 'Daniel', gender: 'm', voiceId: 'onyx',    sampleUrl: '/voice-samples/daniel.mp3' },
  { key: 'rachel', displayName: 'Rachel', gender: 'f', voiceId: 'nova',    sampleUrl: '/voice-samples/rachel.mp3' },
  { key: 'sanna',  displayName: 'Sanna',  gender: 'f', voiceId: 'shimmer', sampleUrl: '/voice-samples/sanna.mp3'  },
  { key: 'adam',   displayName: 'Adam',   gender: 'm', voiceId: 'echo',    sampleUrl: '/voice-samples/adam.mp3'   },
];

export function defaultVoiceFor(_language: Lang): VoiceMeta {
  return VOICES[0];
}

export function findVoiceByKey(key: string): VoiceMeta | undefined {
  return VOICES.find((v) => v.key === key);
}
