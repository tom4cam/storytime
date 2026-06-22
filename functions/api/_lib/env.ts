// Cloudflare Pages Functions runtime bindings.
//
// R2 buckets are configured via wrangler.toml [[r2_buckets]] entries.
// Secrets are set via `wrangler pages secret put NAME` and surface as
// plain string properties on `env` at runtime.

export interface Env {
  // R2 bucket bindings
  STORIES: R2Bucket;
  MEDIA: R2Bucket;

  // Secrets
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  FAL_KEY: string;

  // Optional: preferred TTS provider. When ELEVENLABS_API_KEY is set,
  // synthesize() tries ElevenLabs first and falls back to OpenAI tts-1
  // on any failure. ELEVENLABS_VOICE_ID is the default voice id (e.g.
  // "onwK4e9ZLuTAKqWW03F9" for Daniel). Used when the requested voice
  // is one of OpenAI's preset names (alloy/echo/fable/onyx/nova/shimmer)
  // and therefore not a meaningful ElevenLabs voice id.
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;

  // Public vars
  ANTHROPIC_MODEL?: string;

  // Optional OpenAI TTS overrides. OPENAI_TTS_MODEL defaults to "tts-1";
  // set to "gpt-4o-mini-tts" to enable the steerable model. When the model
  // is steerable, OPENAI_TTS_INSTRUCTIONS is sent as the `instructions`
  // field — leave unset to use a warm British storytelling default.
  OPENAI_TTS_MODEL?: string;
  OPENAI_TTS_INSTRUCTIONS?: string;

  // Optional alerting (Resend). When unset, alerts log a warning and no-op.
  RESEND_API_KEY?: string;

  // Optional admin override. When set, requests presenting a matching
  // X-Admin-Token header bypass cookie-based ownership checks on delete.
  ADMIN_TOKEN?: string;

  // Monthly spend cap in USD (default 10). When total_usd crosses this
  // threshold a one-time Resend alert is sent.
  MONTHLY_COST_LIMIT_USD?: string;

  // Absolute origin of the deployed site, used to absolutize relative
  // /api/media URLs when handing them to upstream services (e.g. flux-pro
  // kontext needs a fully-qualified image_url to fetch a reference image).
  // Defaults to https://storytime-app.pages.dev when unset.
  SITE_URL?: string;
}

export function requireEnv(env: Env, key: keyof Env): string {
  const v = env[key];
  if (typeof v !== 'string' || !v) throw new Error(`Missing required env var: ${String(key)}`);
  return v;
}
