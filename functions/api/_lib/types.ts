// Mirror of apps/web/src/types.ts — kept here so functions are
// self-contained for the Cloudflare bundler.

export const LANGS = [
  'en', 'sv', 'bg', 'es', 'fr',
  'it', 'mk',
  'pt-BR', 'pt-PT',
] as const;
export type Lang = typeof LANGS[number];

export interface Paragraph {
  text: string;
  image_url: string | null;
  image_prompt?: string;
  // Per-paragraph audio cache. Stored on the server-side StoryVersion so a
  // later edit can reuse audio for paragraphs whose text+voice didn't change
  // (publicStory.toPublicStory strips these before sending to the client).
  // narration_hash = sha256("{voiceId}:{text}"); narration_url points at
  // an MP3 in the MEDIA bucket; narration_chars holds the per-paragraph
  // CharacterAlignment so the karaoke timing can be re-stitched without
  // calling the TTS provider again.
  narration_url?: string;
  narration_hash?: string;
  narration_chars?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

export interface StoryAnswer {
  question: string;
  answer: string;
}

export type StoryStatus = 'generating' | 'ready' | 'failed';

export interface WordTiming {
  paragraphIndex: number;
  wordIndex: number;
  word: string;
  start: number;
  end: number;
}

export interface StoryVersion {
  id: string;
  version: number;
  title: string;
  paragraphs: Paragraph[];
  narration_url: string | null;
  source_answers: StoryAnswer[];
  created_at: string;
  status: StoryStatus;
  error?: string;
  language: Lang;
  narration_words?: WordTiming[];
  voice_id?: string;
  summary?: string;
  // Concrete, unchanging visual descriptions of each named character, injected
  // into every image prompt so a character looks the same across all of a
  // story's images — and inherited by sequels so they match too.
  character_bible?: string;
  creator_id?: string;
  listed?: boolean;
  group_id?: string;
  rhyme?: boolean;
  stars?: number;
  series_id?: string;
  series_position?: number;
}

export interface StoryIndex {
  id: string;
  title: string;
  latest_version: number;
  cover_image_url: string | null;
  updated_at: string;
  created_at: string;
  status: StoryStatus;
  language: Lang;
  creator_id?: string;
  listed?: boolean;
  group_id?: string;
  stars?: number;
  series_id?: string;
  series_position?: number;
}

export interface GeneratedStory {
  title: string;
  paragraphs: { text: string; image_prompt: string }[];
  character_bible?: string;
}

export interface StoryGroupSummary {
  group_id: string | null;
  primary: StoryIndex;
  languages: Lang[];
  members: Array<{ id: string; language: Lang }>;  // one entry per language in the group
  series_count?: number;  // when primary is part of a series; total distinct positions
}
