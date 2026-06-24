import { describe, it, expect } from 'vitest';

import { anthropicCostUsd } from './costs';

describe('anthropicCostUsd', () => {
  it('prices a known model from input + output tokens', () => {
    // sonnet-4-6: $3/MTok in, $15/MTok out.
    const usd = anthropicCostUsd('claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 500 });
    expect(usd).toBeCloseTo((1000 * 3 + 500 * 15) / 1_000_000, 10); // 0.0105
  });

  it('uses the cheaper haiku rate for the QC model', () => {
    const usd = anthropicCostUsd('claude-haiku-4-5', { input_tokens: 1300, output_tokens: 80 });
    expect(usd).toBeCloseTo((1300 * 1 + 80 * 5) / 1_000_000, 10);
  });

  it('includes cache read/write at their multipliers', () => {
    const usd = anthropicCostUsd('claude-sonnet-4-6', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1000, // 0.1x in
      cache_creation_input_tokens: 1000, // 1.25x in
    });
    expect(usd).toBeCloseTo((1000 * 3 * 0.1 + 1000 * 3 * 1.25) / 1_000_000, 10);
  });

  it('falls back to sonnet-tier pricing for an unknown model', () => {
    const known = anthropicCostUsd('claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 1000 });
    const unknown = anthropicCostUsd('some-future-model', { input_tokens: 1000, output_tokens: 1000 });
    expect(unknown).toBe(known);
  });

  it('returns 0 for missing/empty usage', () => {
    expect(anthropicCostUsd('claude-sonnet-4-6', null)).toBe(0);
    expect(anthropicCostUsd('claude-sonnet-4-6', {})).toBe(0);
  });
});
