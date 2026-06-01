import type { Paragraph } from './types';

export function imageAlt(p: Paragraph, fallback: string = 'Story illustration'): string {
  if (p.image_prompt && p.image_prompt.trim()) return p.image_prompt.trim();
  if (p.text && p.text.trim()) return p.text.slice(0, 200);
  return fallback;
}
