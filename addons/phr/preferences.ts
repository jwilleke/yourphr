/**
 * The user's own "Health records" switch (operator decision 2026-10-16):
 * each user turns phr on for themselves in /profile, and it is off until
 * they do. phr is a per-user add-on (`perPerson: true` in package.json), so
 * the switch is core's (ngdpbase#1963): the preference `phr.enabled`, written
 * only through `host.setEnabledForPerson` and read only through
 * `AddonsManager.enabledAddonsFor`. This file is phr's one place for it.
 */
import type { ActorContext } from '@jwilleke/ngdpbase-types';

export const PHR_ENABLED = 'phr.enabled';
/** Hidden marker the profile section emits, so a save can tell "unchecked" from "not shown". */
export const PHR_RENDERED = 'phr._rendered';

/** Is phr on for the user this context acts as? */
export type HealthRecordsOn = (ctx: ActorContext) => Promise<boolean>;

// Only the call phr makes on core's AddonsManager.
export interface AddonsManagerLike { enabledAddonsFor(ctx: ActorContext): Promise<string[]> }

/** On only when core lists phr among the user's turned-on add-ons. No manager: off. */
export function healthRecordsOnFor(addons: () => AddonsManagerLike | null | undefined): HealthRecordsOn {
  return async (ctx) => {
    const manager = addons();
    return manager ? (await manager.enabledAddonsFor(ctx)).includes('phr') : false;
  };
}

/**
 * The profile section's checkbox state, from the account core hands
 * `profileSection(user)`. That hook carries no context to ask core with; this
 * is display only, and nothing is decided from it.
 */
export interface UserLike { preferences?: Record<string, unknown> }
export function switchShownOn(user: UserLike | null | undefined): boolean {
  return user?.preferences?.[PHR_ENABLED] === true;
}
