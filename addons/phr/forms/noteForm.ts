/**
 * phr's "Add a note" form, shipped to core's forms add-on (registerShippedForm,
 * ngdpbase#1880) and handled by phr (registerHandler). The forms add-on draws
 * it, checks its CSRF token and the submitter's permission, and refuses a
 * record the viewer wasn't offered; phr's handler stores the note through
 * PhrManager's door as patient-entered data.
 *
 * "store": false: the forms add-on keeps no copy of the submission, so the
 * note's words live only in phr.db. No field is named "email", so the forms
 * add-on never sends a confirmation email carrying them.
 */
import type { PhrCaller, PhrManager } from '../managers/PhrManager.js';
import { StoreError } from '../managers/PhrRecordStore.js';
import { NOTE_MAX_CHARS } from '../managers/notes.js';

export const NOTE_FORM_ID = 'phr-note';

export const NOTE_FORM = {
  id: NOTE_FORM_ID,
  title: 'Add a note to one of your records',
  description: 'Your note is kept with the record, private to you (and anyone you share your records with). It never changes what your provider sent.',
  store: false,
  fields: [
    { name: 'record', type: 'dropdown', label: 'Which record?', required: true, optionsSource: 'fetch:PhrManager.toFormOptions()' },
    { name: 'note', type: 'textarea', label: 'Your note', required: true, placeholder: 'for example: ask Dr. X about this at my next visit', description: `Up to ${NOTE_MAX_CHARS} characters.` }
  ]
};

interface Submission { data: Record<string, unknown> }
type HandlerResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };

/** The handler the forms add-on calls on submit. `toCaller` builds the request's context (core's ApiContext). */
export function noteFormHandler(records: () => PhrManager | null, toCaller: (req: unknown) => PhrCaller) {
  return async (submission: Submission, context: { req: unknown }): Promise<HandlerResult> => {
    const phr = records();
    if (!phr) return { ok: false, error: 'Health records are not available right now.' };
    const record = String(submission.data.record ?? '');
    const slash = record.indexOf('/');
    if (slash <= 0) return { ok: false, error: 'Please pick a record.', fields: { record: 'Please pick a record.' } };
    try {
      await phr.addNote(toCaller(context.req), { resourceType: record.slice(0, slash), id: record.slice(slash + 1) }, String(submission.data.note ?? ''));
      return { ok: true };
    } catch (err) {
      if (err instanceof StoreError && err.status === 400) return { ok: false, error: err.message, fields: { note: err.message } };
      if (err instanceof StoreError && err.status === 404) return { ok: false, error: 'That record was not found.', fields: { record: 'That record was not found.' } };
      throw err;
    }
  };
}
