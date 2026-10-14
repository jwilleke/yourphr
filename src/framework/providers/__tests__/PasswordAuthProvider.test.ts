import { describe, expect, it } from 'vitest';
import bcryptjs from 'bcryptjs';
import { PasswordAuthProvider, hashPassword, isLegacyBcrypt, verifyPassword } from '../PasswordAuthProvider.js';

const record = (passwordHash: string) => ({ username: 'alice', passwordHash, tokenGeneration: 4, role: 'user' as const, createdAt: 'x', email: '', isTest: false });

describe('PasswordAuthProvider — scrypt with a self-describing hash, bcrypt upgrade-on-login', () => {
  it('hashes with per-user salt and verifies in constant time', () => {
    const h = hashPassword('a-long-enough-password');
    expect(h.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(verifyPassword(h, 'a-long-enough-password')).toBe(true);
    expect(verifyPassword(h, 'wrong-but-long-enough')).toBe(false);
    expect(hashPassword('a-long-enough-password')).not.toBe(h);
    expect(verifyPassword('', 'x')).toBe(false);
  });

  it('answers with a result that carries the token generation, never a boolean', async () => {
    const p = new PasswordAuthProvider();
    const ok = await p.authenticate('alice', 'pw-long-enough-1', record(p.hash('pw-long-enough-1')), 100);
    expect(ok).toMatchObject({ ok: true, subject: 'alice', provider: 'password', factors: ['password'], issuedAt: 100, tokenGeneration: 4 });
    expect(await p.authenticate('alice', 'nope-long-enough', record(p.hash('pw-long-enough-1')), 100)).toMatchObject({ ok: false });
    expect(await p.authenticate('ghost', 'anything-long-enough', undefined, 100)).toMatchObject({ ok: false });
  });

  it('verifies a Go bcrypt hash and asks for a rehash to scrypt', async () => {
    const p = new PasswordAuthProvider();
    const legacy = bcryptjs.hashSync('go-era-password-long', 4);
    expect(isLegacyBcrypt(legacy)).toBe(true);
    const r = await p.authenticate('jim', 'go-era-password-long', record(legacy), 1);
    expect(r.ok).toBe(true);
    expect((r as { rehash?: string }).rehash?.startsWith('scrypt$')).toBe(true);
    expect(await p.authenticate('jim', 'wrong-long-enough-x', record(legacy), 1)).toMatchObject({ ok: false });
  });
});
