import { describe, it, expect } from 'vitest';
import { resolveInitialLang, t } from './index';

describe('resolveInitialLang', () => {
  it('honours a stored "en" preference even if browser is sv', () => {
    expect(resolveInitialLang('sv-SE', 'en')).toBe('en');
  });

  it('honours a stored "sv" preference even if browser is en', () => {
    expect(resolveInitialLang('en-US', 'sv')).toBe('sv');
  });

  it('falls back to Swedish when browser is sv-* and nothing stored', () => {
    expect(resolveInitialLang('sv-SE', null)).toBe('sv');
    expect(resolveInitialLang('sv', null)).toBe('sv');
  });

  it('falls back to English for anything else', () => {
    expect(resolveInitialLang('en-US', null)).toBe('en');
    expect(resolveInitialLang('fr-FR', null)).toBe('fr');
    expect(resolveInitialLang('', null)).toBe('en');
  });

  it('ignores invalid stored values', () => {
    expect(resolveInitialLang('sv-SE', 'xx')).toBe('sv');
    expect(resolveInitialLang('en-US', '')).toBe('en');
  });

  it('resolves browser locales for bg, es, fr, and it', () => {
    expect(resolveInitialLang('bg', null)).toBe('bg');
    expect(resolveInitialLang('es-MX', null)).toBe('es');
    expect(resolveInitialLang('fr-CA', null)).toBe('fr');
    expect(resolveInitialLang('it-IT', null)).toBe('it');
  });

  it('honours a stored valid lang for any of the six codes', () => {
    expect(resolveInitialLang('en-US', 'bg')).toBe('bg');
    expect(resolveInitialLang('en-US', 'it')).toBe('it');
  });
});

describe('t', () => {
  it('returns the English string for a known key', () => {
    expect(t('home.heroCta', 'en')).toBe('Start a new story');
  });

  it('returns the Swedish string for a known key', () => {
    expect(t('home.heroCta', 'sv')).toBe('Börja en ny saga');
  });

  it('falls back to English when a Swedish key is somehow missing', () => {
    // This guards against future drift between en.ts and sv.ts.
    expect(t('error.generic', 'sv')).toBe('Något gick fel. Försök igen.');
  });

  it('returns the raw key when neither table has it (safety net)', () => {
    // @ts-expect-error — intentionally unknown key
    expect(t('does.not.exist', 'en')).toBe('does.not.exist');
  });

  it('interpolates {name}-style placeholders in a vars-bearing string', () => {
    // `edit.versionNote` has a {next} placeholder.
    expect(t('edit.versionNote', 'en', { next: '3' })).toBe('Saving will create version 3.');
  });
});
