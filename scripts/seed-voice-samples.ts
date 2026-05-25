// Generates four short MP3 samples for the voice picker.
// Run once after deploy, then commit the resulting files:
//
//   npm run seed:samples
//   git add apps/web/public/voice-samples/
//
// Required env: ELEVENLABS_API_KEY. R2 credentials are NOT needed — the
// samples are written to the local filesystem and bundled with the app.

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { synthesize } from '../functions/api/_lib/elevenlabs';
import type { Env } from '../functions/api/_lib/env';

interface SampleSpec {
  key: string;
  voiceId: string;
  text: string;
}

const SAMPLES: SampleSpec[] = [
  { key: 'daniel', voiceId: 'onwK4e9ZLuTAKqWW03F9', text: "Hi, I'm Daniel. I love telling stories." },
  { key: 'rachel', voiceId: '21m00Tcm4TlvDq8ikWAM', text: "Hi, I'm Rachel. I love telling stories." },
  { key: 'sanna',  voiceId: '21m00Tcm4TlvDq8ikWAM', text: 'Hej, jag heter Sanna. Jag älskar att berätta sagor.' },
  { key: 'adam',   voiceId: 'onwK4e9ZLuTAKqWW03F9', text: 'Hej, jag heter Adam. Jag älskar att berätta sagor.' },
];

const OUTPUT_DIR = resolve(__dirname, '../apps/web/public/voice-samples');

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Missing ELEVENLABS_API_KEY');
    process.exit(1);
  }
  // Voice synthesis is the only env field the script touches; R2 is not used.
  const env = { ELEVENLABS_API_KEY: apiKey } as unknown as Env;
  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const s of SAMPLES) {
    console.log(`Generating ${s.key}...`);
    const { audio } = await synthesize(env, s.text, { voiceId: s.voiceId });
    const path = `${OUTPUT_DIR}/${s.key}.mp3`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(audio));
    console.log(`  wrote ${path}`);
  }
  console.log('Done. Commit the new MP3 files in apps/web/public/voice-samples/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
