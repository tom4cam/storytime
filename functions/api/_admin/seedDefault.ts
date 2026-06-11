// POST /api/_admin/seedDefault
// One-shot admin endpoint to seed Bob or Pip-sv as a default story.
// Gated by SEED_ADMIN_TOKEN (set with `wrangler pages secret put`).
//
// Body: { which: 'bob' | 'pip', token: string }

import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../_lib/env';
import { constantTimeEqual } from '../_lib/adminAuth';
import { regenerateImagePrompt } from '../_lib/anthropic';
import { buildAndSaveVersion } from '../_lib/build';
import { badRequest, json, serverError } from '../_lib/util';

interface SeedEnv extends Env {
  SEED_ADMIN_TOKEN: string;
}

const BOB_TITLE = "Bob's Big Butter Adventure";
const BOB_CHARACTERS =
  "Bob is a cheerful adult man with bright golden blond hair and a short neatly trimmed golden blond beard (not bushy or long), wearing a cozy chef apron. " +
  "Brennan is a 10-year-old boy, clearly older than a small child, almost a preteen, taller than a toddler, with bright golden blond hair, smooth face, no beard, athletic build. He is Bob's only child, so there is exactly one boy in any scene, never two children, never a baby, never a toddler. " +
  "Eve is Bob's kind adult wife with shoulder-length brown hair. " +
  "Each scene contains exactly these three people unless the stanza explicitly mentions another character (like a waitress). They all have friendly cartoon faces.";

const BOB_STANZAS: string[] = [
  "Now this is our Bob, with his golden blond beard, and his hair like the sun, oh, his hair is endeared. He lives with sweet Eve in a snug little spot, with their boy little Brennan, the best son they've got!",
  "In Bob's tidy kitchen, with pots in a row, he cooks with real butter, all sunshine and glow! Or tallow from cows, melted creamy and bright, or olive oil green, what a wonderful sight!",
  "These fats are the best ones! Bob cries with a grin. They're real and they're simple, no factory bin! Saturated fats keep our bodies so strong, and the Mufas help everything chug right along!",
  "One bright sunny morning, Bob hopped with a shout, Let's go on a road trip! Let's pack and head out! To Twin Falls, Idaho, where the waterfalls roar! Grab snacks and your sneakers, let's head out the door!",
  "So Eve packed the cooler and Brennan his toys, and off the three zoomed with the merriest noise. Past mountains and meadows, past rivers and pine, they reached the great Twin Falls, all sparkly and fine!",
  "Hooray! cheered young Brennan, the mist and the spray! What a wonderful, marvelous, magical day! But soon tummies grumbled, the sun started low, Let's find us some supper! said Bob. Off we go!",
  "They sat in a booth at a diner so bright, a young server came over with menus in sight. I'll have steak, Bob said kindly, but please understand, I'm sensitive to seed oils, they're sadly not grand.",
  "Could you cook it in butter? Or tallow's just fine. Or olive oil's lovely; please, any of mine. Just no seed oils for me, please, if that's alright! The server blinked back with a curious slight fright.",
  "Um, I don't really know how the kitchen cooks food, could you pick something first? Please don't think I'm rude. Then I'll go and ask what they cook with, you see? But you need to choose first, before checking with me!",
  "Bob laughed just a smidge. But how can I pick, when the oil is the whole entire heart of the trick? If they fry it in seed oil, my tummy will say, I don't like this at all, and then ruin my day!",
  "The server just stared, then she shrugged and walked back, she returned with a frown and a wobbly attack: The cook says, pick first, then we'll see what we use. You can read the whole menu! Just take it and choose!",
  "Bob chuckled and turned to his Eve and his boy, You know, this seems silly, this round and round ploy. Those seed oils they use, when they heat them up high, they hurt all of us, that's not a joke or a lie!",
  "They call it vegetable oil, now isn't that funny? There's no veggie inside, not a carrot or bunny! It's seeds that get crushed in a chemical mash, with heat and with bleach, and they ladle the splash!",
  "So sensitive, sure, here's a truth like a song: We're all of us sensitive when they're cooked too long! But menus stay quiet, and kitchens stay hidden, and folks eat the oils that should really be forbidden.",
  "The young server giggled, I'd never thought that! Let me check with the cook. Off she went in a chat. She came back: The fryer holds gallons of canola, the grill might be cleaner, but really, who knowla?",
  "Bob ordered a salad, plain leaves on a plate, and he ate it with humor, no anger, no hate. At cafe and diner, the same tale would brew, What oil? they would ask. We just don't have a clue!",
  "Sweet Eve squeezed Bob's hand, Soon home, dear, soon home, where you know each pan, where we're free to just roam! So back in the car, off the family did zoom, through Idaho sunsets, the whole sky in bloom.",
  "When at last they pulled up to their cozy front door, Bob danced to the kitchen and danced some bit more! He flung wide the fridge, oh the wonders he found: Real butter! Real tallow! Good food all around!",
  "He pulled out fresh eggs, low-Poufa, the best, and grass-fed beef steaks, much finer than rest! Sweet potatoes baked golden, so fluffy, so warm, and berries and oranges, full of bright charm.",
  "This! beamed our Bob, is what dinner should be: Real food from the field, from the cow, from the tree! Saturated fats, oh, how cozy, how sweet, and Mufas from olives to round out the treat!",
];

