import { describe, expect, it } from 'vitest';
import { formatCents, formatNanoUsd } from './format';

describe('formatNanoUsd', () => {
  it('shows two decimals from a cent up', () => {
    expect(formatNanoUsd('0')).toBe('$0.00');
    expect(formatNanoUsd('10000000')).toBe('$0.01');
    expect(formatNanoUsd('12345678901')).toBe('$12.35');
    expect(formatNanoUsd('112498931250')).toBe('$112.50');
  });

  it('keeps four decimals below a cent so small charges are visible', () => {
    expect(formatNanoUsd('1068750')).toBe('$0.0011');
    expect(formatNanoUsd('5000000')).toBe('$0.0050');
    expect(formatNanoUsd('1')).toBe('$0.0000');
  });

  it('handles negative amounts', () => {
    expect(formatNanoUsd('-1068750')).toBe('-$0.0011');
    expect(formatNanoUsd('-2500000000')).toBe('-$2.50');
  });

  it('is exact for balances beyond float precision', () => {
    expect(formatNanoUsd('9007199254740993000')).toBe(`$${(9007199254n).toLocaleString()}.74`);
  });
});

describe('formatCents', () => {
  it('formats signed cents', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(1234)).toBe('$12.34');
    expect(formatCents(-50)).toBe('-$0.50');
  });
});
