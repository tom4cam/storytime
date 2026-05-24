// Shared types for the Netlify functions. Mirrored in apps/web/src/types.ts.

export interface Paragraph {
  text: string;
  image_url: string | null;
  image_prompt?: string;
}

export interface StoryAnswer {
  question: string;
  answer: string;
}

export interface StoryVersion {
  id: string;
  version: number;
  title: string;
  paragraphs: Paragraph[];
  narration_url: string | null;
  source_answers: StoryAnswer[];
  created_at: string;
}

export interface StoryIndex {
  id: string;
  title: string;
  latest_version: number;
  cover_image_url: string | null;
  updated_at: string;
  created_at: string;
}

export interface GeneratedStory {
  title: string;
  paragraphs: { text: string; image_prompt: string }[];
}
