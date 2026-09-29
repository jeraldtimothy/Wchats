export const NANO_PER_USD = 1_000_000_000n;
export const NANO_PER_CENT = 10_000_000n;

/** Floors a nano-USD amount to whole cents (toward negative infinity). */
export function nanoToCents(nano: bigint): number {
  const q = nano / NANO_PER_CENT;
  return Number(nano < 0n && nano % NANO_PER_CENT !== 0n ? q - 1n : q);
}

/** Parses a non-negative decimal USD string ("12.50") into nano-USD exactly. */
export function usdToNano(usd: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(usd.trim());
  if (!m) throw new Error(`Invalid USD amount: ${usd}`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? '').padEnd(9, '0'));
  return whole * NANO_PER_USD + frac;
}
