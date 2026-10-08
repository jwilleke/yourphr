/**
 * The configuration vocabulary (yourphr#542, reshaped by yourphr#621, #629).
 *
 * There is no catalogue here any more. ngdpbase holds 579 keys as flat values with `_comment_*`
 * siblings for documentation and NO per-key metadata structure; Go's admin `ConfigEntry` carries no
 * description field either. The compiled `ConfigCatalog` was ours alone, and it cost what a second
 * list always costs: two edits per key, a boot check to keep the halves agreeing, and — the one
 * that mattered — metadata an operator could not see. Somebody sets a key, nothing happens, and the
 * reason is a flag compiled into `dist/`. That is the failure yourphr#473 exists to prevent, one
 * level up: on the metadata instead of the key.
 *
 * What a key means now lives where its value lives — `config/app-default-config.json`, which ships
 * with the release. Two lists in that file carry the only behaviour that is not simply a value, and
 * both are Go's, by name, by shape and by reasoning:
 *
 *   yourphr.public   an ALLOW-list — a mistake exposes a value to the internet
 *   yourphr.secret   a DENY-list  — a mistake shows a value to an already-authenticated admin
 *
 * The rules the layers serve, each with its reason:
 *
 *   - Three layers, strict precedence: environment > instance overrides > shipped defaults. The
 *     environment carries bootstrap and secrets only; everything else is a setting.
 *   - The overrides hold only what the operator changed — never the merged view. Writing the merged
 *     view would freeze today's defaults into the instance forever, so a later release that changed
 *     a default would silently not apply. ngdpbase shipped that bug (its #895).
 *   - A key pinned by the environment is READ-ONLY to set(): env wins at read time, so accepting
 *     the write would store a value that never applies. Go's config screen answers 409 likewise.
 *   - Unknown override keys are REPORTED, never silently carried or dropped (yourphr#473). The
 *     shipped file IS the list of known keys, so nothing extra is needed to detect one.
 */

/**
 * A structured setting — a JSON object whose leaves are ordinary values. ngdpbase carries its
 * permission registry and role definitions this way, and the merge handles one PER ENTRY rather
 * than whole-value, so overriding one entry does not freeze the rest against everything shipped
 * afterwards.
 */
export type ConfigObject = { [key: string]: ConfigValue };

export type ConfigValue = string | number | boolean | ConfigValue[] | ConfigObject;

/** A plain object, not an array and not null — ngdpbase's `isPlainObject`. */
export function isConfigObject(value: unknown): value is ConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The allow-list of keys an anonymous caller may read (yourphr#457). ngdpbase has no equivalent —
 * it publishes nothing to anonymous callers — so this one is the Go stack's, kept because the
 * Angular app depends on the endpoint.
 */
export const PUBLIC_KEYS_KEY = 'yourphr.public';

// The env-owned and secret key lists live in ./env-keys.js, ported from ngdpbase's
// src/utils/configEnvKeys.ts (yourphr#635).

/**
 * `yourphr.auth.session.sliding-seconds` -> `YOURPHR_AUTH_SESSION_SLIDING_SECONDS`. The key carries
 * its own `yourphr.` prefix (yourphr#627), so the environment name derives from the key alone
 * rather than gluing a second prefix in front of it.
 *
 * NOT injective on its own: both `.` and `-` collapse to `_`, so `a.b-c` and `a-b.c` produce the
 * same name. The shipped keys are checked for collisions by the framework harness, not trusted.
 */
export function envNameFor(key: string): string {
  return key.toUpperCase().replace(/[.-]/g, '_');
}

/**
 * The name this key had before yourphr#627, for instances still setting it. The deployed manifests
 * carry `SPIKE_*` — including two SOPS-encrypted secrets whose variable names are inside the
 * encrypted payload — so a hard rename would crash-loop a running pod on a key it cannot read.
 * Read the new name first, accept the old one with a warning, and drop this at the cut-over
 * (yourphr#588) once the manifests are updated.
 */
export function legacyEnvNameFor(key: string): string | undefined {
  const withoutPrefix = key.startsWith('yourphr.') ? key.slice('yourphr.'.length) : undefined;
  return withoutPrefix === undefined ? undefined : 'SPIKE_' + withoutPrefix.toUpperCase().replace(/[.-]/g, '_');
}
