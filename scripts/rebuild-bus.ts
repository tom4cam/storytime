// One-shot: recreate "The Big Blue Tooth Bus" from scratch. The original was a
// user-created story whose text lived only in R2 and was force-deleted, so no
// repo copy survived. This is a FRESH rhyming recreation using the title,
// characters, theme, voice (nova), and character bible recovered from git
// history (commits 2d28d4e / be91e32). Rebuilds at the original id so any old
// links still resolve, then generates the 5 translations (es/fr/it/bg/sv),
// each reusing the English images.
//
//   npx tsx --env-file-if-exists=.env scripts/rebuild-bus.ts            # dry run
//   npx tsx --env-file-if-exists=.env scripts/rebuild-bus.ts --commit   # build (paid)

import { randomUUID } from 'node:crypto';
import { buildAndSaveVersion } from '../functions/api/_lib/build';
import { translateStory as runTranslation } from '../functions/api/_lib/anthropic';
import { getScriptEnv } from './lib/script-env';
import type { Lang } from '../functions/api/_lib/types';

const ID = '875465f3-4d83-4c36-98cd-0f4cd530d642'; // original bus id; English = group root
const TITLE = 'The Big Blue Tooth Bus';
const VOICE = 'nova';
const TRANSLATIONS: Lang[] = ['es', 'fr', 'it', 'bg', 'sv'];
const COMMIT = process.argv.includes('--commit');
const env = getScriptEnv();

// Recovered verbatim from be91e32 (scripts/backfill-bus-bible.ts).
const BUS_BIBLE =
  'Michael is a cheerful adult man with dark brown wavy hair and a warm, playful grin (he is the joke-teller), wearing tidy light-blue dental scrubs. ' +
  'Mindy is his kind adult wife, tall, with bright golden blond hair, a friendly smile, wearing matching light-blue dental scrubs; she is a dental hygienist. ' +
  'The Big Blue Tooth Bus is a large bus painted sky-blue with a big friendly white tooth painted on its side, stocked inside with dental tools (polishers, flossers, shiny spools). ' +
  'Michael and Mindy are a married couple. They all have friendly cartoon faces. Each scene contains just Michael and Mindy unless a stanza explicitly mentions other people (like the older folks they visit).';

const STANZAS: string[] = [
  "Here come Michael and Mindy, so cheery and bright, in scrubs of light blue, what a wonderful sight! They drive a big bus that is shiny and new, the Big Blue Tooth Bus, painted sky-colored blue!",
  "A great friendly tooth on its side, painted white, with polishers, flossers, and spools shining bright. Inside it's a dentist on wheels, can you guess? They help happy smiles look their sparkly best!",
  "\"Hop in!\" laughs kind Michael, the king of the joke, \"We'll brush and we'll giggle with all of the folks!\" Then Mindy the hygienist gives a big wave, and off rolls the bus, oh so cheerful and brave!",
  "They stop in a town where the children all play. \"Who wants a bright smile for their picture today?\" The kids climb aboard with a hop and a cheer, to learn about teeth from the two dentists here.",
  "\"Brush round and round, top and bottom and side, two minutes of brushing,\" sang Mindy with pride. \"Morning and night, never rushing it through, your teeth will stay strong and they'll sparkle for you!\"",
  "Then Michael held floss and he gave it a wiggle, \"It tickles your teeth!\" and the kids gave a giggle. \"Slide gently between, clean the bits stuck in tight, so your gums and your grin will stay healthy and bright!\"",
  "They drove up a hill to some kind older folks, who loved Mindy's care and loved Michael's jokes. They checked every tooth, gave a polish and shine, and everyone's grin looked all twinkly and fine!",
  "\"What treats are the best?\" a small girl wished to know. \"Crunchy fruits, cheese, and cool water!\" they show. \"Too much sticky sugar can give teeth a frown, so swish, sip, and brush to keep cavities down!\"",
  "Michael told one more joke, oh the laughter rang loud, and Mindy just grinned at the giggling crowd. \"A smile is a gift you can give every day, so brush it and floss it and keep it that way!\"",
  "As the sun softly set, painting gold in the sky, the Big Blue Tooth Bus gave a toot of goodbye. \"We'll see you again!\" called the two with a cheer, and smiles shone brighter for all, far and near!",
];

async function main() {
  console.log(`"${TITLE}" — ${STANZAS.length} rhyming stanzas, voice ${VOICE}, + ${TRANSLATIONS.length} translations:\n`);
  STANZAS.forEach((s, i) => console.log(`  [${i + 1}] ${s}\n`));

  if (!COMMIT) {
    console.log('DRY RUN — re-run with --commit to build English + translations (images + narration).');
    return;
  }

  console.log('Building English (images + narration)...');
  const en = await buildAndSaveVersion(env, {
    id: ID,
    version: 1,
    title: TITLE,
    sourceAnswers: [{ question: 'Default story', answer: TITLE }],
    language: 'en',
    voiceId: VOICE,
    creator_id: 'system',
    listed: true,
    character_bible: BUS_BIBLE,
    group_id: ID, // English story is the translation-group root
    rhyme: true,
    paragraphs: STANZAS.map((text) => ({ text, image_url: null })),
  });
  console.log(`  ✅ English v${en.version}: ${en.paragraphs.length} paragraphs, narration ${en.narration_url ? 'ok' : 'MISSING'}`);

  for (const lang of TRANSLATIONS) {
    console.log(`Translating + narrating ${lang} (reusing English images)...`);
    const tr = await runTranslation(env, { title: TITLE, paragraphs: STANZAS, sourceLanguage: 'en' }, lang);
    const tid = randomUUID();
    const v = await buildAndSaveVersion(env, {
      id: tid,
      version: 1,
      title: tr.title,
      sourceAnswers: [{ question: 'Translated from', answer: `${ID} (en -> ${lang})` }],
      language: lang,
      voiceId: VOICE,
      creator_id: 'system',
      listed: true,
      character_bible: BUS_BIBLE,
      group_id: ID,
      rhyme: true,
      paragraphs: en.paragraphs.map((p, i) => ({ text: tr.paragraphs[i], image_prompt: p.image_prompt, image_url: p.image_url })),
    });
    console.log(`  ✅ ${lang} "${v.title}" (${tid}): narration ${v.narration_url ? 'ok' : 'MISSING'}`);
  }

  console.log('\nDone. The Big Blue Tooth Bus is rebuilt in all 6 languages.');
}

main().catch((e) => { console.error(e); process.exit(1); });
