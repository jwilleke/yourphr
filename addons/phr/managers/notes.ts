/**
 * A user's own note about one of their records (operator decision
 * 2026-10-21): stored as its own FHIR record, never written into the
 * hospital's. A `Communication` whose `about` points at the record, tagged as
 * patient-generated health data (PGHD), the same tag yourPHR uses for
 * everything a user enters (src/patient-entry/shared.ts, yourphr#806).
 * The source record stays exactly as its provider sent it, so re-imports keep
 * working, and a user's words are always told apart from their providers'.
 * Pure: builds and reads the resource; PhrManager stores it.
 */
import { randomUUID } from 'node:crypto';

export const RECORD_ORIGIN = 'https://yourphr.org/fhir/CodeSystem/record-origin';
export const PGHD_TAG = { system: RECORD_ORIGIN, code: 'pghd', display: 'Patient-generated health data (PGHD)' } as const;
export const NOTE_SOURCE = 'patient';
export const NOTE_MAX_CHARS = 2000;

export interface NoteTarget { resourceType: string; id: string }

/** Who wrote it: the user, or the user acting for them by proxy. Names only what the session states. */
export interface NoteAuthor { username: string; actingFor?: string }

export function buildNote(about: NoteTarget, text: string, author: NoteAuthor, now: Date = new Date()): Record<string, unknown> {
  return {
    resourceType: 'Communication',
    id: `note-${randomUUID()}`,
    meta: { tag: [{ ...PGHD_TAG }] },
    status: 'completed',
    about: [{ reference: `${about.resourceType}/${about.id}` }],
    sent: now.toISOString(),
    sender: { display: author.username },
    ...(author.actingFor ? { note: [{ text: `Written by ${author.username} acting for ${author.actingFor}` }] } : {}),
    payload: [{ contentString: text }]
  };
}

/** The note's text, or undefined if it isn't one of phr's notes. */
export function noteText(resource: Record<string, unknown>): string | undefined {
  const payload = Array.isArray(resource.payload) ? resource.payload as { contentString?: unknown }[] : [];
  const s = payload.find((p) => typeof p.contentString === 'string')?.contentString;
  return typeof s === 'string' ? s : undefined;
}

/** The record a note is about, as "Type/id". */
export function noteAbout(resource: Record<string, unknown>): string | undefined {
  const about = Array.isArray(resource.about) ? resource.about as { reference?: unknown }[] : [];
  const r = about[0]?.reference;
  return typeof r === 'string' ? r : undefined;
}

export function isPatientNote(resource: Record<string, unknown>): boolean {
  const tags = ((resource.meta as { tag?: { system?: string; code?: string }[] } | undefined)?.tag) ?? [];
  return resource.resourceType === 'Communication' && tags.some((t) => t.system === RECORD_ORIGIN && t.code === PGHD_TAG.code);
}
