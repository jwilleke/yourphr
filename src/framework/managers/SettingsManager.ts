/**
 * Settings (yourphr#618): the one door to what this instance says about itself — the public
 * instance keys an anonymous caller may read, the signed-in member's view, and the operator's
 * configuration and instance cards. The doc's `SettingsManager` (Q8), over the `configuration`
 * manager: it holds no state of its own, so backup() is empty and the configuration manager's
 * overlay is the thing that travels.
 *
 * Why a manager and not closures in the composition root: the caller is passed in. Until #618 the
 * admin card took no context at all — the route gate decided who was an admin and the log said
 * "admin revealed configuration value" without a name. Every method here takes `ctx`, the admin
 * methods re-check `requireAdmin()` themselves (the route's gate is the outer wall, not the only
 * one), and reveal / set / reset are logged by `ctx.actor`. Policy lives here too — unknown key
 * 400, env-pinned 409, coercion to the shipped type, the contact-address shape checks — as
 * ApiError, so the one error boundary renders it and a harness reads the same message.
 */
import { BaseManager, type BackupData } from '../BaseManager.js';
import type { Engine } from '../Engine.js';
import { ApiError, type ApiContext } from '../ApiContext.js';
import { envNameFor, PUBLIC_KEYS_KEY, type ConfigValue } from '../../config/index.js';
import { loadLegalDocument, parseLegalKind, type LegalDocument } from '../../legal/index.js';

declare module '../Engine.js' {
  interface ManagerRegistry {
    settings: SettingsManager;
  }
}

/** Go's AdminConfigResponse row (yourphr#602). */
export interface ConfigEntry {
  key: string;
  value: ConfigValue | '••••';
  masked: boolean;
  source: 'custom' | 'default';
  public: boolean;
  promoted: boolean;
  default: ConfigValue | '••••';
  from_env: boolean;
  env_var: string;
}

export interface InstanceSettings {
  name: string;
  contact_email: string;
  contact_url: string;
}

export interface SettingsOptions {
  /** Where the admin's deliberate acts are recorded (reveal, set, reset). */
  log?: (line: string) => void;
  /** The data directory — where an operator's legal-text override lives (yourphr#619). */
  dataDir?: string;
}

// The allow-list moved into the shipped configuration with yourphr#629 — Go's `public` key, Go's
// shape. An instance may widen it in app-custom-config.json, which is why `promoted` exists.

export class SettingsManager extends BaseManager {
  readonly name = 'settings';
  override readonly dependsOn = ['configuration'] as const;
  private readonly log: (line: string) => void;
  private readonly dataDir: string | undefined;

  constructor(engine: Engine, options: SettingsOptions = {}) {
    super(engine);
    this.log = options.log ?? (() => undefined);
    this.dataDir = options.dataDir;
  }

  /**
   * The privacy policy or terms text (yourphr#596) — public, the shipped text unless the operator
   * overrides it in the data directory. Undefined for a kind this stack does not have; throws when
   * an override exists but is unusable (the operator must know, not get the shipped text silently).
   */
  legalDocument(_ctx: ApiContext, kind: string): LegalDocument | undefined {
    const parsed = parseLegalKind(kind);
    if (!parsed) return undefined;
    if (this.dataDir === undefined) throw new ApiError(500, 'legal documents are not configured on this instance');
    return loadLegalDocument(this.dataDir, parsed);
  }

  private get configuration() {
    return this.engine.managers.configuration;
  }

  /** Keys an anonymous caller may read — the allow-list as this instance has it (yourphr#457). */
  private publicKeys(): string[] {
    return this.configuration.getStringList(PUBLIC_KEYS_KEY);
  }

