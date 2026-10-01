import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { quickCheck } from '../sqlite-integrity.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function encryptedFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spike-integrity-')); dirs.push(dir);
  const file = join(dir, 'records.db');
  const db = new Database(file);
  db.pragma("cipher='sqlcipher'");
  db.pragma("key='k1'");
  db.exec('CREATE TABLE t (x TEXT); INSERT INTO t VALUES (\'a\'), (\'b\');');
  db.close();
  return file;
}

describe('the records integrity check, on a worker thread (yourphr#856)', () => {
  it('passes a sound encrypted file', async () => {
    expect(await quickCheck(encryptedFile(), 'k1')).toEqual({ ok: true, detail: 'ok' });
  });

  it('fails, with the reason, for a file that is not what it should be', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spike-integrity-')); dirs.push(dir);
    const junk = join(dir, 'records.db');
    writeFileSync(junk, Buffer.alloc(8192, 7));
    await expect(quickCheck(junk, 'k1')).rejects.toThrow();
  });

  it('a wrong key is refused rather than reported as a pass', async () => {
    await expect(quickCheck(encryptedFile(), 'not-the-key')).rejects.toThrow();
  });
});
