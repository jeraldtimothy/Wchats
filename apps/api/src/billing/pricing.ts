/**
 * Cost math. Everything is integer BigInt; prices arrive as exact decimal
 * strings from Postgres `numeric` columns.
 *
 *   base  = (input × inPrice + cached × cachedPrice + (output + reasoning) × outPrice) per Mtok
 *         + searches × searchFee
 *   cost  = ceil(base × MARKUP)            (rounded up to the next nano-USD)
 */

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  webSearches: number;
}

export interface ModelPrices {
  inputUsdPerMtok: string;
  cachedInputUsdPerMtok: string;
  outputUsdPerMtok: string;
  webSearchUsdPerCall: string;
}

export interface CostResult {
  /** Final charge in nano-USD, after markup. */
  costNano: bigint;
  /** Provider cost before markup, in nano-USD (rounded up). */
  baseNano: bigint;
  /** Snapshot stored on the message so the charge can be audited later. */
  pricing: ModelPrices & { markup: string };
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  webSearches: 0,
};

/** "1.25" → 1_250_000n (micro-units). Accepts up to 6 decimal places. */
export function toMicro(decimal: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!m) throw new Error(`Invalid decimal: ${decimal}`);
  const frac = (m[2] ?? '').replace(/0+$/, '');
  if (frac.length > 6) throw new Error(`Too many decimal places (max 6): ${decimal}`);
  return BigInt(m[1]!) * 1_000_000n + BigInt(frac.padEnd(6, '0'));
}

/** "1.25" → 12_500n basis points. Accepts up to 4 decimal places. */
export function toBasisPoints(decimal: string): bigint {
  const micro = toMicro(decimal);
  if (micro % 100n !== 0n) throw new Error(`Markup has more than 4 decimal places: ${decimal}`);
  return micro / 100n;
}

function tokens(n: number): bigint {
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.floor(n));
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

export function computeCost(usage: Usage, prices: ModelPrices, markup: string): CostResult {
  // tokens × (micro-USD per million tokens) = pico-USD
  const pico =
    tokens(usage.inputTokens) * toMicro(prices.inputUsdPerMtok) +
    tokens(usage.cachedInputTokens) * toMicro(prices.cachedInputUsdPerMtok) +
    (tokens(usage.outputTokens) + tokens(usage.reasoningTokens)) * toMicro(prices.outputUsdPerMtok) +
    // searches × micro-USD per call × 10^6 = pico-USD
    tokens(usage.webSearches) * toMicro(prices.webSearchUsdPerCall) * 1_000_000n;

  const bps = toBasisPoints(markup);
  return {
    baseNano: ceilDiv(pico, 1000n),
    // pico × bps / 10_000 → marked-up pico; / 1000 → nano
    costNano: ceilDiv(pico * bps, 10_000n * 1000n),
    pricing: { ...prices, markup },
  };
}
