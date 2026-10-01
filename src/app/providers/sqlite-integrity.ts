/**
 * The records file's integrity check (yourphr#856), off the request thread.
 *
 * `PRAGMA quick_check` reads every page of the file, and better-sqlite3 is synchronous: run on the
 * server's own thread it answers nothing — not the household, not the liveness probe — until it
 * finishes. On an 8.4 GB file that was long enough to get the pod killed on every admin page load
 * (2026-09-26), which is why the Database card stopped checking at all. So it runs on a worker
 * thread with its own connection, as the backup export does (yourphr#787). The key travels in
 * workerData (memory), never argv or the environment.
 */
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3-multiple-ciphers';

export interface IntegrityResult {
  ok: boolean;
  /** 'ok', or SQLite's first few complaints, joined. */
  detail: string;
}

/** Synchronous: the worker's body, and the tests'. Never call it from a request. */
export function quickCheckSync(file: string, key: string | undefined): IntegrityResult {
  const db = new Database(file, { fileMustExist: true });
  try {
    if (key) {
      db.pragma("cipher='sqlcipher'");
      db.pragma(`key='${key.replace(/'/g, "''")}'`);
    }
    const rows = (db.pragma('quick_check') as { quick_check: string }[]).map((r) => String(r.quick_check));
    const ok = rows.length === 1 && rows[0]!.toLowerCase() === 'ok';
    return { ok, detail: ok ? 'ok' : rows.slice(0, 5).join('; ') };
  } finally {
    db.close();
  }
}

/** quickCheckSync on a worker thread. */
export function quickCheck(file: string, key: string | undefined): Promise<IntegrityResult> {
  // Compiled, the worker is the .js beside this file. From source (tsx, vitest) it is the .ts, and
  // the worker needs tsx's loader to read it.
  const fromSource = import.meta.url.endsWith('.ts');
  const entry = new URL(fromSource ? './sqlite-integrity-worker.ts' : './sqlite-integrity-worker.js', import.meta.url);
  return new Promise((resolve, reject) => {
    const worker = new Worker(entry, { workerData: { file, key }, ...(fromSource ? { execArgv: ['--import', 'tsx'] } : {}) });
    let settled = false;
    worker.once('message', (m: { ok: true; result: IntegrityResult } | { ok: false; error: string }) => {
      settled = true;
      if (m.ok) resolve(m.result);
      else reject(new Error(m.error));
    });
    worker.once('error', (err) => { settled = true; reject(err); });
    worker.once('exit', (code) => { if (!settled) reject(new Error(`the integrity check worker exited (code ${code}) without a result`)); });
  });
}
