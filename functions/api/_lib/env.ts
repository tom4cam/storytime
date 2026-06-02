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

  // Optional alerting (Resend). When unset, alerts log a warning and no-op.
  RESEND_API_KEY?: string;

  // Optional admin override. When set, requests presenting a matching
  // X-Admin-Token header bypass cookie-based ownership checks on delete.
  ADMIN_TOKEN?: string;

  // Monthly spend cap in USD (default 10). When total_usd crosses this
  // threshold a one-time Resend alert is sent.
  MONTHLY_COST_LIMIT_USD?: string;
}

export function requireEnv(env: Env, key: keyof Env): string {
  const v = env[key];
  if (typeof v !== 'string' || !v) throw new Error(`Missing required env var: ${String(key)}`);
  return v;
}
