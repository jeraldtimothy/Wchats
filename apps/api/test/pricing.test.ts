import { describe, expect, it } from 'vitest';
import { nanoToCents, usdToNano } from '../src/billing/money.js';
import { computeCost, toBasisPoints, toMicro } from '../src/billing/pricing.js';

const prices = {
  inputUsdPerMtok: '2.500000',
  cachedInputUsdPerMtok: '0.250000',
  outputUsdPerMtok: '10.000000',
  webSearchUsdPerCall: '0.010000',
};

describe('pricing', () => {
  it('parses decimals exactly', () => {
    expect(toMicro('1.25')).toBe(1_250_000n);
    expect(toMicro('0.000001')).toBe(1n);
    expect(toMicro('3.100000')).toBe(3_100_000n);
    expect(() => toMicro('0.0000001')).toThrow();
    expect(toBasisPoints('1.25')).toBe(12_500n);
    expect(toBasisPoints('1')).toBe(10_000n);
  });

  it('applies the spec formula with markup', () => {
    const usage = { inputTokens: 1000, cachedInputTokens: 2000, outputTokens: 300, reasoningTokens: 200, webSearches: 2 };
    // input 1000 × $2.5/M = $0.0025; cached 2000 × $0.25/M = $0.0005;
    // (300+200) × $10/M = $0.005; searches 2 × $0.01 = $0.02  → $0.028
    const r = computeCost(usage, prices, '1.25');
    expect(r.baseNano).toBe(28_000_000n);
    expect(r.costNano).toBe(35_000_000n); // × 1.25
    expect(r.pricing.markup).toBe('1.25');
  });

  it('rounds up to the next nano-USD', () => {
    // 1 token × $0.000001/M = 1e-12 USD → rounds up to 1 nano-USD
    const r = computeCost(
      { inputTokens: 1, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 },
      { ...prices, inputUsdPerMtok: '0.000001' },
      '1',
    );
    expect(r.costNano).toBe(1n);
  });

  it('charges nothing for zero usage', () => {
    const r = computeCost(
      { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 },
      prices,
      '1.25',
    );
    expect(r.costNano).toBe(0n);
  });

  it('converts between USD, nano and cents', () => {
    expect(usdToNano('12.34')).toBe(12_340_000_000n);
    expect(nanoToCents(12_349_999_999n)).toBe(1234);
    expect(nanoToCents(-1n)).toBe(-1);
    expect(nanoToCents(0n)).toBe(0);
  });
});
