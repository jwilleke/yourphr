/**
 * The person's own "Health records" switch (operator decision 2026-10-16):
 * each person turns phr on for themselves in /profile, and it is off until
 * they do. Stored in the person's core preferences under `phr.enabled`.
 * This file is the one place that reads or writes it.
 */
export const PHR_ENABLED = 'phr.enabled';
/** The person has confirmed they saved their vault's 12 recovery words (operator decision 2026-10-20, ngdpbase#1876). */
export const PHR_RECOVERY_SAVED = 'phr.recoveryWordsSaved';
/** Hidden marker the profile section emits, so a save can tell "unchecked" from "not shown". */
export const PHR_RENDERED = 'phr._rendered';

// UserManager isn't in core's public types yet (asked of ngdpbase); only the calls phr makes.
export interface UserLike { preferences?: Record<string, unknown> }
export interface UserManagerLike {
  getUser(username: string): Promise<UserLike | null | undefined>;
  updateUser(username: string, updates: { preferences: Record<string, unknown> }, ctx: unknown): Promise<unknown>;
}

/** On only when the person turned it on. Anything else, including no preference, is off. */
export function healthRecordsOn(user: UserLike | null | undefined): boolean {
  return user?.preferences?.[PHR_ENABLED] === true;
}

/** Confirmed only when the person ticked it. Anything else keeps the reminder showing. */
export function recoveryWordsSaved(user: UserLike | null | undefined): boolean {
  return user?.preferences?.[PHR_RECOVERY_SAVED] === true;
}

/**
 * The reminder, in plain words. Accurate about what is and isn't recoverable:
 * the vault's files open only with the person's own password or recovery words;
 * their records in phr.db are under the site key and backed up (D2).
 */
export const RECOVERY_REMINDER =
  'Your health files (PDFs, scans and other documents you add) are locked with your own password. ' +
  'Nobody, not even the site\'s administrator, can open them for you. If you forget your password, ' +
  'your 12 recovery words are the only way back. Without them, those files are lost for good.';
