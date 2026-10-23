/**
 * What ngdpbase's import engine does with phr's shims, for phr's own tests:
 * pick the shim that claims each file (by extension, then its "can I read
 * this?"), read it, and hand each item to PhrManager.importFile. The engine's
 * own rules (unzip, noise, fingerprints, unchanged files) are tested in
 * ngdpbase; these tests are about what phr does with a file.
 */
import type { IceItem, IceShim } from '@jwilleke/ngdpbase-types';
import { ccdaShim, fhirShim, type PhrFileData } from '../importers/shims.js';
import type { FileImportReport, PhrCaller, PhrManager } from '../managers/PhrManager.js';

const SHIMS: IceShim[] = [fhirShim(), ccdaShim()];

const ext = (name: string): string => (name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();

/** A test file as the engine hands it to a shim. */
export function fileItem(name: string, content: string | object): IceItem {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return { kind: 'file', name, bytes: Buffer.from(text, 'utf8'), text };
}

/** The shim the engine would pick for this file, or undefined when none reads it. */
export function shimFor(item: IceItem): IceShim | undefined {
  return SHIMS.find((s) => (s.accepts.extensions ?? []).includes(ext(item.name)) && (!s.accepts.canRead || s.accepts.canRead(item)));
}

/** Each file's records, as phr's shims hand them to the receiver; files no shim reads are left out. */
export async function readFiles(files: Record<string, string | object>): Promise<PhrFileData[]> {
  const out: PhrFileData[] = [];
  for (const [name, content] of Object.entries(files)) {
    const item = fileItem(name, content);
    const shim = shimFor(item);
    if (!shim?.read) continue;
    for (const produced of (await shim.read(item, { options: {}, fetch: async () => { throw new Error('no fetch in tests'); } })).items) {
      out.push(produced.data as PhrFileData);
    }
  }
  return out;
}

/** Import files through phr's shims and door, adding up what each file did. */
export async function importFiles(phr: PhrManager, caller: PhrCaller, files: Record<string, string | object>, owner?: string): Promise<FileImportReport> {
  const total: FileImportReport = { created: 0, updated: 0, unchanged: 0, skipped: 0, conflicts: 0 };
  for (const data of await readFiles(files)) {
    const r = await phr.importFile(caller, data, 'folder', owner);
    for (const k of Object.keys(total) as (keyof FileImportReport)[]) total[k] += r[k];
  }
  return total;
}
