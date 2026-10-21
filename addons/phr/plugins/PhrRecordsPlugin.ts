/**
 * [{PhrRecords}] — a person's health records at a glance, inside ngdpbase's
 * own page layout: what they hold by kind, the newest records, and a search
 * by words. Everything comes through PhrManager's one door, so a person sees
 * only their own records (or those of someone they act for by proxy).
 * Wording follows the plain-language and no-guessing rules (display.ts).
 */
import type { PermissionSubject, SimplePlugin } from '@jwilleke/ngdpbase-types';
import type { PhrCaller, PhrManager } from '../managers/PhrManager.js';
import type { StoredRecord } from '../managers/PhrRecordStore.js';
import { healthRecordsOn, type UserManagerLike } from '../preferences.js';
import { kindName, recordDate, recordName, recordValue } from '../display.js';
import { noteText } from '../managers/notes.js';

interface Viewer { username?: string | null; isAuthenticated?: boolean; ipAddress?: string }

class NotAllowed extends Error {}

export function createPhrRecordsPlugin(records: () => PhrManager | null, users: () => UserManagerLike | null | undefined): SimplePlugin {
  return {
    name: 'PhrRecords',
    // Who is looking decides what shows, so the page is never cached.
    volatile: true,
    async execute(context): Promise<string> {
      const esc = context.formatters.escapeHtml;
      const who = (context as { userContext?: Viewer }).userContext;
      if (!who?.isAuthenticated || !who.username) return '';
      if (!healthRecordsOn(await users()?.getUser(who.username))) return '';
      const phr = records();
      if (!phr) return '<p class="text-muted">Health records aren\'t available right now.</p>';

      const caller: PhrCaller = {
        subject: who as unknown as PermissionSubject,
        ipAddress: who.ipAddress,
        enforceDeny: async () => { throw new NotAllowed(); }
      };
      const q = typeof context.query?.q === 'string' ? context.query.q.trim().slice(0, 200) : '';

      try {
        const { counts: allCounts, recent: allRecent } = await phr.overview(caller, 20);
        // A person's own notes are shown under the record they're about, not as records of their own.
        const notes = await phr.notes(caller);
        const counts = allCounts.filter((c) => c.resourceType !== 'Communication');
        const recent = allRecent.filter((r) => r.resourceType !== 'Communication').slice(0, 10);
        const total = counts.reduce((n, c) => n + c.count, 0);
        const parts: string[] = [];
        if (total === 0) {
          parts.push('<p class="phr-records-empty">You don\'t have any health records here yet.</p>');
        } else {
          const kinds = counts.map((c) => `<li>${c.count} ${esc(kindName(c.resourceType, c.count))}</li>`).join('');
          parts.push(`<h2 class="h5">What you have</h2><ul class="phr-records-kinds">${kinds}</ul>`);
        }
        parts.push(`<form method="get" class="phr-records-search my-3" role="search">
  <label for="phr-q" class="form-label">Find in your records</label>
  <div class="input-group"><input type="search" class="form-control" id="phr-q" name="q" value="${esc(q)}" placeholder="for example: glucose, prediabetes, 2019">
  <button class="btn btn-primary" type="submit">Find</button></div>
</form>`);
        if (q) {
          const found = await phr.findText(caller, q, 25);
          parts.push(found.length === 0
            ? `<p class="phr-records-none">Nothing in your records matches “${esc(q)}”.</p>`
            : `<h2 class="h5">Matching “${esc(q)}”</h2>${list(found.filter((r) => r.resourceType !== 'Communication'), esc, notes)}`);
        } else if (total > 0) {
          parts.push(`<h2 class="h5">Newest records</h2>${list(recent, esc, notes)}`);
        }
        return `<div class="phr-records">${parts.join('\n')}</div>`;
      } catch (err) {
        if (err instanceof NotAllowed) return '<p class="text-muted">You can\'t see these health records.</p>';
        // Never echo details: they could carry health data.
        return '<p class="text-muted">Your health records couldn\'t be shown right now.</p>';
      }
    }
  };
}

function list(rows: readonly StoredRecord[], esc: (s: string) => string, notes: Map<string, StoredRecord[]> = new Map()): string {
  const items = rows.map((r) => {
    const name = recordName(r.resource) ?? 'Name not stated';
    const date = recordDate(r.resource) ?? 'date not stated';
    const value = recordValue(r.resource);
    const mine = (notes.get(`${r.resourceType}/${r.id}`) ?? [])
      .map((n) => `<li class="phr-note"><span class="badge bg-info text-dark">Your note</span> ${esc(String(n.resource.sent ?? '').slice(0, 10))}: ${esc(noteText(n.resource) ?? '')}</li>`)
      .join('');
    return `<li><strong>${esc(name)}</strong>${value ? ` — ${esc(value)}` : ''} <span class="text-muted">(${esc(kindName(r.resourceType, 1))}, ${esc(date)})</span>${mine ? `<ul class="phr-notes">${mine}</ul>` : ''}</li>`;
  }).join('');
  return `<ul class="phr-records-list">${items}</ul>`;
}
