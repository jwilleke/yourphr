import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../../Engine.js';
import { ApiContext } from '../../ApiContext.js';
import { ConfigurationManager } from '../../ConfigurationManager.js';
import { PolicyManager } from '../PolicyManager.js';
import { FakeConfigProvider } from '../../providers/__tests__/FakeConfigProvider.js';
import { FakeUsersProvider } from '../../providers/__tests__/FakeUsersProvider.js';
import { PasswordAuthProvider } from '../../providers/PasswordAuthProvider.js';
import { UsersManager } from '../UsersManager.js';
import { EmailManager } from '../EmailManager.js';
import { NotificationManager } from '../NotificationManager.js';
import { BaseMailProvider, type MailMessage } from '../../providers/BaseMailProvider.js';

class RecordingMail extends BaseMailProvider {
  readonly name = 'smtp';
  readonly destination = 'relay.test:587 (STARTTLS required)';
  sent: (MailMessage & { from: string })[] = [];
  async send(message: MailMessage & { from: string }): Promise<void> { this.sent.push(message); }
}

let dir: string;
let engine: Engine;
let notes: NotificationManager;
let mail: RecordingMail;
let lines: string[];

async function boot(custom: Record<string, unknown> = {}): Promise<void> {
  engine = new Engine();
  mail = new RecordingMail();
  lines = [];
  notes = new NotificationManager(engine, (l) => lines.push(l));
  engine
    .register('configuration', new ConfigurationManager(engine, new FakeConfigProvider(custom as never, undefined, undefined, dir), { env: {} }))
    .register('policy', new PolicyManager(engine))
    .register('email', new EmailManager(engine, (l) => lines.push(l), () => mail))
    .register('notifications', notes)
    .register('users', new UsersManager(engine, new FakeUsersProvider(), new PasswordAuthProvider()));
  await engine.initialize();
}

const ESCALATING = {
  'yourphr.notifications.escalation.enabled': true,
  'yourphr.mail.enabled': true,
  'yourphr.mail.provider': 'smtp',
  'yourphr.mail.from': 'phr@example.org',
  'yourphr.mail.provider.smtp.host': 'relay.test',
};

