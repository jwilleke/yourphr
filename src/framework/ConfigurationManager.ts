/**
 * Configuration as a manager (yourphr#608, #609; reshaped by yourphr#621) — first in every boot
 * order, because everything else reads it.
 *
 * This manager owns the POLICY: the three layers and their precedence, the merge, the catalogue of
 * what each key means, and the refusals (unknown key, bootstrap key, env-pinned key). A
 * `BaseConfigProvider` behind it owns only the STORAGE — fetch the two layers, persist the
 * overrides. That split is deliberate: a provider that could implement its own precedence is a
 * provider that could get it wrong, and "which layer wins" must not vary by where the bytes live.
 *
 * THE BOOTSTRAP EXCEPTION, stated rather than assumed: every other capability in this stack is
 * selected BY configuration (`yourphr.audit.provider`, `yourphr.backup.storage.provider`). This one cannot be —
 * it is what reads configuration. Its provider is chosen by the composition root, from the same
 * place the data directory and the database key already come from. Ratified 2026-08-23.
 *
 * backup() carries the overrides (what the operator changed), never the environment — secrets and
 * bootstrap values are the deployment's, not the backup's.
 */
import { BaseManager, type BackupData } from './BaseManager.js';
import type { Engine } from './Engine.js';
import type { BaseConfigProvider } from './providers/BaseConfigProvider.js';

import { envNameFor, legacyEnvNameFor, unprefixedEnvNameFor, isConfigObject, PUBLIC_KEYS_KEY, type ConfigObject, type ConfigValue } from '../config/index.js';
import { appLog } from '../log/index.js';
import { coerceToTypeOf, describePropertySource, ENV_KEYS_CONFIG_KEY, FALLBACK_ENV_KEYS, SECRET_KEYS_CONFIG_KEY, type EnvKeyMap, type PropertyDescription } from '../config/env-keys.js';

declare module './Engine.js' {
  interface ManagerRegistry {
    configuration: ConfigurationManager;
  }
}

/** One row of the admin view: the effective value (secrets masked) and which layer it came from. */
export interface ConfigRow {
  key: string;
  value: ConfigValue | '••••';
  source: 'environment' | 'custom' | 'default';
}

export interface ConfigurationOptions {
  /** The environment layer. Injectable so a test need not mutate the process. */
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
}

