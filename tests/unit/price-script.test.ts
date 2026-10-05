import { describe, expect, it } from 'vitest';
import { parseArgs, validateRegister } from '../../scripts/price.ts';

describe('operator price registration input', () => {
  const ok = { endpoint: 'RF13', unit: 'call', 'unit-cost': '0.05', currency: 'CNY', evidence: 'RedFox 견적서 2026-10-10', 'verified-by': 'ops@example.com' };
  it('accepts a complete, evidenced price', () => {
    expect(validateRegister(ok)).toEqual([]);
    expect(parseArgs(['register', '--endpoint', 'RF13', '--unit', 'call'])).toEqual({ cmd: 'register', opts: { endpoint: 'RF13', unit: 'call' } });
  });
  it('rejects unknown endpoints (incl. the excluded video download), floats in exponent form, missing evidence or verifier', () => {
    expect(validateRegister({ ...ok, endpoint: 'RFX1' })).toHaveLength(1);
    expect(validateRegister({ ...ok, 'unit-cost': '1e-3' })).toHaveLength(1);
    expect(validateRegister({ ...ok, 'unit-cost': '-1' })).toHaveLength(1);
    expect(validateRegister({ ...ok, evidence: '' })).toHaveLength(1);
    const { 'verified-by': _omit, ...noVerifier } = ok;
    expect(validateRegister(noVerifier)).toHaveLength(1);
    expect(() => parseArgs(['register', '--endpoint'])).toThrow();
  });
});
