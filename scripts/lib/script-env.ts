// Adapter that builds an env object compatible with the Cloudflare Pages
// function code in functions/api/_lib so the same storage / build / fal /
// elevenlabs helpers can run from a standalone Node script (tsx).
//
// Two backends for R2 access:
//
//  1. S3-compatible API (fast, parallel). Used when these env vars are set:
//       R2_ACCOUNT_ID
//       R2_ACCESS_KEY_ID
//       R2_SECRET_ACCESS_KEY
//     Create the access key under R2 → Manage R2 API Tokens with
//     read+write on both buckets.
//
//  2. wrangler CLI shell-out (no extra credentials; uses the existing
//     `wrangler login` OAuth). Slower (one CLI spawn per object) but
//     unblocks you when the R2 token UI is uncooperative. Activates when
//     any of the three R2_* vars above is missing.
//
// Bucket names come from wrangler.toml [[r2_buckets]] entries.

import { spawn } from 'node:child_process';
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

type PutValue = ArrayBuffer | Uint8Array | string;
type PutOptions = { httpMetadata?: { contentType?: string } };

function toBytes(value: PutValue): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new TextEncoder().encode(value);
}

// ---- S3 path ----------------------------------------------------------

function makeS3Bucket(client: S3Client, bucket: string) {
  return {
    async put(key: string, value: PutValue, options?: PutOptions) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: toBytes(value),
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
      return { objects: (res.Contents ?? []).map((o) => ({ key: o.Key as string })) };
    },
    async delete(key: string) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

// ---- wrangler CLI path -------------------------------------------------

function spawnWrangler(args: string[], stdinBytes?: Uint8Array): Promise<{
  stdout: Buffer;
  stderr: string;
  code: number;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout: Buffer.concat(out), stderr: err, code: code ?? 0 }));
    if (stdinBytes && stdinBytes.byteLength > 0) {
      child.stdin.end(Buffer.from(stdinBytes));
    } else {
      child.stdin.end();
    }
  });
}

function isNotFound(stderr: string, stdout: Buffer): boolean {
  const haystack = (stderr + stdout.toString('utf8')).toLowerCase();
  return (
    haystack.includes('does not exist') ||
    haystack.includes('no such key') ||
    haystack.includes('the specified key') ||
    haystack.includes('not found') ||
    haystack.includes('404')
  );
}

function makeWranglerBucket(bucket: string) {
  return {
    async put(key: string, value: PutValue, options?: PutOptions) {
      const args = ['r2', 'object', 'put', `${bucket}/${key}`, '--remote', '--pipe'];
      const ct = options?.httpMetadata?.contentType;
      if (ct) args.push('--content-type', ct);
      const res = await spawnWrangler(args, toBytes(value));
      if (res.code !== 0) {
        throw new Error(`wrangler r2 put ${bucket}/${key} failed: ${res.stderr.trim()}`);
      }
      return null;
    },
    async get(key: string) {
      const res = await spawnWrangler(['r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--pipe']);
      if (res.code !== 0) {
        if (isNotFound(res.stderr, res.stdout)) return null;
        throw new Error(`wrangler r2 get ${bucket}/${key} failed: ${res.stderr.trim()}`);
      }
      const bytes = new Uint8Array(res.stdout);
      const decode = () => new TextDecoder().decode(bytes);
      return {
        httpMetadata: { contentType: undefined as string | undefined },
        async json() { return JSON.parse(decode()); },
        async text() { return decode(); },
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
    async list(_opts?: { prefix?: string; limit?: number }): Promise<never> {
      throw new Error('list() requires the S3 backend; set R2_* env vars');
    },
    async delete(key: string) {
      const res = await spawnWrangler(['r2', 'object', 'delete', `${bucket}/${key}`, '--remote']);
      if (res.code !== 0) {
        throw new Error(`wrangler r2 delete ${bucket}/${key} failed: ${res.stderr.trim()}`);
      }
    },
  };
}

// ---- env factory -------------------------------------------------------

export function getScriptEnv() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const haveS3 = !!(accountId && accessKeyId && secretAccessKey);

  let stories;
  let media;
  if (haveS3) {
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    });
    stories = makeS3Bucket(client, STORIES_BUCKET);
    media = makeS3Bucket(client, MEDIA_BUCKET);
    console.log('[script-env] R2 backend: S3 API');
  } else {
    stories = makeWranglerBucket(STORIES_BUCKET);
    media = makeWranglerBucket(MEDIA_BUCKET);
    console.log('[script-env] R2 backend: wrangler CLI (set R2_* env for the faster S3 path)');
  }

  return {
    STORIES: stories,
    MEDIA: media,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    FAL_KEY: process.env.FAL_KEY ?? '',
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  } as unknown as import('../../functions/api/_lib/env').Env;
}