/**
 * Levenshtein edit distance — the substitutions, insertions and deletions between two strings.
 *
 * Used only for did-you-mean suggestions (yourphr#625), never for a decision: a wrong answer here
 * costs a slightly odd hint, so the straightforward full-matrix implementation is the right one.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // One row at a time: the matrix is only ever read one row back.
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] as number) + 1, (current[j - 1] as number) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] as number;
}

export class ConfigurationManager extends BaseManager {
  readonly name = 'configuration' as const;

  private readonly env: Record<string, string | undefined>;
  private readonly log: (line: string) => void;

  /** The shipped values, this instance's overrides, and the two merged — ngdpbase's three views. */
  private defaults: Record<string, ConfigValue> = {};
  private custom: Record<string, ConfigValue> = {};
  private merged: Record<string, ConfigValue> = {};
  private customUnreadable: string | undefined;
  private roots: Record<string, string> = {};

  constructor(engine: Engine, private readonly provider: BaseConfigProvider, options: ConfigurationOptions = {}) {
    super(engine);
    this.env = options.env ?? process.env;
    this.log = options.log ?? (() => undefined);
    this.reload();
  }

  /**
   * Read both layers and merge. Called from the constructor because the composition root needs
   * configuration before the engine initialises anything — the bootstrap exception in practice.
   */
  reload(): void {
    const loaded = this.provider.load();
    this.defaults = loaded.defaults;
    this.custom = loaded.custom;
    this.customUnreadable = loaded.customUnreadable;
    this.merged = deepMerge(this.defaults, this.custom);
    // A real environment variable always wins; the provider's roots are the floor, so a template
    // resolves against the root actually in use even when nothing in the environment names it.
    this.roots = { ...this.provider.roots() };
  }

  /** Every key this build understands: the shipped file IS the list (yourphr#629). */
  private known(key: string): boolean {
    return key in this.defaults;
  }

  /** Keys masked on the admin screen until revealed — Go's deny-list, read as data. */
  private secretKeys(): string[] {
    const raw = this.merged[SECRET_KEYS_CONFIG_KEY];
    return Array.isArray(raw) ? raw.map(String) : [];
  }

  override async initialize(config: Record<string, unknown> = {}): Promise<void> {
    await super.initialize(config);
    const overridden = Object.keys(this.custom).length;
    this.log(`configuration: ${Object.keys(this.defaults).length} keys from the '${this.provider.name}' provider${overridden ? `, ${overridden} overridden by this instance` : ''}`);
    if (this.customUnreadable) this.log(`configuration: overrides could not be read and are being ignored, not overwritten — ${this.customUnreadable}`);
    // Resolve every key once at boot so a missing REQUIRED secret refuses here, naming itself,
    // rather than at the first request that happens to read it (yourphr#622).
    for (const key of Object.keys(this.defaults)) this.raw(key);
    if (this.envRefHits || this.envRefBraceMisses) {
      this.log(`configuration: ${this.envRefHits} environment reference(s) resolved` +
        (this.envRefBraceMisses ? `, ${this.envRefBraceMisses} left unresolved (embedded form — they fail at point of use)` : ''));
    }
  }

  // --- reading ---------------------------------------------------------------------------------

  private raw(key: string): ConfigValue {
    return this.resolveEnvRef(this.configured(key), key);
  }

  /** The value the layers select, BEFORE environment references are resolved. */
  private configured(key: string): ConfigValue {
    if (!this.known(key)) throw new Error(`unknown configuration key: ${key}`);
    const shipped = this.defaults[key] ?? null;
    // A DECLARED env-owned key reads from its variable (yourphr#635). An empty value is an
    // operator clearing the variable, not blanking the setting — handled in describePropertySource.
    const envVar = this.envKeyMap()[key];
    if (envVar !== undefined) {
      // The declared variable first, then the pre-yourphr#627 SPIKE_ name. That fallback lived
      // only on the branch below until this line existed, and yourphr#635 moved the encryption
      // keys onto THIS branch — so a deployment still setting SPIKE_DATABASE_ENCRYPTION_KEY
      // opened an encrypted database with an empty key and died with SQLITE_NOTADB. Found by
      // deploying v0.2.0, not by any test: every test sets the new names.
      const raw = this.envValue(envVar) ?? this.legacyEnvValue(key);
      if (raw !== undefined && raw !== '') return coerceToTypeOf(raw, shipped);
      return shipped as ConfigValue;   // the shipped value is this key's boot fallback
    }
    const fromEnv = this.envValue(envNameFor(key)) ?? this.legacyEnvValue(key) ?? this.unprefixedEnvValue(key);
    if (fromEnv !== undefined) return coerceFromEnv(fromEnv, this.defaults[key], key);
    if (key in this.custom) return this.merged[key] as ConfigValue;
    return this.defaults[key] as ConfigValue;
  }

  /** Which keys the environment owns, and the variable supplying each (yourphr#635). */
  private envKeyMap(): EnvKeyMap {
    const raw = this.merged[ENV_KEYS_CONFIG_KEY];
    if (isConfigObject(raw)) return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
    // Config declares none — fall back rather than silently dropping every override, including the
    // at-rest database key. See FALLBACK_ENV_KEYS.
    return FALLBACK_ENV_KEYS;
  }

  /** The declared map, for the admin screen. */
  envControlledKeys(): EnvKeyMap { return { ...this.envKeyMap() }; }

  /**
   * Where a key's value actually comes from (yourphr#635). The admin screen needs three facts
   * `getString()` alone cannot express: the effective value, whether the environment owns the key,
   * and which variable does.
   */
  describeProperty(key: string): PropertyDescription {
    const configValue = (this.merged[key] ?? null) as ConfigValue | null;
    const described = describePropertySource(key, this.envKeyMap(), this.env, configValue);
    if (described.source === 'config') {
      try {
        return { ...described, effective: this.resolveEnvRef(described.effective as ConfigValue, key) };
      } catch {
        // A bare ref to an unset variable throws by design. The screen should show the value as
        // unresolvable, not fail to render.
        return { ...described, effective: null };
      }
    }
    return described;
  }

  /**
   * Environment references (yourphr#622), ngdpbase's `resolveEnvRef` (#775) carried with its three
   * forms and — the part that matters — its deliberately DIFFERENT strictness between them:
   *
   *   `$$literal`  escape, for a value that genuinely starts with `$`. Checked FIRST, or `$$VAR`
   *                reads as a malformed bare reference.
   *   `$VAR`       the WHOLE value is one variable. STRICT: an unset variable throws, naming both
   *                the variable and the key that wanted it. This is the form for secrets — an
   *                operator who wrote it meant it, and silently falling back to a shipped empty
   *                string is how an instance ends up serving with its cipher key missing.
   *   `${VAR}`     embedded, for path templates. SILENT on a miss: the placeholder is left intact
   *                and fails at point of use, where the message names the actual path.
   *
   * Resolved at LOOKUP time, not load time, so a test that changes the environment mid-run sees it.
   */
  private resolveEnvRef(value: ConfigValue, key: string): ConfigValue {
    if (typeof value !== 'string') return value;
    if (value.startsWith('$$')) return value.slice(1);
    const bare = /^\$([A-Z_][A-Z0-9_]*)$/.exec(value);
    if (bare) {
      const name = bare[1]!;
      const found = this.envValue(name);
      if (found !== undefined) {
        this.envRefHits++;
        return found;
      }
      this.envRefMisses++;
      throw new Error(`configuration: ${key} is set to the environment variable ${name}, which is unset — add ${name}=... to the deployment (a .env file, a Kubernetes Secret) and restart`);
    }
    if (value.includes('${')) {
      return value.replace(/\$\{([^}]+)\}/g, (match, name: string) => {
        const found = this.envValue(name);
        if (found === undefined) {
          this.envRefBraceMisses++;
          return match; // left intact on purpose: it fails at point of use, where the path is visible
        }
        this.envRefHits++;
        return found;
      });
    }
    return value;
  }

  /** Counters for the boot summary — an instance says how many references resolved. */
  private envRefHits = 0;
  private envRefMisses = 0;
  private envRefBraceMisses = 0;

  /** Is this key's configured value a whole-value environment reference — i.e. does it hold a secret? */
  isEnvReference(key: string): boolean {
    const value = this.configured(key);
    return typeof value === 'string' && !value.startsWith('$$') && /^\$[A-Z_][A-Z0-9_]*$/.test(value);
  }

  /**
   * The value with secrets masked, for anything that prints configuration — boot banners, the
   * admin listing, a debug dump. Masking is STRUCTURAL: it follows from the value being an
   * environment reference, so a newly referenced secret is masked without anyone remembering to
   * flag it. The catalogue's `secret` marker still covers values secret without being referenced.
   */
  maskedValue(key: string): ConfigValue | '••••' {
    if (this.isEnvReference(key)) return '••••';
    const value = this.raw(key);
    // Go's deny-list, read as data rather than compiled (yourphr#629): masking a value an admin
    // could otherwise read on their own screen. Deliberately short — masking everything outside
    // `public` trains an operator to click reveal without reading.
    return this.secretKeys().includes(key) && String(value) !== '' ? '••••' : value;
  }

  getString(key: string): string { return String(this.raw(key)); }
  getInt(key: string): number { return Number(this.raw(key)); }
  getBool(key: string): boolean { return this.raw(key) === true; }
  getStringList(key: string): string[] {
    const value = this.raw(key);
    if (Array.isArray(value)) return value.map(String);
    return String(value).split(',').map((v) => v.trim()).filter(Boolean);
  }

  /** A structured setting, merged per entry. */
  getObject(key: string): ConfigObject {
    const value = this.raw(key);
    if (!isConfigObject(value)) throw new Error(`configuration key ${key} is not a structured setting`);
    return value;
  }

  /** The raw value of a secret — a logged, deliberate act; the caller names who asked. */
  reveal(key: string): ConfigValue { return this.raw(key); }

  /**
   * The SHIPPED value, ignoring this instance's overrides — ngdpbase's `getDefaultProperty()`,
   * which exists because an instance whose overrides carried a whole-catalogue snapshot shadowed
   * every entry shipped afterwards (its #895). Needed rarely; when it is needed, nothing else does.
   */
  shippedValue(key: string): ConfigValue | undefined { return this.defaults[key]; }

  /** Only what this instance changed — the admin screen's "customised" view. */
  customValues(): Record<string, ConfigValue> { return { ...this.custom }; }

  isSetByEnvironment(key: string): boolean {
    return this.envValue(envNameFor(key)) !== undefined || this.legacyEnvValue(key) !== undefined || this.unprefixedEnvValue(key) !== undefined;
  }

  /** The environment as this manager sees it: the real one, over the provider's roots. */
  private envValue(name: string): string | undefined {
    return this.env[name] ?? this.roots[name];
  }

  /** A pre-yourphr#627 `SPIKE_*` variable, warned about once so an operator knows to move it. */
  private legacyEnvValue(key: string): string | undefined {
    const legacy = legacyEnvNameFor(key);
    if (legacy === undefined) return undefined;
    const value = this.env[legacy];
    if (value !== undefined && !this.warnedLegacy.has(legacy)) {
      this.warnedLegacy.add(legacy);
      this.log(`configuration: ${legacy} is the old name for ${envNameFor(key)} and still works — update the deployment before the cut-over (yourphr#588)`);
    }
    return value;
  }

  /** `HOST_IP` / `HOST_PORT` — documented unprefixed aliases, empty means unset. */
  private unprefixedEnvValue(key: string): string | undefined {
    const name = unprefixedEnvNameFor(key);
    if (name === undefined) return undefined;
    const value = this.envValue(name);
    if (value === undefined || value === '') return undefined;
    return value;
  }

  /** The variable actually supplying this key, for refused-write messages. */
  private environmentNameSet(key: string): string {
    if (this.envValue(envNameFor(key)) !== undefined) return envNameFor(key);
    const legacy = legacyEnvNameFor(key);
    if (legacy !== undefined && this.env[legacy] !== undefined) return legacy;
    return unprefixedEnvNameFor(key) ?? envNameFor(key);
  }

  private readonly warnedLegacy = new Set<string>();
  customConfigPath(): string { return this.provider.customLocation(); }

  /**
   * Override keys this build does not define — reported, never silently dropped (yourphr#473).
   * The shipped file is the list, so no second structure is needed to detect one.
   */
  unknownKeys(): string[] {
    if (this.customUnreadable) return [`<unreadable: ${this.provider.customLocation()}>`];
    return Object.keys(this.custom).filter((k) => !this.known(k));
  }

  /**
   * The unknown keys, each with a did-you-mean when one is close enough (yourphr#625).
   *
   * `unknownKeys()` answers WHICH keys have no effect; this answers what the operator should do
   * about it, which is the whole value of yourphr#473's report. "keys with no effect:
   * yourphr.sync.max-pgaes" and "... did you mean yourphr.sync.max-pages?" are the difference
   * between finding it in seconds and filing a bug that the setting does not work.
   *
   * Ported from ngdpbase's `findClosestAddonName` (its #672), including its threshold and its
   * reason for having one: a suggestion is offered only within edit distance 2, so a genuinely
   * unknown key gets no neighbour rather than a misleading one. On long dotted keys that is a
   * tight bound by construction — a typo matches, a key naming a different thing does not.
   */
  unknownKeyReport(): string[] {
    return this.unknownKeys().map((key) => {
      const guess = this.closestKnownKey(key);
      return guess ? `${key} (did you mean ${guess}?)` : key;
    });
  }

  /** The nearest key this build defines, within edit distance 2, or undefined. */
  private closestKnownKey(input: string): string | undefined {
    let best: string | undefined;
    // Exclusive bound: 3 means "accept 2 or better", matching ngdpbase.
    let bestDistance = 3;
    for (const candidate of this.keys()) {
      const d = editDistance(input, candidate);
      if (d < bestDistance) {
        best = candidate;
        bestDistance = d;
      }
    }
    return best;
  }

  /** Every key this build defines, for the admin screen and the drift checks. */
  keys(): string[] { return Object.keys(this.defaults); }

  /** The SHIPPED allow-list, so the admin screen can say which entries this instance added. */
  shippedPublicKeys(): string[] {
    const raw = this.defaults[PUBLIC_KEYS_KEY];
    return Array.isArray(raw) ? raw.map(String) : [];
  }

  /** Is this key masked on the admin screen? Go's `secret` deny-list. */
  isSecret(key: string): boolean { return this.secretKeys().includes(key); }

  /** The admin view: every known key, its effective value (secrets masked), and its source. */
  snapshot(): ConfigRow[] {
    return Object.keys(this.defaults).map((key) => {
      const source = this.isSetByEnvironment(key) ? 'environment' : key in this.custom ? 'custom' : 'default';
      return { key, value: this.maskedValue(key), source };
    });
  }

  // --- writing ---------------------------------------------------------------------------------

  set(key: string, value: ConfigValue): void {
    if (!this.known(key)) throw new Error(`unknown configuration key: ${key}`);
    // Declared ownership, NOT "is the variable set right now" (yourphr#635): an env-owned key is
    // read-only either way, or the same key is editable on one instance and refused on another.
    const owner = this.envKeyMap()[key];
    if (owner !== undefined) throw new Error(`${key} is owned by the environment variable ${owner} — set it there and restart; this screen cannot change it`);
    if (this.isSetByEnvironment(key)) throw new Error(`${key} is set in the environment (${this.environmentNameSet(key)}); remove the variable to manage it here`);
    if (this.customUnreadable) throw new Error(`${this.provider.customLocation()} exists but cannot be parsed — refusing to overwrite it`);
    // Writing a literal over an environment reference would move a secret out of the deployment
    // and into a file on disk — silently, and from a screen that was only showing '••••'.
    if (this.isEnvReference(key) && !(typeof value === 'string' && value.startsWith('$'))) {
      throw new Error(`${key} is set to an environment variable; writing a literal here would copy a secret out of the deployment and into ${this.provider.customLocation()}`);
    }
    this.custom[key] = value;
    this.merged = deepMerge(this.defaults, this.custom);
    this.provider.saveCustom(this.custom);
  }

  /** Removes an override so the key reads its shipped value again. False when there was none. */
  clear(key: string): boolean {
    if (!this.known(key)) throw new Error(`unknown configuration key: ${key}`);
    if (this.customUnreadable) throw new Error(`${this.provider.customLocation()} exists but cannot be parsed — refusing to overwrite it`);
    if (!(key in this.custom)) return false;
    delete this.custom[key];
    this.merged = deepMerge(this.defaults, this.custom);
    this.provider.saveCustom(this.custom);
    return true;
  }

  /** Every override dropped; the instance follows the product again. */
  resetToDefaults(): void {
    this.custom = {};
    this.merged = { ...this.defaults };
    this.provider.saveCustom(this.custom);
  }

  async backup(): Promise<BackupData> {
    return { manager: this.name, takenAt: new Date().toISOString(), payload: this.customValues() };
  }

  /**
   * The overrides from a backup REPLACE this instance's (yourphr#631), as ngdpbase's restore replaces
   * its customConfig: a restore returns the instance to the backup's settings, not a blend. Keys this
   * version does not know are dropped; the environment is never touched.
   */
  async restore(data: BackupData): Promise<void> {
    this.custom = {};
    for (const [key, value] of Object.entries((data.payload ?? {}) as Record<string, ConfigValue>)) {
      if (this.known(key)) this.custom[key] = value;
    }
    this.merged = deepMerge(this.defaults, this.custom);
    this.provider.saveCustom(this.custom);
  }
}

