import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAddonHost, formatters } from '@jwilleke/ngdpbase-types/testing';
import { healthRecordsOn, PHR_ENABLED, PHR_RECOVERY_SAVED, PHR_RENDERED, RECOVERY_REMINDER, type UserLike, type UserManagerLike } from '../preferences.js';
import { profileSectionHtml, saveProfileSection } from '../profile.js';
import { createPhrWelcomePlugin } from '../plugins/PhrWelcomePlugin.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;

/** An in-memory stand-in for core's UserManager: only the two calls phr makes. */
function fakeUsers(start: Record<string, UserLike>): UserManagerLike & { saved: Record<string, UserLike> } {
  const saved: Record<string, UserLike> = structuredClone(start);
  return {
    saved,
    async getUser(username) { return saved[username]; },
    async updateUser(username, updates) { saved[username] = { ...saved[username], ...updates }; return saved[username]; }
  };
}

describe('the "Health records" switch', () => {
  it('is off unless the person turned it on', () => {
    expect(healthRecordsOn(undefined)).toBe(false);
    expect(healthRecordsOn({})).toBe(false);
    expect(healthRecordsOn({ preferences: { [PHR_ENABLED]: 'true' } })).toBe(false);
    expect(healthRecordsOn({ preferences: { [PHR_ENABLED]: true } })).toBe(true);
  });

  it('shows checked only when on', () => {
    expect(profileSectionHtml({})).not.toContain(' checked');
    expect(profileSectionHtml({ preferences: { [PHR_ENABLED]: true } })).toContain(' checked');
  });

  it('saves nothing when the section was not on the submitted form', async () => {
    const users = fakeUsers({ alice: { preferences: { [PHR_ENABLED]: true } } });
    await saveProfileSection(users, { username: 'alice' }, {});
    expect(users.saved.alice.preferences?.[PHR_ENABLED]).toBe(true);
  });

  it('turns on and off, and keeps the person\'s other preferences', async () => {
    const users = fakeUsers({ alice: { preferences: { 'preferences.timezone': 'America/New_York' } } });
    await saveProfileSection(users, { username: 'alice' }, { [PHR_RENDERED]: '1', [PHR_ENABLED]: 'on' });
    expect(users.saved.alice.preferences).toEqual({ 'preferences.timezone': 'America/New_York', [PHR_ENABLED]: true, [PHR_RECOVERY_SAVED]: false });
    await saveProfileSection(users, { username: 'alice' }, { [PHR_RENDERED]: '1' });
    expect(users.saved.alice.preferences?.[PHR_ENABLED]).toBe(false);
  });
});

describe('the recovery-words reminder', () => {
  const page = (userContext: unknown) => ({ pageName: 'My Health Records', linkGraph: {}, formatters, userContext });
  const alice = { username: 'alice', isAuthenticated: true };

  it('shows on the records page until the person confirms', async () => {
    const before = await createPhrWelcomePlugin(() => fakeUsers({ alice: { preferences: { [PHR_ENABLED]: true } } })).execute!(page(alice), {});
    expect(before).toContain('Save your recovery words');
    expect(before).toContain('href="/stores/phr"');
    const after = await createPhrWelcomePlugin(() => fakeUsers({ alice: { preferences: { [PHR_ENABLED]: true, [PHR_RECOVERY_SAVED]: true } } })).execute!(page(alice), {});
    expect(after).not.toContain('Save your recovery words');
    expect(after).toContain("You're signed in as");
  });

  it('is accurate: files in the vault are lost without the words; records are not claimed lost', () => {
    expect(RECOVERY_REMINDER).toContain('health files');
    expect(RECOVERY_REMINDER).toContain('12 recovery words');
    expect(RECOVERY_REMINDER).not.toMatch(/records? (are|is) (lost|gone)/i);
  });

  it('confirming saves for that person only, and unticking brings the reminder back', async () => {
    const users = fakeUsers({ alice: { preferences: { [PHR_ENABLED]: true } }, bob: { preferences: { [PHR_ENABLED]: true } } });
    await saveProfileSection(users, { username: 'alice' }, { [PHR_RENDERED]: '1', [PHR_ENABLED]: 'on', [PHR_RECOVERY_SAVED]: 'on' });
    expect(users.saved.alice.preferences?.[PHR_RECOVERY_SAVED]).toBe(true);
    expect(users.saved.bob.preferences?.[PHR_RECOVERY_SAVED]).toBeUndefined();
    await saveProfileSection(users, { username: 'alice' }, { [PHR_RENDERED]: '1', [PHR_ENABLED]: 'on' });
    expect(users.saved.alice.preferences?.[PHR_RECOVERY_SAVED]).toBe(false);
  });

  it('the profile section carries the confirmation box, checked only when confirmed', () => {
    expect(profileSectionHtml({})).toContain('id="phr-recovery-saved"');
    expect(profileSectionHtml({ preferences: { [PHR_RECOVERY_SAVED]: true } })).toMatch(/id="phr-recovery-saved"[^>]*checked/);
  });
});

describe('the PHR vault declaration', () => {
  const category = (defaults['ngdpbase.system-category'] as Record<string, Record<string, unknown>>).phr;

  it('is owned by phr, private and encrypted, as real booleans', () => {
    expect(category.owner).toBe('phr');
    expect(category.defaultPrivate).toBe(true);
    expect(category.encrypt).toBe(true);
    expect(category.default).not.toBe(true);
  });

  it('keeps one vault per person, with the slug as the vault id', () => {
    expect((category.storageLocation as Record<string, string>).privatestore).toBe('pages/vaults/{user}/phr/');
  });
});

describe('phr is site-critical and its database must be encrypted', () => {
  it('declares site-critical as a real boolean', () => {
    expect(defaults['ngdpbase.addons.phr.site-critical']).toBe(true);
  });

  it('declares phr.db with encryption required', () => {
    expect(defaults['ngdpbase.addons.phr.database']).toEqual({ owner: 'phr', ledgerTable: 'phr_migrations', encrypt: 'required' });
  });
});

describe('core accepts phr\'s declarations', () => {
  it('builds phr\'s host from its own defaults', () => {
    const host = buildAddonHost('phr', defaults);
    expect(typeof host.ApiContext.from).toBe('function');
  });
});

describe('[{PhrWelcome}]', () => {
  const page = (userContext: unknown) => ({ pageName: 'My Health Records', linkGraph: {}, formatters, userContext });

  it('asks a visitor to sign in', async () => {
    const plugin = createPhrWelcomePlugin(() => fakeUsers({}));
    expect(await plugin.execute!(page(undefined), {})).toContain('Sign in');
  });

  it('points a person with health records off to their profile', async () => {
    const plugin = createPhrWelcomePlugin(() => fakeUsers({ bob: {} }));
    expect(await plugin.execute!(page({ username: 'bob', isAuthenticated: true }), {})).toContain('href="/profile"');
  });

  it('escapes the username', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const plugin = createPhrWelcomePlugin(() => fakeUsers({ [name]: { preferences: { [PHR_ENABLED]: true } } }));
    const html = await plugin.execute!(page({ username: name, isAuthenticated: true }), {});
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
