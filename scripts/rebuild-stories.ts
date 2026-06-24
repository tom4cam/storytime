// One-shot: rebuild Bob's Big Butter Adventure and The Big Blue Tooth Bus
// on the current image pipeline (flux/schnell text-to-image + per-story seed
// for character consistency + the vision QC retry pass) and the
// soft-modern-picture-book style anchor, re-narrating with the per-paragraph
// synth path.
//
// Text is kept verbatim (image_prompt is reused too — wrapImagePrompt's
// style anchor still kicks in). Images and audio are fully regenerated.
// For Big Blue Tooth Bus, propagateEditToTranslations syncs the 5
// translations (es/fr/it/bg/sv) so they all share the new English images.
//
//   npx tsx --env-file-if-exists=.env scripts/rebuild-stories.ts
//   npx tsx --env-file-if-exists=.env scripts/rebuild-stories.ts --commit
//
// Honors the existing voice_id per story (Bob: onyx; Bus: nova) — the
// switch to British male defaults only applies to new stories.

import { buildAndSaveVersion, propagateEditToTranslations } from '../functions/api/_lib/build';
import { getStoryVersion } from '../functions/api/_lib/storage';
import { getScriptEnv } from './lib/script-env';

const COMMIT = process.argv.includes('--commit');
const env = getScriptEnv();

interface Target {
  id: string;
  label: string;
  syncTranslations: boolean;
}

const TARGETS: Target[] = [
  { id: 'default-bobs-butter', label: "Bob's Big Butter Adventure", syncTranslations: false },
  { id: '875465f3-4d83-4c36-98cd-0f4cd530d642', label: 'The Big Blue Tooth Bus', syncTranslations: true },
];

async function rebuildOne(t: Target): Promise<void> {
  console.log(`\n[${t.label}] loading current version...`);
  const previous = await getStoryVersion(env, t.id);
  if (!previous) {
    console.log(`  ❌ not found, skipping`);
    return;
  }
  console.log(`  v${previous.version}, ${previous.paragraphs.length} paragraphs, voice ${previous.voice_id ?? '(default)'}`);
  if (!COMMIT) {
    console.log(`  DRY RUN — would rebuild ${previous.paragraphs.length} images + narration in place at v${previous.version}`);
    if (t.syncTranslations && previous.group_id) {
      console.log(`  DRY RUN — would also propagate to translations in group ${previous.group_id}`);
    }
    return;
  }

  // image_url: null + regenerate_image: true forces every image through
  // the new pipeline. image_prompt is carried forward so resolveBasePrompt
  // reuses the (unwrapped) scene description; the new IMAGE_STYLE wrap is
  // applied fresh inside buildAndSaveVersion.
  const planParagraphs = previous.paragraphs.map((p) => ({
    text: p.text,
    image_prompt: p.image_prompt,
    image_url: null,
    regenerate_image: true,
  }));

  console.log(`  Building (schnell images + QC retry + per-paragraph narration)...`);
  const t0 = Date.now();
  const built = await buildAndSaveVersion(env, {
    id: previous.id,
    version: previous.version,
    title: previous.title,
    sourceAnswers: previous.source_answers ?? [],
    language: previous.language,
    voiceId: previous.voice_id,
    creator_id: previous.creator_id,
    listed: previous.listed,
    summary: previous.summary,
    character_bible: previous.character_bible,
    group_id: previous.group_id,
    rhyme: previous.rhyme,
    series_id: previous.series_id,
    series_position: previous.series_position,
    paragraphs: planParagraphs,
    previousParagraphs: previous.paragraphs,
  });
  const ms = Date.now() - t0;
  console.log(`  ✅ v${built.version} saved in ${(ms / 1000).toFixed(1)}s, narration ${built.narration_url ? 'ok' : 'MISSING'}, status ${built.status}`);

  if (t.syncTranslations && built.group_id) {
    console.log(`  Propagating to translations (group ${built.group_id})...`);
    const t1 = Date.now();
    await propagateEditToTranslations(env, built);
    console.log(`  ✅ translations resynced in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  }
}

async function main(): Promise<void> {
  console.log(COMMIT ? 'REBUILD (paid)' : 'DRY RUN — pass --commit to actually rebuild');
  for (const t of TARGETS) {
    try {
      await rebuildOne(t);
    } catch (e) {
      console.error(`[${t.label}] failed:`, e);
    }
  }
  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
