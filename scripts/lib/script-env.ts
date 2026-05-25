// Adapter that builds an env object compatible with the Cloudflare Pages
// function code in functions/api/_lib so the same storage / build / fal /
// elevenlabs helpers can run from a standalone Node script (tsx).
//
// R2 access uses the bucket's S3-compatible API. Required env:
//
//   R2_ACCOUNT_ID            Cloudflare account id (UUID-ish)
//   R2_ACCESS_KEY_ID         R2 access key id
//   R2_SECRET_ACCESS_KEY     R2 secret access key
//
// Create the access key under R2 → "Manage R2 API Tokens" in the
// Cloudflare dashboard. Permissions: read+write on both buckets.
//
// Bucket names come from wrangler.toml [[r2_buckets]] entries and must
// match the prod project so the script writes to the same data.

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
} from '@aws-sdk/client-s3';

const STORIES_BUCKET = 'story-maker-stories';
const MEDIA_BUCKET = 'story-maker-media';

function makeBucket(client: S3Client, bucket: string) {
  return {
    async put(
      key: string,
      value: ArrayBuffer | Uint8Array | string,
      options?: { httpMetadata?: { contentType?: string } }
    ) {
      const body =
        value instanceof ArrayBuffer ? new Uint8Array(value)
        : value instanceof Uint8Array ? value
        : typeof value === 'string' ? new TextEncoder().encode(value)
        : value;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: options?.httpMetadata?.contentType,
        })
      );
      return null;
    },
    async get(key: string) {
      let res;
      try {
        res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      } catch (e) {
        if (e instanceof NoSuchKey) return null;
        if ((e as { name?: string })?.name === 'NoSuchKey') return null;
        throw e;
      }
      const bytes = await res.Body!.transformToByteArray();
      const decode = () => new TextDecoder().decode(bytes);
      return {
        httpMetadata: { contentType: res.ContentType },
        async json() { return JSON.parse(decode()); },
        async text() { return decode(); },
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
    async list(opts?: { prefix?: string; limit?: number }) {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: opts?.prefix,
          MaxKeys: opts?.limit,
        })
      );
      return {
        objects: (res.Contents ?? []).map((o) => ({ key: o.Key as string })),
      };
    },
    async delete(key: string) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export function getScriptEnv() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    STORIES: makeBucket(client, STORIES_BUCKET),
    MEDIA: makeBucket(client, MEDIA_BUCKET),
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    FAL_KEY: process.env.FAL_KEY ?? '',
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY ?? '',
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
  } as unknown as import('../../functions/api/_lib/env').Env;
}
