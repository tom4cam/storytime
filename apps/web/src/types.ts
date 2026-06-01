// Shared types used by both the web app and the Netlify functions.
// These mirror the JSON shapes returned by the API.

export const LANGS = [
  'en', 'sv', 'bg', 'es', 'fr',
  'mk',
  'pt-BR', 'pt-PT',
] as const;
export type Lang = typeof LANGS[number];

export interface Paragraph {
  text: string;
  image_url: string | null;
  image_prompt?: string;
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
  creator_id?: string;
  listed?: boolean;
  group_id?: string;
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
}

export interface StorySummary {
  id: string;
  title: string;
  latest_version: number;
  cover_image_url: string | null;
  updated_at: string;
  creator_id?: string;
}

export interface StoryGroupSummary {
  group_id: string | null;
  primary: StoryIndex;
  languages: Lang[];
}
