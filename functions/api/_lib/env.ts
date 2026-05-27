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

  // Public vars
  ANTHROPIC_MODEL?: string;

  // Optional alerting (Resend). When unset, alerts log a warning and no-op.
  RESEND_API_KEY?: string;
}

export function requireEnv(env: Env, key: keyof Env): string {
  const v = env[key];
  if (typeof v !== 'string' || !v) throw new Error(`Missing required env var: ${String(key)}`);
  return v;
}