const PIP_TITLE_EN = 'Pip the Dragon Bakes a Loaf';

interface PipPara { text: string; image_prompt: string }
const PIP_PARAGRAPHS_EN: PipPara[] = [
  { text: 'High up on a tall mountain, there was a cozy little bakery. It had warm yellow lights, a big stone oven, and the smell of fresh bread floating out the door. That is where Pip the friendly dragon liked to spend his days.', image_prompt: 'A small friendly dragon named Pip standing outside a cozy cartoon bakery on a snowy mountain, warm yellow lights glowing in the window, bright colors.' },
  { text: 'Pip wanted more than anything to bake the perfect loaf of bread. He had tried many times before, but something always went wrong. Once the bread was too flat, and once it was too lumpy.', image_prompt: 'Friendly cartoon dragon Pip inside a warm bakery kitchen, looking at a flat lumpy loaf of bread on a wooden table, scratching his head with a puzzled smile.' },
  { text: 'One morning, Pip mixed the flour and water and a pinch of salt very carefully. He kneaded the dough with his little claws, folding it over and over. He was so proud of how soft and round it looked.', image_prompt: 'Friendly cartoon dragon Pip wearing a small apron, kneading a round ball of dough on a flour dusted table inside the cozy mountain bakery, big happy smile.' },
  { text: 'Then came the tricky part, putting the bread in the oven. Pip used his own warm dragon breath to heat the stone oven just right. But he breathed a little too much and the top of the loaf turned very dark.', image_prompt: 'Friendly cartoon dragon Pip opening a big stone oven in the bakery, a slightly too dark loaf of bread on the rack, Pip looking surprised with a small puff of smoke from his nose.' },
  { text: 'Pip felt a little sad. He sat down on a flour sack and sighed. His friend Marta the mountain mouse came over and patted his tail. She said, every baker makes mistakes, that is how you learn.', image_prompt: 'Friendly cartoon dragon Pip sitting sadly on a flour sack in the bakery, a tiny smiling mouse patting his tail, warm cozy bakery background with shelves of bread.' },
  { text: 'Pip smiled and stood right back up. He mixed a brand new batch of dough and this time he breathed very gently into the oven, slow and steady and warm. He watched and waited and hummed a little song.', image_prompt: 'Friendly cartoon dragon Pip carefully blowing gentle warm breath into a glowing stone oven in the cozy bakery, eyes focused and calm, Marta the mouse watching nearby.' },
  { text: 'When the timer rang, Pip pulled out a loaf that was perfectly golden and round. The whole bakery smelled amazing. Pip and Marta shared a big warm slice together, and Pip giggled with joy.', image_prompt: 'Friendly cartoon dragon Pip and a tiny mouse sitting at a small table in the cozy mountain bakery, sharing a golden loaf of bread, both smiling with crumbs on their chins.' },
];

