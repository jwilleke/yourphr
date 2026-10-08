import { describe, expect, it } from 'vitest';
import { Engine } from '../Engine.js';
import { ApiContext, ApiError } from '../ApiContext.js';
import { ConfigurationManager } from '../ConfigurationManager.js';
import { PolicyManager } from '../managers/PolicyManager.js';
import { FakeConfigProvider } from '../providers/__tests__/FakeConfigProvider.js';

// Permissions come from the merged configuration (yourphr#623), so a context needs both managers.
const engine = new Engine();
engine.register('configuration', new ConfigurationManager(engine, new FakeConfigProvider(), { env: {} }));
engine.register('policy', new PolicyManager(engine));
const ALL_PERMISSIONS = engine.managers.policy.registry().map((p) => p.permission).sort();

describe('ApiContext — who is asking, immutable, with guards that throw ApiError', () => {
  it('carries the authorization facts and freezes them', () => {
    const ctx = ApiContext.from({ username: 'alice', role: 'user', tokenGeneration: 7 }, engine);
    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.username).toBe('alice');
    expect(ctx.tokenGeneration).toBe(7);
    expect(ctx.actor).toBe('alice');
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(() => { (ctx as { role: string }).role = 'admin'; }).toThrow();
    expect(ctx.role).toBe('user');
  });

  it('guards: anonymous is 401, a member is 403 on requireAdmin, an admin passes', () => {
    const nobody = ApiContext.anonymous(engine);
    const member = ApiContext.from({ username: 'alice', role: 'user' }, engine);
    const admin = ApiContext.from({ username: 'ops', role: 'admin' }, engine);
    expect(() => nobody.requireAuthenticated()).toThrow(ApiError);
    try { nobody.requireAuthenticated(); } catch (e) { expect((e as ApiError).status).toBe(401); }
    try { member.require('admin-read'); } catch (e) { expect((e as ApiError).status).toBe(403); expect((e as ApiError).message).toBe('admin role required'); }
    expect(() => admin.require('admin-read')).not.toThrow();
    expect(member.can('admin-read')).toBe(false);
    expect(admin.can('admin-read')).toBe(true);
    expect(nobody.can('admin-read')).toBe(false);
  });

  it('the role carries its configured permissions, anonymous is a role with none, and an unknown role grants nothing (yourphr#620, #623)', () => {
    const nobody = ApiContext.anonymous(engine);
    const member = ApiContext.from({ username: 'alice', role: 'user' }, engine);
    const admin = ApiContext.from({ username: 'ops', role: 'admin' }, engine);
    expect(nobody.role).toBe('anonymous');
    expect(nobody.permissions).toEqual([]);
    expect(member.permissions).toEqual([]); // a member's own records are ownership, not a permission
    expect([...admin.permissions].sort()).toEqual(ALL_PERMISSIONS);
    // 401 before 403: nobody is asking is a different answer from you may not.
    try { nobody.require('admin-read'); } catch (e) { expect((e as ApiError).status).toBe(401); }
    // A typo in a role name must not widen anyone's powers.
    const typo = ApiContext.from({ username: 'x', role: 'Admin' as never }, engine);
    expect(typo.permissions).toEqual([]);
    // The permission list is frozen with the rest of the authorization facts.
    expect(() => (admin.permissions as string[]).push('admin-system')).toThrow();
  });

  it('a system principal acts for an account and is the named actor', () => {
    const tool = ApiContext.system('migration', 'alice', engine);
    expect(tool.isAuthenticated).toBe(true);
    expect(tool.username).toBe('alice');
    expect(tool.actor).toBe('migration');
    expect(tool.role).toBe('user');
  });

  it('ApiError carries status and extra envelope fields', () => {
    const err = new ApiError(403, 'consent first', { error_code: 'legal_consent_required' });
    expect(err.status).toBe(403);
    expect(err.extra).toEqual({ error_code: 'legal_consent_required' });
    expect(err.name).toBe('ApiError');
  });
});
