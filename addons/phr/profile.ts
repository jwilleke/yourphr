/**
 * The "Health records" section of /profile (ngdpbase#534). Its fields submit
 * with core's own preferences form; saveProfileSection writes only phr's key.
 */
import { PHR_ENABLED, PHR_RENDERED, healthRecordsOn, type UserLike, type UserManagerLike } from './preferences.js';

export function profileSectionHtml(user: UserLike): string {
  const checked = healthRecordsOn(user) ? ' checked' : '';
  return `<input type="hidden" name="${PHR_RENDERED}" value="1">
<div class="form-check form-switch">
  <input class="form-check-input" type="checkbox" role="switch" id="phr-enabled" name="${PHR_ENABLED}"${checked}>
  <label class="form-check-label" for="phr-enabled">Use health records</label>
</div>
<p class="form-text mb-0">Your health records and files are kept in your own private, encrypted vault. Only you, and people you choose, can see them. Turning this off hides health records from you; nothing is deleted.</p>`;
}

export async function saveProfileSection(users: UserManagerLike | null | undefined, ctx: { username: string }, body: Record<string, unknown>): Promise<void> {
  // Without the marker our section wasn't on the submitted form: an absent checkbox means nothing.
  if (body[PHR_RENDERED] !== '1' || !users) return;
  const fresh = await users.getUser(ctx.username);
  const preferences = { ...(fresh?.preferences ?? {}), [PHR_ENABLED]: body[PHR_ENABLED] === 'on' };
  await users.updateUser(ctx.username, { preferences }, ctx);
}
