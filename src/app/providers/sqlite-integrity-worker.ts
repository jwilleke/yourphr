/**
 * The integrity check's thread (yourphr#856) — see quickCheck in sqlite-integrity.ts. One check per
 * worker: check, report, exit.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { quickCheckSync } from './sqlite-integrity.js';

const { file, key } = workerData as { file: string; key?: string };
try {
  parentPort?.postMessage({ ok: true, result: quickCheckSync(file, key) });
} catch (err) {
  parentPort?.postMessage({ ok: false, error: (err as Error).message });
}