async function people(): Promise<void> {
  const sys = ApiContext.system('test', 'test', engine);
  const users = engine.managers.users;
  await users.createUser(sys, 'root', 'a-long-enough-password', 'admin');
  await users.createUser(sys, 'ops', 'a-long-enough-password', 'admin');
  await users.createUser(sys, 'alice', 'a-long-enough-password');
  await users.setEmail(ApiContext.from({ username: 'root', role: 'admin' }, engine), 'root@example.org');
  await users.setEmail(ApiContext.from({ username: 'alice', role: 'user' }, engine), 'alice@example.org');
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'yourphr-notes-'));
  await boot();
});
afterEach(async () => {
  await engine.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

describe('NotificationManager — ngdpbase\'s, under yourphr.', () => {
  it('creates with ngdpbase\'s defaults and keeps it in the configured file, private to the instance', async () => {
    const id = await notes.createNotification({ message: 'hello' });
    expect(id).toBe('notification_1');
    const [n] = notes.getAllNotifications();
    expect(n).toMatchObject({ id, type: 'system', title: 'System Notification', message: 'hello', level: 'info', targetUsers: [], expiresAt: null, dismissedBy: [] });
    const file = join(dir, 'notifications', 'notifications.json');
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8')).notifications[id].message).toBe('hello');
  });

  it('shows a person what is targeted at them or at everyone, until they dismiss it — for them only', async () => {
    const all = await notes.createNotification({ title: 'everyone' });
    await notes.createNotification({ title: 'admins', targetUsers: ['root', 'ops'] });
    expect(notes.getUserNotifications('alice').map((n) => n.title)).toEqual(['everyone']);
    expect(notes.getUserNotifications('root').map((n) => n.title)).toEqual(['everyone', 'admins']);
    expect(await notes.dismissNotification(all, ApiContext.from({ username: 'root', role: 'admin' }, engine))).toBe(true);
    expect(notes.getUserNotifications('root').map((n) => n.title)).toEqual(['admins']);
    expect(notes.getUserNotifications('alice').map((n) => n.title)).toEqual(['everyone']);
    expect(await notes.dismissNotification('notification_99', ApiContext.from({ username: 'root', role: 'admin' }, engine))).toBe(false);
  });

  it('hides an expired notification unless asked, and cleans it up', async () => {
    await notes.createNotification({ title: 'old', expiresAt: new Date(Date.now() - 1000) });
    await notes.createNotification({ title: 'current' });
    expect(notes.getUserNotifications('alice').map((n) => n.title)).toEqual(['current']);
    expect(notes.getUserNotifications('alice', true)).toHaveLength(2);
    expect(notes.getStats()).toMatchObject({ total: 2, active: 1, expired: 1, byType: { system: 2 }, byLevel: { info: 2 } });
    await notes.cleanupExpiredNotifications();
    expect(notes.getAllNotifications(true).map((n) => n.title)).toEqual(['current']);
    expect(await notes.clearAllActive()).toBe(1);
    expect(notes.getAllNotifications(true)).toEqual([]);
  });

  it('survives a restart: notifications, dismissals and the id counter', async () => {
    await notes.createNotification({ title: 'one' });
    const two = await notes.createNotification({ title: 'two', expiresAt: new Date('2099-01-01T00:00:00Z') });
    await notes.dismissNotification(two, ApiContext.from({ username: 'alice', role: 'user' }, engine));
    await engine.shutdown();
    await boot();
    expect(notes.getAllNotifications().map((n) => n.title)).toEqual(['one', 'two']);
    expect(notes.getAllNotifications()[1]!.expiresAt).toEqual(new Date('2099-01-01T00:00:00Z'));
    expect(notes.getUserNotifications('alice').map((n) => n.title)).toEqual(['one']);
    expect(await notes.createNotification({ title: 'three' })).toBe('notification_3');
  });

  it('the maintenance notice is for everyone; the "disabled" one expires after a day', async () => {
    await notes.createMaintenanceNotification(true, 'root');
    const [on] = notes.getAllNotifications();
    expect(on).toMatchObject({ type: 'maintenance', level: 'warning', targetUsers: [], expiresAt: null });
    await notes.createMaintenanceNotification(false, 'root'); // replaces "on" (yourphr#854)
    const [off] = notes.getAllNotifications();
    expect(off!.level).toBe('success');
    expect(off!.expiresAt!.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
  });
});

describe('NotificationManager — links and standing conditions (yourphr#854)', () => {
  it('keeps an in-app link, and drops one that would lead off the instance', async () => {
    await notes.createNotification({ title: 'in', link: '/admin/database' });
    await notes.createNotification({ title: 'out', link: 'https://evil.example/' });
    await notes.createNotification({ title: 'scheme', link: 'javascript:alert(1)' });
    await notes.createNotification({ title: 'protocol-relative', link: '//evil.example' });
    const byTitle = Object.fromEntries(notes.getAllNotifications().map((n) => [n.title, n.link]));
    expect(byTitle).toEqual({ in: '/admin/database', out: undefined, scheme: undefined, 'protocol-relative': undefined });
  });

  it('raising a keyed condition again replaces it rather than stacking copies; resolving removes it', async () => {
    await notes.createNotification({ key: 'k', title: 'first' });
    await notes.createNotification({ key: 'k', title: 'second' });
    await notes.createNotification({ title: 'unkeyed' });
    expect(notes.getAllNotifications().map((n) => n.title).sort()).toEqual(['second', 'unkeyed']);
    expect(await notes.resolve('k')).toBe(true);
    expect(await notes.resolve('k')).toBe(false);
    expect(notes.getAllNotifications().map((n) => n.title)).toEqual(['unkeyed']);
  });

  it('turning maintenance off replaces the "on" notice, and both link to where it is switched', async () => {
    await notes.createMaintenanceNotification(true, 'ops');
    await notes.createMaintenanceNotification(false, 'ops');
    const all = notes.getAllNotifications();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ title: 'Maintenance Mode Disabled', link: '/admin/config' });
  });

  it('dismiss-all hides what the caller sees, from the caller only', async () => {
    await people();
    await notes.createNotification({ title: 'everyone' });
    await notes.createNotification({ title: 'admins', targetUsers: ['root', 'ops'] });
    expect(await notes.dismissAll(ApiContext.from({ username: 'root', role: 'admin' }, engine))).toBe(2);
    expect(notes.getUserNotifications('root')).toHaveLength(0);
    expect(notes.getUserNotifications('ops').map((n) => n.title).sort()).toEqual(['admins', 'everyone']);
    expect(notes.getUserNotifications('alice').map((n) => n.title)).toEqual(['everyone']);
  });
});

describe('NotificationManager — email escalation', () => {
  it('off by default: an error notification emails nobody', async () => {
    await people();
    await notes.createNotification({ title: 'Backups are stale', level: 'error' });
    await notes.settled();
    expect(mail.sent).toEqual([]);
  });

  it('on: an error notification emails every admin who gave an address, and nobody else', async () => {
    await engine.shutdown();
    await boot(ESCALATING);
    await people();
    await notes.createNotification({ title: 'Backups are stale', message: 'No backup in 30 hours <b>now</b>', level: 'error', targetUsers: ['root', 'ops'] });
    await notes.settled();
    expect(mail.sent.map((m) => m.to)).toEqual(['root@example.org']);
    expect(mail.sent[0]).toMatchObject({ subject: '[YourPHR] [ERROR] Backups are stale', from: 'phr@example.org' });
    expect(mail.sent[0]!.text).toContain('No backup in 30 hours <b>now</b>');
    expect(mail.sent[0]!.html).toContain('No backup in 30 hours &lt;b&gt;now&lt;/b&gt;');
    expect(lines).toContain('notifications: notification_1 emailed to root');
  });

  it('only the configured levels escalate', async () => {
    await engine.shutdown();
    await boot(ESCALATING);
    await people();
    await notes.createNotification({ title: 'fyi', level: 'warning' });
    await notes.settled();
    expect(mail.sent).toEqual([]);
    engine.managers.configuration.set('yourphr.notifications.escalation.levels', ['warning', 'error']);
    await notes.createNotification({ title: 'fyi', level: 'warning' });
    await notes.settled();
    expect(mail.sent).toHaveLength(1);
  });

  it('with mail off, escalation is logged by the mail manager, not sent — and the boot says so', async () => {
    await engine.shutdown();
    await boot({ ...ESCALATING, 'yourphr.mail.enabled': false });
    expect(lines).toContain('notifications: escalation.enabled is on but yourphr.mail.enabled is off — escalation emails will be logged, not sent');
    await people();
    await notes.createNotification({ title: 'Backups are stale', level: 'error' });
    await notes.settled();
    expect(mail.sent).toEqual([]);
    expect(lines.some((l) => l.startsWith('mail: off — not sent: to=root@example.org'))).toBe(true);
  });

  it('says so when no admin has given an address, rather than failing quietly', async () => {
    await engine.shutdown();
    await boot(ESCALATING);
    await notes.createNotification({ title: 'Backups are stale', level: 'error' });
    await notes.settled();
    expect(lines).toContain('notifications: notification_1 not escalated — no account holding admin has given an email address');
  });
});
