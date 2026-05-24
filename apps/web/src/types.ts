// Shared types used by both the web app and the Netlify functions.
// These mirror the JSON shapes returned by the API.

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

export interface StorySummary {
  id: string;
  title: string;
  latest_version: number;
  cover_image_url: string | null;
  updated_at: string;
}