/** SPIKE_X=... is text; the shipped value's type says what it must become. */
function coerceFromEnv(fromEnv: string, shipped: ConfigValue | undefined, key: string): ConfigValue {
  if (typeof shipped === 'number') return Number(fromEnv);
  if (typeof shipped === 'boolean') return fromEnv === 'true' || fromEnv === '1';
  if (Array.isArray(shipped)) return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  if (isConfigObject(shipped)) {
    // Unparseable is an ERROR, not a silent fall back: an operator who set the variable meant it
    // to apply, and configuration that quietly reverts is the failure this area exists to prevent.
    try {
      const parsed: unknown = JSON.parse(fromEnv);
      if (!isConfigObject(parsed)) throw new Error('expected a JSON object');
      return parsed;
    } catch (err) {
      throw new Error(`${envNameFor(key)} must be a JSON object: ${(err as Error).message}`);
    }
  }
  return fromEnv;
}

/**
 * ngdpbase's merge (`ConfigurationManager.ts:488`), carried as-is: objects merge per key, arrays of
 * `{id, …}` merge BY ID (an override replaces the matching entry and adds new ones), and any other
 * array is replaced wholesale. Per-entry merging is what stops one overridden entry from freezing
 * the rest of a structured setting against everything shipped later.
 */
export function deepMerge(defaults: Record<string, ConfigValue>, custom: Record<string, ConfigValue>): Record<string, ConfigValue> {
  const result: Record<string, ConfigValue> = { ...defaults };
  for (const [key, customValue] of Object.entries(custom)) {
    const defaultValue = result[key];
    if (customValue === undefined) continue;
    if (Array.isArray(customValue) && Array.isArray(defaultValue)) result[key] = mergeArrays(defaultValue, customValue);
    else if (isConfigObject(customValue) && isConfigObject(defaultValue)) result[key] = deepMerge(defaultValue, customValue) as ConfigObject;
    else result[key] = customValue;
  }
  return result;
}