  /**
   * Only what an anonymous caller may know. The instance keys Go publishes that this stack has a
   * value for; a key this stack does not have (theme, demo, signup, the wider password policy) is
   * ABSENT, and the Angular app's mapper already defaults an absent key — nothing is invented to
   * fill Go's list. The password minimum is published so the UI can say it before the server
   * refuses (yourphr#506's shape).
   */
  publicInstance(_ctx: ApiContext): Record<string, unknown> {
    const config = this.configuration;
    // The FIELD NAMES are wire format — the Angular app reads these literal strings, and Go
    // publishes the same ones — so they are deliberately NOT the configuration key names
    // (yourphr#627). The config keys moved to the yourphr.* convention; these did not, because
    // renaming them would be a frontend break dressed up as a settings cleanup.
    return {
      'operator.name': config.getString('yourphr.operator.name'),
      'operator.contact_url': config.getString('yourphr.operator.contact-url'),
      'password.min_length': config.getInt('yourphr.auth.password.min-length'),
      // The sign-in page hides its "create an account" link when this is false (yourphr#691), so
      // it has to be readable BEFORE anyone has a session. Publishing it discloses nothing: it is
      // a policy of the instance, and an attacker learns the same thing by pressing the button.
      'signup.enabled': config.getBool('yourphr.auth.signup.enabled'),
      // The sign-in page decides whether to offer the one-click demo entrances (yourphr#643,
      // yourphr#644). Only the FLAGS are public: neither username is published — a name is half a
      // credential, and the entrances need no name — and both passwords are secrets verified
      // server-side. demo.admin.enabled is false unless demo mode is on as well, so the UI cannot
      // offer an admin tour on an instance that is not a demo.
      'demo.enabled': config.getBool('yourphr.demo.enabled'),
      'demo.admin.enabled': config.getBool('yourphr.demo.enabled') && config.getBool('yourphr.demo.admin.enabled'),
      // Whether this instance offers agent tokens (yourphr#695, yourphr#719). The Settings screen
      // hides the whole section when it is off, rather than offering a mint the server refuses.
      // It is already in the `yourphr.public` allow-list; it was simply never published.
      'agent_token.enabled': config.getBool('yourphr.auth.agent-token.enabled'),
    };
  }

  /** What a signed-in member may know (yourphr#593): public plus the operator contact (yourphr#459). */
  instanceForUser(ctx: ApiContext): Record<string, unknown> {
    ctx.requireAuthenticated();
    return {
      ...this.publicInstance(ctx),
      'operator.contact_email': this.configuration.getString('yourphr.operator.contact-email'), // wire format, not the config key
      // Whether THIS session is the read-only demo admin (yourphr#644) — what the header banner
      // reads. Strictly a boolean the UI compares against true; the engine may have no demo manager
      // at all in the contract harnesses, which reads as false, correctly.
      'demo.admin.session': this.engine.has('demo') && this.engine.managers.demo.isDemoAdminSession(ctx),
    };
  }

  /**
   * GET /admin/config in Go's AdminConfigResponse shape (yourphr#602).
   *
   * `admin-system` to VIEW, not only to change (yourphr#751; ngdpbase security-posture D18). The
   * snapshot is how this instance defends itself — sign-in throttle, rate limits, session lifetimes,
   * trusted proxies — and none of that is secret, so the masking below cannot cover it. `admin-read`
   * alone is held by the public demo's read-only tour (#644), which would otherwise publish those
   * values to any visitor. A real admin holds both, so nothing changes for an operator.
   */
  configSnapshot(ctx: ApiContext): { entries: ConfigEntry[]; custom_config_path: string; warnings: string[] } {
    ctx.require('admin-system');
    const config = this.configuration;
    return {
      entries: config.snapshot().map((row) => {
        const shipped = config.shippedValue(row.key)!;
        const secret = config.isSecret(row.key);
        return {
          key: row.key,
          value: row.value,
          masked: row.value === '••••',
          source: row.source === 'custom' ? 'custom' : 'default',
          public: this.publicKeys().includes(row.key),
          // Go's `promoted`: this instance widened `public` beyond the shipped set. Worth surfacing
          // inline, because a startup log line is read approximately never.
          promoted: this.publicKeys().includes(row.key) && !(config.shippedPublicKeys().includes(row.key)),
          // Masked on the same rule as the value, so `reset` cannot reveal what the row hides.
          default: secret && String(shipped) !== '' ? '••••' : shipped,
          from_env: row.source === 'environment',
          env_var: envNameFor(row.key),
        };
      }),
      custom_config_path: config.customConfigPath(),
      warnings: [],
    };
  }

