export function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/**
 * Formats an exact nano-USD decimal string. Amounts under a cent keep four
 * decimals so small usage charges don't all read "$0.00".
 */
export function formatNanoUsd(nano: string): string {
  const n = BigInt(nano);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const small = abs > 0n && abs < 10_000_000n;
  const digits = small ? 4 : 2;
  const unit = 10n ** BigInt(9 - digits);
  const rounded = (abs + unit / 2n) / unit; // round half up at the shown precision
  const whole = rounded / 10n ** BigInt(digits);
  const frac = (rounded % 10n ** BigInt(digits)).toString().padStart(digits, '0');
  return `${neg ? '-' : ''}$${whole.toLocaleString()}.${frac}`;
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);
export const daysAgoUtc = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
