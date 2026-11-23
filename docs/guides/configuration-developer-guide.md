---
name: Configuration developer guide
description: How to add or read a configuration key — one reader, three layers, the shipped file is the list of keys, environment-owned keys and secrets
dateModified: 2026-11-23
category: guides
relatedModules: [ConfigurationManager, FileConfigProvider, SettingsManager, env-keys]
---

# Configuration developer guide

How to add or change a configuration key. Configuration selects and parameterises; it never expresses logic.

## Standing rules

- Read configuration only through `ConfigurationManager` (`engine.managers.configuration`): `getString`, `getInt`, `getBool`, `getStringList`, `getObject`. Asking for a key the shipped file does not declare throws `unknown configuration key`. Do not open the JSON files from application code.
- Every key is declared, with its default, in `config/app-default-config.json`. That file __is__ the list of keys this build understands; there is no second catalogue in code. Document a key that is not obvious with a `_comment_*` sibling: keys starting `_` are stripped on load (`FileConfigProvider`).
- Keys are flat, lowercase and prefixed: `yourphr.{area}.{property}`, for example `yourphr.auth.session.sliding-seconds`.
- Three layers, highest first: the environment; the instance's overrides in `<data>/config/app-custom-config.json`; the shipped defaults. The overrides file holds __only__ what an operator changed, never the merged view.
- Merge: a JSON object merges per entry; an array of objects that all carry `id` merges by `id`; any other array replaces the shipped one wholesale (`deepMerge` in `src/framework/ConfigurationManager.ts`).
- The environment variable for a key is derived from it: `envNameFor('yourphr.auth.session.sliding-seconds')` is `YOURPHR_AUTH_SESSION_SLIDING_SECONDS` (`src/config/index.ts`). A value from the environment is coerced to the shipped value's type: numbers, `true`/`1` for booleans, comma-separated lists for arrays, and JSON for objects (an unparseable object is an error, not a fallback). The pre-[#627](https://github.com/jwilleke/yourphr/issues/627) `SPIKE_*` names are still read as a fallback.
- `YOURPHR_FAST_STORAGE` and `YOURPHR_SLOW_STORAGE` are not keys. They locate the data, and so the configuration; values use them as `${YOURPHR_FAST_STORAGE}/records.db`.
- Values can reference the environment (`resolveEnvRef`): `$VAR` is the whole value and throws when the variable is unset (use it for secrets); `${VAR}` is embedded and left intact when unset (use it for paths); `$$` escapes a literal `$`.
- `yourphr.config.env-keys` maps the keys the __environment owns__ to their variables (the encryption keys, the session secret, the credentials key, the relay secret, the listen host and port, secure cookies, the static directory). They are read-only on Admin → Configuration whether or not the variable is set; a write answers 409. If that map is missing, `FALLBACK_ENV_KEYS` in `src/config/env-keys.ts` applies. Any other key still honours its variable when one is set, and a write to it while the variable is set also answers 409.
- `yourphr.config.secret-keys` lists the keys masked on the admin screen until an admin with `admin-system` reveals one; the reveal is logged. The same list drives log redaction: `refreshRedactedSecrets` strikes those values from every log line (`src/log/redact.ts`).
- `yourphr.public` is an __allow-list__ of the keys `GET /api/instance/public` gives to anonymous callers. Adding a key anywhere else never publishes it.
- Unknown keys in the overrides file are reported at boot (`config: keys with no effect: …`, with a did-you-mean), never silently used or dropped.
- Permissions and roles are configuration too (`yourphr.auth.permissions.definitions`, `yourphr.auth.roles.definitions`). See [security-developer-guide.md](security-developer-guide.md#permissions-and-roles).

## How to add a key

1. Add it to `config/app-default-config.json` with its default, and a `_comment_<name>` line naming the issue and what the value means.
2. Read it where it is used with the typed getter. For a number that has a meaningful range, use `boundedNumber` (exported from `src/framework/ConfigurationManager.ts`) rather than trusting the value.
3. A secret: add it to `yourphr.config.secret-keys`, and to `yourphr.config.env-keys` if it must come from the environment. A key an anonymous caller needs: add it to `yourphr.public`.
4. A key that selects a provider: see [managers-developer-guide.md](managers-developer-guide.md#how-to-add-a-provider).

## Where an operator edits it

Admin → Configuration calls `SettingsManager` through `/api/secure/admin/config`:

| Method and path | Permission | What it does |
| --- | --- | --- |
| `GET /api/secure/admin/config` | `admin-system` | Every key, its effective value (secrets masked) and the layer it came from |
| `PUT /api/secure/admin/config` with `{ "key", "value" }` | `admin-system` | Writes an override. 400 for an unknown key or a value of the wrong type, 409 for an environment-owned or environment-set key |
| `DELETE /api/secure/admin/config/:key` | `admin-system` | Removes the override, so the shipped default applies again |
| `GET /api/secure/admin/config/reveal/:key` | `admin-system` | One secret's value, logged |

## How you know you are done

- `npm run config` (the configuration harness) and `npm run env` pass, and `npm run framework` passes (it checks the shipped keys for environment-name collisions).
- `ConfigurationManager.test.ts` covers a new rule; a new key needs no test of its own unless code branches on it.

## See also

- [architecture/configuration-system.md](../architecture/configuration-system.md): the design and its reasons (but see Known gaps)
- [getting-started-developer-guide.md](getting-started-developer-guide.md): `.env` files and their precedence
- [deployment/README.md](../deployment/README.md): what an operator sets

## Known gaps

- The shipped defaults are read from `config/app-default-config.json` under the __working directory__ (`FileConfigProvider`'s default path is `process.cwd()`), so the server must be started from the repository root (the image sets `WORKDIR /opt/yourphr` and copies `config/` there).
- [architecture/configuration-system.md](../architecture/configuration-system.md) still describes the Go implementation in its *Layers*, *Why the defaults are embedded* and *Guards* sections: `backend/pkg/config/app-default-config.json`, `go:embed`, `os.Getenv`, and keys such as `backup.label` and `medications.rxterms_enrich` that do not exist. The TypeScript server reads the file from disk as above.
- A comment in `src/config/index.ts` names the deny-list `yourphr.secret`; the key is `yourphr.config.secret-keys`.