function mergeArrays(defaults: ConfigValue[], custom: ConfigValue[]): ConfigValue[] {
  const hasIds = (a: ConfigValue[]): boolean => a.length > 0 && isConfigObject(a[0]) && 'id' in (a[0] as ConfigObject);
  if (hasIds(defaults) && hasIds(custom)) {
    const merged = new Map<unknown, ConfigValue>();
    for (const item of [...defaults, ...custom]) merged.set((item as ConfigObject)['id'], item);
    return Array.from(merged.values());
  }
  return custom;
}

/**
 * A number from configuration, or the fallback when it is not a usable one — ngdpbase's
 * `boundedNumber` (its #1110), kept by that name because it is the same decision.
 *
 * `min` is where the MEANING of the setting goes, and the reason it is a parameter rather than a
 * blanket `> 0`: an interval or a TTL has no meaningful zero (a zero TTL mints a credential that
 * is already expired), while a count or a retention window does — `retention-days: 0` means purge
 * a record as soon as it is dead, and `max-per-user: 0` means allow none. ngdpbase rejected both
 * of those, told the operator their deliberate value "is not a positive number", and used the
 * default instead (yourphr#698 item 2).
 *
 * The fallback is never silent. `Number('24h')` is NaN and `ttl > NaN` is false, so a single typo
 * used to remove a ceiling with nothing said; a limit a typo can disable is not a limit.
 */
export function boundedNumber(value: unknown, fallback: number, key: string, min: number, warn: (line: string) => void = (line) => appLog.warn(line)): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) {
    // JSON.stringify rather than String: a config value may be an object, and "[object Object]"
    // is not something an operator can diagnose a typo from.
    if (value !== undefined && value !== null) warn(`${key}=${JSON.stringify(value)} is not a number >= ${min} — using ${fallback}`);
    return fallback;
  }
  return Math.trunc(n);
}
