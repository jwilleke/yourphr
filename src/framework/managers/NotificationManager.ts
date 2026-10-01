/**
 * Notifications (yourphr#793): messages the instance shows signed-in people until they dismiss them
 * or they expire, and — at chosen levels — emails to the people holding a role. Ported from
 * ngdpbase's NotificationManager with the same API, the same notification shape and the same
 * configuration keys under the `yourphr.` prefix. First user: the stale-backup alert (yourphr#789).
 *
 * Where it differs from ngdpbase, and why:
 *
 *   - Escalation recipients come from UsersManager.recipients(), the accounts holding the role that
 *     have given an email address (yourphr#792) — ngdpbase's searchUsers('', { role }). It goes
 *     through EmailManager as the system, so while mail is off it is logged and not sent.
 *   - The escalation email escapes the title and message before putting them in HTML. ngdpbase
 *     interpolates them raw; a notification can carry text that came from outside the instance.
 *   - The save timer is unref'd, so a pending save never holds a process open.
 */
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { BaseManager, type BackupData } from '../BaseManager.js';
import type { Engine } from '../Engine.js';
import { ApiContext } from '../ApiContext.js';

declare module '../Engine.js' {
  interface ManagerRegistry {
    notifications: NotificationManager;
  }
}

/** ngdpbase's Notification. */
export interface Notification {
  id: string;
  type: 'maintenance' | 'system' | 'user';
  title: string;
  message: string;
  level: 'info' | 'warning' | 'error' | 'success';
  /** Usernames to show it to; empty means everyone. */
  targetUsers: string[];
  createdAt: Date;
  expiresAt: Date | null;
  dismissedBy: string[];
  /** Where it is dealt with, as an in-app path ('/admin/database') — yourphr#854; ngdpbase's has none. */
  link?: string;
  /** A condition's stable name ('records.search-index.stale'): raising it again replaces the one standing, so a restart does not stack copies. yourphr#854. */
  key?: string;
}

/** ngdpbase's NotificationInput. */
export interface NotificationInput {
  type?: Notification['type'];
  title?: string;
  message?: string;
  level?: Notification['level'];
  targetUsers?: string[];
  expiresAt?: Date | null;
  link?: string;
  key?: string;
}

/** An in-app path only: a notice is shown to people, and a link in one must never lead off the instance. */
function safeLink(link: string | undefined): string | undefined {
  return link !== undefined && /^\/[a-z0-9/_-]*$/i.test(link) ? link : undefined;
}

export interface NotificationStats {
  total: number;
  active: number;
  expired: number;
  byType: Record<string, number>;
  byLevel: Record<string, number>;
}

export interface MaintenanceConfig {
  [key: string]: unknown;
}

interface NotificationsData {
  lastSaved: string;
  notifications: Record<string, Notification>;
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class NotificationManager extends BaseManager {
  readonly name = 'notifications';
  override readonly dependsOn = ['configuration'] as const;
  protected notifications = new Map<string, Notification>();
  protected notificationId = 0;
  private storagePath: string | null = null;
  private saveInterval: NodeJS.Timeout | null = null;
  /** The last escalation's delivery, for tests and the log; fire-and-forget otherwise. */
  private escalation: Promise<void> = Promise.resolve();

  constructor(engine: Engine, private readonly log: (line: string) => void = () => undefined) {
    super(engine);
  }

  private get cfg() { return this.engine.managers.configuration; }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await super.initialize(config);
    const dir = this.cfg.getString('yourphr.notifications.dir');
    const file = this.cfg.getString('yourphr.notifications.file') || 'notifications.json';
    const interval = this.cfg.getInt('yourphr.notifications.auto-save-interval');
    this.storagePath = join(dir, file);
    const intervalMs = Number.isFinite(interval) ? Math.max(1000, interval) : 5 * 60 * 1000;
    try {
      await fs.mkdir(dirname(this.storagePath), { recursive: true });
    } catch (err) {
      this.log(`notifications: could not create ${dirname(this.storagePath)}: ${(err as Error).message}`);
    }
    await this.loadNotifications();
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.saveInterval = setInterval(() => { void this.saveNotifications(); }, intervalMs);
    this.saveInterval.unref?.();
    this.log(`notifications: ${this.notifications.size} kept in ${this.storagePath}`);
    this.validateEscalationConfig();
  }

