/**
 * [{PhrWelcome}] — says who is signed in, in plain words, and whether they
 * have turned health records on. The first thing the phr add-on draws inside
 * ngdpbase's own page layout.
 */
import type { SimplePlugin } from '@jwilleke/ngdpbase-types';
import { RECOVERY_REMINDER, healthRecordsOn, recoveryWordsSaved, type UserManagerLike } from '../preferences.js';

/** Who is looking, as core's page context carries it (not yet a named type in core's public types). */
interface Viewer { username?: string | null; isAuthenticated?: boolean; isTest?: boolean }

export function createPhrWelcomePlugin(users: () => UserManagerLike | null | undefined): SimplePlugin {
  return {
    name: 'PhrWelcome',
    // The answer depends on who is looking, so it is never served from a page cache.
    volatile: true,
    // `context` takes SimplePlugin's own PluginContext type (core exports two; see ngdpbase).
    async execute(context): Promise<string> {
      const who = context.userContext as Viewer | undefined;
      if (!who?.isAuthenticated || !who.username) {
        return '<p class="phr-welcome">Sign in to see your health records.</p>';
      }
      const user = await users()?.getUser(who.username);
      if (!healthRecordsOn(user)) {
        return '<p class="phr-welcome">Health records are turned off for you. To use them, turn on <strong>Use health records</strong> in your <a href="/profile">profile</a>.</p>';
      }
      const test = who.isTest ? ' <span class="badge bg-warning text-dark">Test account</span>' : '';
      const welcome = `<p class="phr-welcome">You're signed in as <strong>${context.formatters.escapeHtml(who.username)}</strong>.${test}</p>`;
      if (recoveryWordsSaved(user)) return welcome;
      // Shown on every visit until the person confirms in their profile (ngdpbase#1876).
      return `<div class="alert alert-warning phr-recovery-reminder" role="alert">
  <h2 class="h5 alert-heading">Save your recovery words</h2>
  <p>${RECOVERY_REMINDER}</p>
  <p class="mb-0">The words are shown once, when you <a href="/stores/phr" class="alert-link">open your health files vault</a> for the first time. When they're written down somewhere safe, tick <strong>I've saved my 12 recovery words</strong> in your <a href="/profile" class="alert-link">profile</a>.</p>
</div>
${welcome}`;
    }
  };
}