  /** The raw value — a logged, deliberate act, recorded by who asked. Undefined for an unknown key. */
  configReveal(ctx: ApiContext, key: string): { key: string; value: ConfigValue; default: ConfigValue } | undefined {
    ctx.require('admin-system');
    if (!this.configuration.keys().includes(key)) return undefined;
    this.log(`${ctx.actor} revealed configuration value for ${key}`);
    return { key, value: this.configuration.reveal(key), default: this.configuration.shippedValue(key)! };
  }

  /** ApiError 400 unknown key / invalid value, 409 env-pinned. */
  configSet(ctx: ApiContext, key: string, value: unknown): void {
    ctx.require('admin-system');
    const config = this.configuration;
    if (!config.keys().includes(key)) throw new ApiError(400, `unknown configuration key ${JSON.stringify(key)} — only keys this build ships can be set`);
    // Declared env ownership answers 409, whether or not the variable is currently set
    // (yourphr#635): the key belongs to the environment layer, so this screen cannot change it.
    const owner = config.envControlledKeys()[key];
    if (owner !== undefined) {
      throw new ApiError(409, `${key} is owned by the environment variable ${owner} — set it there and restart; this screen cannot change it`);
    }
    if (config.isSetByEnvironment(key)) {
      throw new ApiError(409, `${key} is set by the environment variable ${envNameFor(key)}, which takes precedence over this screen — change it in your deployment configuration instead`);
    }
    let coerced: ConfigValue;
    try {
      coerced = coerceToShippedType(value, this.configuration.shippedValue(key)!);
    } catch (err) {
      throw new ApiError(400, `${key}: ${(err as Error).message}`);
    }
    try {
      config.set(key, coerced);
    } catch (err) {
      throw new ApiError(400, (err as Error).message);
    }
    this.log(`${ctx.actor} set configuration ${key}`);
  }

  /** Removes an override; false when there was none. ApiError 400 for an unknown key. */
  configReset(ctx: ApiContext, key: string): boolean {
    ctx.require('admin-system');
    if (!this.configuration.keys().includes(key)) throw new ApiError(400, `unknown configuration key ${JSON.stringify(key)}`);
    let cleared: boolean;
    try {
      cleared = this.configuration.clear(key);
    } catch (err) {
      throw new ApiError(400, (err as Error).message);
    }
    if (cleared) this.log(`${ctx.actor} reset configuration ${key} to its default`);
    return cleared;
  }

  instanceSettings(ctx: ApiContext): InstanceSettings {
    ctx.require('admin-read');
    const config = this.configuration;
    return {
      name: config.getString('yourphr.operator.name'),
      contact_email: config.getString('yourphr.operator.contact-email'),
      contact_url: config.getString('yourphr.operator.contact-url'),
    };
  }

  /** ApiError 400 when an address is the wrong shape; the values are stored trimmed. */
  setInstanceSettings(ctx: ApiContext, s: InstanceSettings): InstanceSettings {
    ctx.require('admin-system');
    const settings: InstanceSettings = { name: s.name.trim(), contact_email: s.contact_email.trim(), contact_url: s.contact_url.trim() };
    if (settings.contact_email !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(settings.contact_email)) {
      throw new ApiError(400, 'contact_email is not an email address');
    }
    if (settings.contact_url !== '' && !/^https?:\/\//.test(settings.contact_url)) {
      throw new ApiError(400, 'contact_url must start with http:// or https://');
    }
    const config = this.configuration;
    config.set('yourphr.operator.name', settings.name);
    config.set('yourphr.operator.contact-email', settings.contact_email);
    config.set('yourphr.operator.contact-url', settings.contact_url);
    this.log(`${ctx.actor} set the instance settings`);
    return settings;
  }

  /** Nothing of its own: the configuration manager's overlay is what travels. */
  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString() };
  }

  async restore(): Promise<void> { /* the configuration manager restores the overlay */ }
}

/** Go's coerceToShippedType: the stored value keeps the type of the shipped default. */
export function coerceToShippedType(value: unknown, shipped: ConfigValue): ConfigValue {
  if (typeof shipped === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'false') return value === 'true';
    throw new Error('expected true or false');
  }
  if (typeof shipped === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    if (typeof value === 'boolean' || value === '' || !Number.isFinite(n)) throw new Error('expected a number');
    return n;
  }
  if (Array.isArray(shipped)) {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
    throw new Error('expected a list');
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error('expected text');
}
