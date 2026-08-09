import { describe, expect, it } from 'vitest';
import { esc, fmtTallyDate, sanitizeXml } from '../src/xml.js';
import { extractRate, getCostPrice } from '../src/parse/rates.js';
import { parseQty } from '../src/parse/common.js';

describe('esc', () => {
  it('escapes XML special characters', () => {
    expect(esc('A & B <Pvt> "Ltd"')).toBe('A &amp; B &lt;Pvt&gt; &quot;Ltd&quot;');
  });
});

describe('fmtTallyDate', () => {
  it('formats as YYYYMMDD in local time', () => {
    expect(fmtTallyDate(new Date(2026, 4, 1))).toBe('20260501');
    expect(fmtTallyDate(new Date(2026, 11, 31))).toBe('20261231');
  });
});

describe('sanitizeXml', () => {
  it('drops illegal control-char entities but keeps legal ones', () => {
    expect(sanitizeXml('<N>a&#4;b</N>')).toBe('<N>ab</N>');
    expect(sanitizeXml('<N>a&#10;b</N>')).toBe('<N>a&#10;b</N>');
    expect(sanitizeXml('<N>a&#x04;b</N>')).toBe('<N>ab</N>');
    expect(sanitizeXml('<N>a&#38;b</N>')).toBe('<N>a&#38;b</N>');
  });
  it('strips literal control characters', () => {
    expect(sanitizeXml('<N>a\x04b\tc</N>')).toBe('<N>ab\tc</N>');
  });
});

describe('extractRate', () => {
  it('handles plain, suffixed, numeric and text-node shapes', () => {
    expect(extractRate('196.00')).toBe(196);
    expect(extractRate('196.00/Set')).toBe(196);
    expect(extractRate(250)).toBe(250);
    expect(extractRate({ _: '99.50/NOS' })).toBe(99.5);
    expect(extractRate('')).toBe(0);
    expect(extractRate(undefined)).toBe(0);
  });
});

describe('getCostPrice fallback chain', () => {
  it('computes from ClosingValue / ClosingBalance as last resort', () => {
    expect(getCostPrice({ CLOSINGVALUE: '300.00', CLOSINGBALANCE: ' 3 NOS' })).toBe(100);
  });
});

describe('parseQty', () => {
  it('extracts numeric quantity from Tally qty strings', () => {
    expect(parseQty(' 42 NOS')).toBe(42);
    expect(parseQty('7.50 Set')).toBe(7.5);
    expect(parseQty('-2 NOS')).toBe(-2);
    expect(parseQty('')).toBe(0);
  });
});
