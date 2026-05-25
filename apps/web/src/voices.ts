export type Lang = 'en' | 'sv';

export interface VoiceMeta {
  key: 'daniel' | 'rachel' | 'sanna' | 'adam';
  displayName: string;
  language: Lang;
  gender: 'm' | 'f';
  elevenlabsVoiceId: string;
  sampleUrl: string;
}

// IDs marked PLACEHOLDER: ElevenLabs doesn't ship "Sanna" or "Adam" as
// preset voices. Until you audition and choose native Swedish voices,
// these fall back to Daniel/Rachel rendered via eleven_multilingual_v2,
// which handles Swedish text reasonably. Swap the elevenlabsVoiceId
// values once you have Swedish voice IDs from your ElevenLabs library.
export const VOICES: VoiceMeta[] = [
  { key: 'daniel', displayName: 'Daniel', language: 'en', gender: 'm', elevenlabsVoiceId: 'onwK4e9ZLuTAKqWW03F9', sampleUrl: '/voice-samples/daniel.mp3' },
  { key: 'rachel', displayName: 'Rachel', language: 'en', gender: 'f', elevenlabsVoiceId: '21m00Tcm4TlvDq8ikWAM', sampleUrl: '/voice-samples/rachel.mp3' },
  { key: 'sanna',  displayName: 'Sanna',  language: 'sv', gender: 'f', elevenlabsVoiceId: '21m00Tcm4TlvDq8ikWAM', sampleUrl: '/voice-samples/sanna.mp3'  },
  { key: 'adam',   displayName: 'Adam',   language: 'sv', gender: 'm', elevenlabsVoiceId: 'onwK4e9ZLuTAKqWW03F9', sampleUrl: '/voice-samples/adam.mp3'   },
];

export function defaultVoiceFor(language: Lang): VoiceMeta {
  return VOICES.find((v) => v.language === language) ?? VOICES[0];
}

export function findVoiceByKey(key: string): VoiceMeta | undefined {
  return VOICES.find((v) => v.key === key);
}