  private async loadNotifications(): Promise<void> {
    if (!this.storagePath) return;
    try {
      const data = JSON.parse(await fs.readFile(this.storagePath, 'utf8')) as NotificationsData;
      for (const [id, n] of Object.entries(data.notifications || {})) {
        n.createdAt = new Date(n.createdAt);
        if (n.expiresAt) n.expiresAt = new Date(n.expiresAt);
        this.notifications.set(id, n);
        const idNum = parseInt(id.split('_')[1] ?? '', 10);
        if (idNum > this.notificationId) this.notificationId = idNum;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log(`notifications: could not read ${this.storagePath}: ${(err as Error).message}`);
    }
  }

  private async saveNotifications(): Promise<void> {
    if (!this.storagePath) return;
    try {
      const data: NotificationsData = { lastSaved: new Date().toISOString(), notifications: Object.fromEntries(this.notifications) };
      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (err) {
      this.log(`notifications: could not save ${this.storagePath}: ${(err as Error).message}`);
    }
  }

  /** ngdpbase's createNotification: stored, saved, escalated by email when its level says so. */
  async createNotification(notification: NotificationInput): Promise<string> {
    if (notification.key !== undefined) {
      for (const [existing, n] of this.notifications.entries()) if (n.key === notification.key) this.notifications.delete(existing);
    }
    const id = `notification_${++this.notificationId}`;
    const link = safeLink(notification.link);
    const full: Notification = {
      id,
      type: notification.type || 'system',
      title: notification.title || 'System Notification',
      message: notification.message || '',
      level: notification.level || 'info',
      targetUsers: notification.targetUsers || [],
      createdAt: new Date(),
      expiresAt: notification.expiresAt || null,
      dismissedBy: [],
      ...(link !== undefined ? { link } : {}),
      ...(notification.key !== undefined ? { key: notification.key } : {}),
    };
    this.notifications.set(id, full);
    this.log(`notifications: created ${id} (${full.type}, ${full.level}): ${full.title}`);
    await this.saveNotifications();
    this.escalation = this.escalateByEmail(full);
    return id;
  }

  /** ngdpbase's alias. */
  async addNotification(notification: NotificationInput): Promise<string> {
    return this.createNotification(notification);
  }

  /** Current notifications for one person: targeted at them or at everyone, not dismissed by them. */
  getUserNotifications(username: string, includeExpired = false): Notification[] {
    const now = new Date();
    const out: Notification[] = [];
    for (const n of this.notifications.values()) {
      if (!includeExpired && n.expiresAt && n.expiresAt < now) continue;
      if ((n.targetUsers.length === 0 || n.targetUsers.includes(username)) && !n.dismissedBy.includes(username)) out.push(n);
    }
    return out;
  }

  /** Hides one notification from the caller only; nothing else changes. */
  async dismissNotification(notificationId: string, ctx: ApiContext): Promise<boolean> {
    const n = this.notifications.get(notificationId);
    if (!n) return false;
    if (!n.dismissedBy.includes(ctx.username)) {
      n.dismissedBy.push(ctx.username);
      this.log(`notifications: ${notificationId} dismissed by ${ctx.username}`);
      await this.saveNotifications();
    }
    return true;
  }

  /** Hides every notification the caller can see, from the caller only (yourphr#854's "Dismiss all"). */
  async dismissAll(ctx: ApiContext): Promise<number> {
    const mine = this.getUserNotifications(ctx.username);
    for (const n of mine) n.dismissedBy.push(ctx.username);
    if (mine.length > 0) {
      this.log(`notifications: ${mine.length} dismissed by ${ctx.username}`);
      await this.saveNotifications();
    }
    return mine.length;
  }

  /** The condition is over: remove its notice for everyone (yourphr#854). False when none was standing. */
  async resolve(key: string): Promise<boolean> {
    let removed = false;
    for (const [id, n] of this.notifications.entries()) {
      if (n.key === key) { this.notifications.delete(id); removed = true; }
    }
    if (removed) {
      this.log(`notifications: '${key}' resolved`);
      await this.saveNotifications();
    }
    return removed;
  }

  /** ngdpbase's maintenance notice, for everyone; the "disabled" one expires after a day. */
  async createMaintenanceNotification(enabled: boolean, adminUsername: string, _config: MaintenanceConfig = {}): Promise<string> {
    return this.createNotification({
      type: 'maintenance',
      title: enabled ? 'Maintenance Mode Enabled' : 'Maintenance Mode Disabled',
      message: enabled
        ? `The system is now in maintenance mode. Regular users will see a maintenance page until it is disabled by ${adminUsername}.`
        : `Maintenance mode has been disabled by ${adminUsername}. The system is now fully accessible to all users.`,
      level: enabled ? 'warning' : 'success',
      targetUsers: [],
      expiresAt: enabled ? null : new Date(Date.now() + 24 * 60 * 60 * 1000),
      // Where it is turned off; a member's banner shows no link they cannot use (yourphr#854).
      link: '/admin/config',
      key: 'maintenance',
    });
  }

  getAllNotifications(includeExpired = false): Notification[] {
    const now = new Date();
    return [...this.notifications.values()].filter((n) => includeExpired || !n.expiresAt || n.expiresAt >= now);
  }

  async cleanupExpiredNotifications(): Promise<void> {
    const now = new Date();
    let cleaned = 0;
    for (const [id, n] of this.notifications.entries()) {
      if (n.expiresAt && n.expiresAt < now) { this.notifications.delete(id); cleaned++; }
    }
    if (cleaned > 0) {
      this.log(`notifications: cleaned up ${cleaned} expired`);
      await this.saveNotifications();
    }
  }

  /** Removes every active (non-expired) notification; the count removed. */
  async clearAllActive(): Promise<number> {
    const now = new Date();
    let cleared = 0;
    for (const [id, n] of this.notifications.entries()) {
      if (!n.expiresAt || n.expiresAt >= now) { this.notifications.delete(id); cleared++; }
    }
    if (cleared > 0) {
      this.log(`notifications: cleared ${cleared} active`);
      await this.saveNotifications();
    }
    return cleared;
  }

  getStats(): NotificationStats {
    const now = new Date();
    const stats: NotificationStats = { total: this.notifications.size, active: 0, expired: 0, byType: {}, byLevel: {} };
    for (const n of this.notifications.values()) {
      if (n.expiresAt && n.expiresAt < now) stats.expired++;
      else stats.active++;
      stats.byType[n.type] = (stats.byType[n.type] || 0) + 1;
      stats.byLevel[n.level] = (stats.byLevel[n.level] || 0) + 1;
    }
    return stats;
  }

  /** The escalation now in flight, if any — for a caller (or a test) that must know it finished. */
  settled(): Promise<void> {
    return this.escalation;
  }

  /** ngdpbase's boot-time warnings: escalation on without mail that can deliver it. */
  private validateEscalationConfig(): void {
    if (!this.cfg.getBool('yourphr.notifications.escalation.enabled')) return;
    const email = this.engine.has('email') ? this.engine.managers.email : undefined;
    if (!email?.isEnabled()) {
      this.log('notifications: escalation.enabled is on but yourphr.mail.enabled is off — escalation emails will be logged, not sent');
      return;
    }
    if (email.getProviderName() === 'console') this.log('notifications: escalation is on but the mail provider is "console" — emails will print to the log, not be delivered');
    if (!email.getFrom()) {
      this.log('notifications: escalation is on but no sender address is configured — escalation emails will not send');
      return;
    }
    this.log(`notifications: email escalation active — levels ${this.cfg.getStringList('yourphr.notifications.escalation.levels').join(', ')}, role ${this.cfg.getString('yourphr.notifications.escalation.recipient-role')}`);
  }

  private async escalateByEmail(n: Notification): Promise<void> {
    try {
      if (!this.cfg.getBool('yourphr.notifications.escalation.enabled')) return;
      if (!this.cfg.getStringList('yourphr.notifications.escalation.levels').includes(n.level)) return;
      if (!this.engine.has('email') || !this.engine.has('users')) return;
      const role = this.cfg.getString('yourphr.notifications.escalation.recipient-role');
      // The system's act, not a person's — and a lookup of who holds a role, so it says why it ran.
      const system = ApiContext.system(`notification escalation: recipients holding ${role}`, 'notifications', this.engine);
      const recipients = await this.engine.managers.users.recipients(system, role);
      if (recipients.length === 0) {
        this.log(`notifications: ${n.id} not escalated — no account holding ${role} has given an email address`);
        return;
      }
      const subject = `[${n.level.toUpperCase()}] ${n.title}`;
      const text = `${n.title}\n\n${n.message}\n\nLevel: ${n.level}\nCreated: ${n.createdAt.toISOString()}`;
      const html = `<h2>${escapeHtml(n.title)}</h2><p>${escapeHtml(n.message)}</p><p><strong>Level:</strong> ${n.level}<br><strong>Created:</strong> ${n.createdAt.toISOString()}</p>`;
      for (const r of recipients) {
        try {
          const result = await this.engine.managers.email.sendTo(system, r.email, subject, text, html);
          if (result.sent) this.log(`notifications: ${n.id} emailed to ${r.username}`);
        } catch (err) {
          this.log(`notifications: ${n.id} could not be emailed to ${r.username}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.log(`notifications: escalation of ${n.id} failed: ${(err as Error).message}`);
    }
  }

  override async shutdown(): Promise<void> {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    await this.saveNotifications();
    await super.shutdown();
  }

  /** The notifications as they stand; they are a convenience, so nothing is restored from a backup. */
  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString(), payload: { count: this.notifications.size } };
  }

  async restore(): Promise<void> { /* nothing to bring back */ }
}
