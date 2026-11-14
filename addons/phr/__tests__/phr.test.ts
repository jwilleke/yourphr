import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAddonHost, formatters } from '@jwilleke/ngdpbase-types/testing';
import type { ActorContext } from '@jwilleke/ngdpbase-types';
import { healthRecordsOnFor, switchShownOn, PHR_ENABLED, PHR_RENDERED } from '../preferences.js';
import { profileSectionHtml, saveProfileSection } from '../profile.js';
import { createPhrWelcomePlugin } from '../plugins/PhrWelcomePlugin.js';

const defaults = JSON.parse(readFileSync(new URL('../config/default-config.json', import.meta.url), 'utf8')) as Record<string, unknown>;

/** A stand-in for core's AddonsManager.enabledAddonsFor: phr is on for the users named. */
const onFor = (...names: string[]) => healthRecordsOnFor(() => ({
  enabledAddonsFor: async (ctx) => (names.includes(String((ctx as { username?: string }).username)) ? ['forms', 'phr'] : ['forms'])
}));
const alice = { username: 'alice', roles: ['reader'], isAuthenticated: true } as unknown as ActorContext;

describe('the "Health records" switch', () => {
  it('is on only when core lists phr among the user\'s add-ons', async () => {
    expect(await onFor('alice')(alice)).toBe(true);
    expect(await onFor('bob')(alice)).toBe(false);
    expect(await healthRecordsOnFor(() => null)(alice)).toBe(false);
  });

  it('the profile checkbox shows on only for the boolean true', () => {
    expect(switchShownOn(undefined)).toBe(false);
    expect(switchShownOn({ preferences: { [PHR_ENABLED]: 'true' } })).toBe(false);
    expect(switchShownOn({ preferences: { [PHR_ENABLED]: true } })).toBe(true);
  });

  it('shows checked only when on', () => {
    expect(profileSectionHtml({})).not.toContain(' checked');
    expect(profileSectionHtml({ preferences: { [PHR_ENABLED]: true } })).toContain(' checked');
  });

  it('saves nothing when the section was not on the submitted form', async () => {
    const calls: boolean[] = [];
    await saveProfileSection(async (_ctx, on) => { calls.push(on); }, alice, {});
    expect(calls).toEqual([]);
  });

  it('turns on and off through core\'s setter, for the user saving', async () => {
    const calls: [unknown, boolean][] = [];
    const host = buildAddonHost('phr', defaults, async (ctx, on) => { calls.push([ctx, on]); });
    await saveProfileSection(host.setEnabledForPerson, alice, { [PHR_RENDERED]: '1', [PHR_ENABLED]: 'on' });
    await saveProfileSection(host.setEnabledForPerson, alice, { [PHR_RENDERED]: '1' });
    expect(calls).toEqual([[alice, true], [alice, false]]);
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

  it('keeps one vault per user, with the slug as the vault id', () => {
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

describe('comments and footnotes are off on phr\'s categories', () => {
  const cats = defaults['ngdpbase.system-category'] as Record<string, Record<string, unknown>>;
  it('on the vault and on phr-pages, as real booleans, owned by phr', () => {
    for (const key of ['phr', 'phr-pages']) {
      expect(cats[key].comments).toBe(false);
      expect(cats[key].footnotes).toBe(false);
      expect(cats[key].owner).toBe('phr');
    }
    expect(cats['phr-pages'].encrypt).toBeUndefined();
    expect((cats['phr-pages'].storageLocation as Record<string, unknown>).privatestore).toBeUndefined();
  });

  it('the seed page lives in phr-pages with both tabs off', () => {
    const page = readFileSync(new URL('../pages/my-health-records.md', import.meta.url), 'utf8');
    expect(page).toMatch(/^system-category: phr-pages$/m);
    expect(page).toMatch(/^comments: false$/m);
    expect(page).toMatch(/^footnotes: false$/m);
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
    const plugin = createPhrWelcomePlugin(onFor());
    expect(await plugin.execute!(page(undefined), {})).toContain('Sign in');
  });

  it('points a user with health records off to their profile', async () => {
    const plugin = createPhrWelcomePlugin(onFor());
    expect(await plugin.execute!(page({ username: 'bob', isAuthenticated: true }), {})).toContain('href="/profile"');
  });

  it('escapes the username', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const plugin = createPhrWelcomePlugin(onFor(name));
    const html = await plugin.execute!(page({ username: name, isAuthenticated: true }), {});
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
