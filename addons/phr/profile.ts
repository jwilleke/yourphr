/**
 * The "Health records" section of /profile (ngdpbase#534). Its fields submit
 * with core's own preferences form; saveProfileSection sets only phr's own
 * switch, through core (host.setEnabledForPerson).
 */
import type { ActorContext, PersonSwitchSetter } from '@jwilleke/ngdpbase-types';
import { PHR_ENABLED, PHR_RENDERED, switchShownOn, type UserLike } from './preferences.js';

export function profileSectionHtml(user: UserLike): string {
  const checked = switchShownOn(user) ? ' checked' : '';
  return `<input type="hidden" name="${PHR_RENDERED}" value="1">
<div class="form-check form-switch">
  <input class="form-check-input" type="checkbox" role="switch" id="phr-enabled" name="${PHR_ENABLED}"${checked}>
  <label class="form-check-label" for="phr-enabled">Use health records</label>
</div>
<p class="form-text mb-0">Your health records and files are kept in your own private, encrypted vault. Only you, and people you choose, can see them. Turning this off hides health records from you; nothing is deleted.</p>`;
}

export async function saveProfileSection(setEnabledForPerson: PersonSwitchSetter, ctx: ActorContext, body: Record<string, unknown>): Promise<void> {
  // Without the marker our section wasn't on the submitted form: an absent checkbox means nothing.
  if (body[PHR_RENDERED] !== '1') return;
  await setEnabledForPerson(ctx, body[PHR_ENABLED] === 'on');
}
