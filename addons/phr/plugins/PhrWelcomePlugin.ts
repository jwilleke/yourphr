/**
 * [{PhrWelcome}] — says who is signed in, in plain words. The first thing the
 * phr add-on draws inside ngdpbase's own page layout.
 */
interface PluginContext { userContext?: { username?: string | null; isAuthenticated?: boolean; isTest?: boolean } }

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const PhrWelcomePlugin = {
  name: 'PhrWelcome',
  execute(context: PluginContext): string {
    const who = context.userContext;
    if (!who?.isAuthenticated || !who.username) {
      return '<p class="phr-welcome">Sign in to see your health records.</p>';
    }
    const test = who.isTest ? ' <span class="badge bg-warning text-dark">Test account</span>' : '';
    return `<p class="phr-welcome">You're signed in as <strong>${escapeHtml(who.username)}</strong>.${test}</p>`;
  }
};

export default PhrWelcomePlugin;
