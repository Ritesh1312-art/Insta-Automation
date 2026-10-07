import { describe, expect, it } from 'vitest';
import { formatPaiseAsInr, verifiedRevenuePaise } from './plans';

describe('formatPaiseAsInr', () => {
  it('converts paise to rupees, not rupees to paise', () => {
    // DirectUpiPayment.amount is stored in paise: PREMIUM costs ₹299 = 29,900 paise.
    expect(formatPaiseAsInr(29_900)).toBe('₹299');
    expect(formatPaiseAsInr(99_00)).toBe('₹99');
    expect(formatPaiseAsInr(1_299_00)).toBe('₹1,299');
  });

  it('keeps two fraction digits for non-round paise amounts', () => {
    expect(formatPaiseAsInr(29_950)).toBe('₹299.50');
    expect(formatPaiseAsInr(1)).toBe('₹0.01');
  });
});

describe('verifiedRevenuePaise', () => {
  it('sums only VERIFIED payments and returns paise', () => {
    const payments = [
      { amount: 29_900, status: 'VERIFIED' },
      { amount: 9_900, status: 'PENDING_REVIEW' },
      { amount: 69_900, status: 'REJECTED' },
      { amount: 99_00, status: 'VERIFIED' },
    ];
    expect(verifiedRevenuePaise(payments)).toBe(29_900 + 9_900);
  });

  it('returns zero when nothing is verified and formats correctly', () => {
    expect(verifiedRevenuePaise([])).toBe(0);
    expect(verifiedRevenuePaise([{ amount: 29_900, status: 'PENDING_REVIEW' }])).toBe(0);
    expect(formatPaiseAsInr(verifiedRevenuePaise([
      { amount: 29_900, status: 'VERIFIED' },
      { amount: 9_900, status: 'VERIFIED' },
    ]))).toBe('₹398');
  });
});
