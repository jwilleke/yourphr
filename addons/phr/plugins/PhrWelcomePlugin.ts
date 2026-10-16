/**
 * [{PhrWelcome}] — says who is signed in, in plain words, and whether they
 * have turned health records on. The first thing the phr add-on draws inside
 * ngdpbase's own page layout.
 */
import { healthRecordsOn, type UserManagerLike } from '../preferences.js';

interface PluginContext { userContext?: { username?: string | null; isAuthenticated?: boolean; isTest?: boolean } }

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function createPhrWelcomePlugin(users: () => UserManagerLike | null | undefined) {
  return {
    name: 'PhrWelcome',
    // The answer depends on who is looking, so it is never served from a page cache.
    volatile: true,
    async execute(context: PluginContext): Promise<string> {
      const who = context.userContext;
      if (!who?.isAuthenticated || !who.username) {
        return '<p class="phr-welcome">Sign in to see your health records.</p>';
      }
      const user = await users()?.getUser(who.username);
      if (!healthRecordsOn(user)) {
        return '<p class="phr-welcome">Health records are turned off for you. To use them, turn on <strong>Use health records</strong> in your <a href="/profile">profile</a>.</p>';
      }
      const test = who.isTest ? ' <span class="badge bg-warning text-dark">Test account</span>' : '';
      return `<p class="phr-welcome">You're signed in as <strong>${escapeHtml(who.username)}</strong>.${test}</p>`;
    }
  };
}