const DANIEL_VOICE = 'onyx';
const SANNA_VOICE = 'shimmer';

async function seedBob(env: Env): Promise<string> {
  const prompts = await Promise.all(
    BOB_STANZAS.map((stanza) => regenerateImagePrompt(env, stanza, BOB_TITLE))
  );
  const paragraphs = BOB_STANZAS.map((text, i) => ({
    text,
    image_prompt: `Cartoon illustration. Characters: ${BOB_CHARACTERS} Scene: ${prompts[i]} Style: bright colors, friendly faces, cartoon style, no text in the image.`,
    image_url: null as string | null,
  }));
  const v = await buildAndSaveVersion(env, {
    id: 'default-bobs-butter',
    version: 1,
    title: BOB_TITLE,
    sourceAnswers: [{ question: 'Default story', answer: BOB_TITLE }],
    language: 'en',
    voiceId: DANIEL_VOICE,
    paragraphs,
  });
  return `Bob: ${v.id} v${v.version}, ${v.paragraphs.length} paragraphs`;
}

async function translatePipToSwedish(env: Env): Promise<{ title: string; paragraphs: string[] }> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const englishBody = PIP_PARAGRAPHS_EN.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n');
  const res = await client.messages.create({
    model,
    max_tokens: 2500,
    system:
      'Translate the given children\'s story into warm, simple Swedish suitable for ages 3-6. Keep proper names (Pip, Marta) unchanged. Return strict JSON with this shape: {"title": "...", "paragraphs": ["...", "...", ...]}. No prose outside JSON, no code fences.',
    messages: [{ role: 'user', content: `Title: ${PIP_TITLE_EN}\n\n${englishBody}\n\nReturn JSON.` }],
  });
  const block = res.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Claude returned no text');
  const raw = block.text.trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { title: string; paragraphs: string[] };
  if (!parsed.title || parsed.paragraphs?.length !== PIP_PARAGRAPHS_EN.length) {
    throw new Error('Translation shape unexpected');
  }
  return parsed;
}

async function seedPip(env: Env): Promise<string> {
  const sv = await translatePipToSwedish(env);
  const paragraphs = PIP_PARAGRAPHS_EN.map((p, i) => ({
    text: sv.paragraphs[i],
    image_prompt: p.image_prompt,
    image_url: null as string | null,
  }));
  const v = await buildAndSaveVersion(env, {
    id: 'default-pip-bread',
    version: 1,
    title: sv.title,
    sourceAnswers: [{ question: 'Default story', answer: PIP_TITLE_EN }],
    language: 'sv',
    voiceId: SANNA_VOICE,
    paragraphs,
  });
  return `Pip-sv: ${v.id} v${v.version}, ${v.paragraphs.length} paragraphs`;
}

export const onRequestPost: PagesFunction<SeedEnv> = async ({ request, env }) => {
  let body: { which?: string; token?: string; sync?: boolean };
  try { body = (await request.json()) as { which?: string; token?: string; sync?: boolean }; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!env.SEED_ADMIN_TOKEN) return serverError('SEED_ADMIN_TOKEN not configured');
  if (!body.token || !constantTimeEqual(body.token, env.SEED_ADMIN_TOKEN)) return new Response('Forbidden', { status: 403 });
  if (body.which !== 'bob' && body.which !== 'pip') return badRequest('which must be "bob" or "pip"');

  // Synchronous mode: wait for the whole pipeline (up to ~5min on
  // unbound Workers / Pages). Returns the result so we can see any
  // error in the response. Pages can run unbound by default.
  try {
    const msg = body.which === 'bob' ? await seedBob(env) : await seedPip(env);
    return json({ ok: true, msg });
  } catch (e) {
    console.error('seed failed', e);
    return serverError(`seed failed: ${(e as Error).message}`);
  }
};
