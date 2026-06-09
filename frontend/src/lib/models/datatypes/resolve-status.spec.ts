import { resolveStatus } from './resolve-status';

describe('resolveStatus (#54 non-US-Core)', () => {
  it('returns undefined for null/undefined', () => {
    expect(resolveStatus(undefined)).toBeUndefined();
    expect(resolveStatus(null)).toBeUndefined();
  });

  it('returns a plain string as-is (loose non-US-Core exporters)', () => {
    expect(resolveStatus('active')).toBe('active');
  });

  it('code-first by default (preserves US Core codes)', () => {
    expect(resolveStatus({ coding: [{ code: 'active', display: 'Active' }] })).toBe('active');
  });

  it('display-first when preferDisplay=true', () => {
    expect(resolveStatus({ coding: [{ code: 'active', display: 'Active' }] }, true)).toBe('Active');
  });

  it('falls back to coding display when no code (code-first)', () => {
    expect(resolveStatus({ coding: [{ display: 'Active' }] })).toBe('Active');
  });

  it('falls back to text when there is no coding', () => {
    expect(resolveStatus({ text: 'Active' })).toBe('Active');
    expect(resolveStatus({ text: 'Active' }, true)).toBe('Active');
  });

  it('returns undefined for an empty concept', () => {
    expect(resolveStatus({})).toBeUndefined();
  });
});
