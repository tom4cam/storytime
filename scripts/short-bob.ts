// One-shot: rebuild "Bob's Big Butter Adventure" as a fresh, SHORTER (~8
// paragraph) story in simpler language for ages 3-6, keeping the original
// characters (Bob, Eve, Brennan) and a gentle butter-vs-seed-oils message.
//
// The live story (id default-bobs-butter) is broken — stuck as a "generating"
// stub (v4) with stale v3 alongside — so this fully replaces it at v1 and
// sweeps the leftover versions + their media. buildAndSaveVersion derives the
// image prompts from each paragraph, anchors them on the BOB_CHARACTERS bible
// so Bob/Eve/Brennan look consistent, generates the images, synthesizes the
// narration, and saves it listed as a system default.
//
//   npx tsx --env-file-if-exists=.env scripts/short-bob.ts            # dry run (prints the text)
//   npx tsx --env-file-if-exists=.env scripts/short-bob.ts --commit   # build + save (paid: images + TTS)

import { buildAndSaveVersion } from '../functions/api/_lib/build';
import { BOB_CHARACTERS } from './data/bob-source';
import { getScriptEnv } from './lib/script-env';

const ID = 'default-bobs-butter';
const TITLE = "Bob's Big Butter Adventure";
const VOICE = 'onyx'; // Daniel slot — OpenAI tts-1 male voice (matches original Bob)
const VERSION = 1;
const COMMIT = process.argv.includes('--commit');
const env = getScriptEnv();

// Fresh, simpler retelling — the full arc in eight short parts.
const PARAGRAPHS: string[] = [
  "This is Bob. He has sunny golden hair and a short golden beard, and he loves to cook. Bob lives with his kind wife Eve and their boy Brennan, who is ten years old.",
  "In his cozy kitchen, Bob cooks with real butter, or olive oil, or tallow from cows. \"These are real, simple foods,\" Bob says with a smile. \"They help our bodies grow strong and happy!\"",
  "One bright morning, Bob had a big idea. \"Let's go on a road trip!\" he cheered. \"Let's drive to Twin Falls to see the giant waterfalls!\" Eve packed a cooler and Brennan packed his favorite toys.",
  "They drove past tall mountains and sparkly rivers. At last they reached Twin Falls, where the water roared and splashed. \"Look at the misty spray!\" laughed Brennan. What a wonderful, magical day.",
  "Soon their tummies started to rumble. \"Time for supper,\" said Bob. They found a friendly diner and slid into a cozy booth by the window.",
  "A kind server came to take their order. \"I would love a steak,\" said Bob. \"Could you please cook it in butter or olive oil? My tummy feels its best without seed oils.\"",
  "The server asked the cook, and together they found a way. \"Seed oils get cooked very, very hot, and that can upset our tummies,\" Bob explained gently. \"Butter is simple and real.\" The cook smiled and cooked it just right.",
  "With full and happy tummies, Bob, Eve, and Brennan drove home as the sun went down. \"Best day ever!\" cheered Brennan. And Bob agreed.",
];

async function sweepStaleVersions(keep: number) {
  const list = await env.STORIES.list({ prefix: `${ID}/v`, limit: 1000 });
  for (const o of list.objects) {
    const m = /\/v(\d+)\.json$/.exec(o.key);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n === keep) continue;
    await env.STORIES.delete(o.key);
    const media = await env.MEDIA.list({ prefix: `${ID}-v${n}-`, limit: 1000 });
    for (const mo of media.objects) await env.MEDIA.delete(mo.key);
    await env.MEDIA.delete(`${ID}-v${n}.mp3`);
    console.log(`  swept stale v${n} (+${media.objects.length} images, narration)`);
  }
}

async function main() {
  console.log(`"${TITLE}" — ${PARAGRAPHS.length} parts:\n`);
  PARAGRAPHS.forEach((p, i) => console.log(`  [${i + 1}] ${p}\n`));

  if (!COMMIT) {
    console.log('DRY RUN — re-run with --commit to build images + narration and replace the broken story.');
    return;
  }

  console.log('Building (images + narration)...');
  const v = await buildAndSaveVersion(env, {
    id: ID,
    version: VERSION,
    title: TITLE,
    sourceAnswers: [{ question: 'Default story', answer: TITLE }],
    language: 'en',
    voiceId: VOICE,
    creator_id: 'system',
    listed: true,
    character_bible: BOB_CHARACTERS,
    paragraphs: PARAGRAPHS.map((text) => ({ text })),
  });
  console.log(`Saved ${v.id} v${v.version}: ${v.paragraphs.length} paragraphs, narration ${v.narration_url ? 'ok' : 'MISSING'}, status ${v.status}.`);

  console.log('Sweeping stale versions...');
  await sweepStaleVersions(VERSION);
  console.log('Done. Bob is rebuilt and listed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
