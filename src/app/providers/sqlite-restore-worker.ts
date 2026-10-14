/**
 * Restore staging's thread (yourphr#914) — see stageInstanceRestoreOffThread in sqlite-backup.ts.
 * One job per worker: stage, report, exit.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { stageInstanceRestore } from './sqlite-backup.js';

const { backupFile, backupKey, dataDir, targetKey } = workerData as { backupFile: string; backupKey: string; dataDir: string; targetKey: string };
try {
  parentPort?.postMessage({ ok: true, result: stageInstanceRestore(backupFile, backupKey, dataDir, targetKey) });
} catch (err) {
  parentPort?.postMessage({ ok: false, error: (err as Error).message });
}
