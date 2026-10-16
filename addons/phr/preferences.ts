/**
 * The person's own "Health records" switch (operator decision 2026-10-16):
 * each person turns phr on for themselves in /profile, and it is off until
 * they do. Stored in the person's core preferences under `phr.enabled`.
 * This file is the one place that reads or writes it.
 */
export const PHR_ENABLED = 'phr.enabled';
/** Hidden marker the profile section emits, so a save can tell "unchecked" from "not shown". */
export const PHR_RENDERED = 'phr._rendered';

export interface UserLike { preferences?: Record<string, unknown> }
export interface UserManagerLike {
  getUser(username: string): Promise<UserLike | null | undefined>;
  updateUser(username: string, updates: { preferences: Record<string, unknown> }, ctx: unknown): Promise<unknown>;
}

/** On only when the person turned it on. Anything else, including no preference, is off. */
export function healthRecordsOn(user: UserLike | null | undefined): boolean {
  return user?.preferences?.[PHR_ENABLED] === true;
}
