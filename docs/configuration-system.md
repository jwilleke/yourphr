# Configuration system

__The rule: defaults ship in the binary, an instance overrides them in one file, a deployment may override that with environment variables — and nothing else is configuration.__

Everything below is either that rule, or a gap between it and what exists today. Gaps are marked __GAP__ and each names its issue.

This page describes the mechanism. For *how to configure a deployment*, see [`deployment/README.md`](deployment/README.md).

## Layers

Lowest to highest precedence:

| Layer | Location | Who writes it |
|---|---|---|
| Shipped defaults | `backend/pkg/config/app-default-config.json`, embedded in the binary | developers, in a release |
| Instance overrides | `<data root>/config/app-custom-config.json` | the operator, via Admin → Configuration |
| Environment | `YOURPHR_*` | the deployment |

No config file is read at all. `--config` was removed in [#474](https://github.com/jwilleke/yourphr/issues/474) and passing it is a hard error naming the replacement, rather than a silently ignored flag.

Later layers win. A key absent from a layer falls through to the one below.

> __GAP: the reference deployment still mounts a `config.yaml` ConfigMap.__ The binary no longer ships or reads one, so the mount is inert — but it must be removed from the deployment to finish [#470](https://github.com/jwilleke/yourphr/issues/470). Order matters: the image change had to land *first*, because the ConfigMap was __shadowing__ the image's own `config.yaml`, and removing the mount while that file existed would have revealed `database.encryption.enabled: true` with no key — a crash loop on both instances.

### Why the defaults are embedded

`go:embed`, not a file on disk. A file could be missing, and `/opt/fasten/config` is covered by a ConfigMap mount in the reference deployment, so anything shipped there is invisible at runtime — the Dockerfile's `COPY config.yaml` is already shadowed that way. Embedding means the defaults cannot be absent or shadowed.

### Why the custom file holds only differences

`app-custom-config.json` contains __only what an operator changed__. It never absorbs the defaults.

Writing the merged view instead would freeze today's defaults into the instance: a later release that changed a default would silently not apply, and "what did I change?" would become unanswerable. Keeping it to differences makes that question a `cat`.

## Key format

- __Flat, dotted, lowercase.__ `operator.contact_email`, never a nested `{"operator": {...}}`.
- __Values keep their case__, and may be strings, numbers, booleans, arrays or objects.
- Keys beginning with `_` are comments and are stripped on load.

Flat keys are the decision the rest rests on. With nesting, every object forces a judgement — is this a namespace to descend into, or a value the operator sets whole? The JSON shape cannot tell you: in ngdpbase, `ngdpbase.system-keywords` is an object that *is* a value, while `ngdpbase.server` is a namespace. Identical shape, opposite meaning. Putting the whole path in the key removes the question, and lets a value be an object without ambiguity.

It also matches the environment mapping exactly, for free.

### Environment mapping

`YOURPHR_` + the key uppercased, with `.` and `-` becoming `_`:

```text
operator.contact_email   ->  YOURPHR_OPERATOR_CONTACT_EMAIL
cda_converter.enabled    ->  YOURPHR_CDA_CONVERTER_ENABLED
```

Two unprefixed variables are bound explicitly because they describe how the app is reached from outside the container: `HOST_IP` and `HOST_PORT`.

### Environment references

A value may name a variable instead of containing one:

```json
"jwt.issuer.key": "${YOURPHR_JWT_ISSUER_KEY}",
"database.location": "${DATA_ROOT}/fasten.db"
```

- `$VAR` — __strict__. An unset variable is a startup error naming the key and the variable, because a bare reference asserts the value comes from somewhere.
- `${VAR}` — __lenient__. Resolves to empty when unset, which is what lets the shipped file name a secret without holding one.

This is how `jwt.issuer.key` is expressed. Unset resolves to empty, and empty already means "generate a real key and persist it" — so a stock install is secure with no operator action, and there is no placeholder sentinel to keep in sync.

## What is *not* configuration

Two things live outside this system on purpose.

__Provider catalog entries__ are rows in the database — N providers, each with an endpoint, scopes, branding, `client_id` and `client_secret`. They are created and removed at runtime by an admin, and they are covered by database backups. Credentials in the config file would not survive a restore.

Sandbox and production Blue Button credentials are *provisioned* from `YOURPHR_SANDBOX_*` / `YOURPHR_PROD_BLUEBUTTON_*` at first start. The upsert is provision-only: once an entry has a `client_id`, the seed leaves it alone, so the database owns it thereafter. One-way flow, not a competing source.

__Those variables are deliberately NOT configuration keys__, and must not be added to the catalogue. They are provisioning inputs, consumed once and then ignored — the value in effect afterwards is the one in the catalog row, which an admin may have edited. Cataloguing them would put them on the Admin Configuration screen showing the environment's value while the row held a different one, so the screen would state something untrue. The unknown-key check allowlists them instead, and their provisioning status belongs on Admin → Provider Catalog, beside the row they created ([#471](https://github.com/jwilleke/yourphr/issues/471)).

__Backup state__ — `.backup_settings.json`, `.backup_dest`, `.backup_health.json` — still has its own readers. All three live in the data root, so they are covered by a backup ([`recovery/backup-model.md`](recovery/backup-model.md)).

> __GAP: backup state should fold into the config store__ — [#455](https://github.com/jwilleke/yourphr/issues/455). Deferred because it touches backup and restore, where a mistake loses data.

## Admin → Configuration

`/admin/config`, admin-only. Three tabs: current (merged), your overrides, shipped defaults.

### Where a value came from

Each row reports `default`, `custom`, or `environment`. This is the question the screen exists to answer — a value that quietly fell back to a default is otherwise indistinguishable from one set deliberately, which is what made [#397](https://github.com/jwilleke/yourphr/issues/397) and [#399](https://github.com/jwilleke/yourphr/issues/399) hard to diagnose.

### Keys governed by the environment cannot be edited

Environment outranks the custom store __on restart__. An edit would take effect immediately — viper's `Set` is the top layer — and silently revert on the next boot, when the store is merged beneath the environment.

So such a key shows source `environment`, names its variable, offers no Edit, and a write is refused with `409`. An edit that appears to work and quietly undoes itself is worse than one that is refused.

### Masking

Values named in the `secret` array are masked, and the real value is __not sent to the browser__ — revealing one is a separate request for a single key, logged with the admin who asked. That is the difference between masked and not-sent: with CSS-only masking the value is already in the page for devtools, a screenshot, or any XSS.

`secret` is a short deny-list of five keys. It is deliberately __not__ the inverse of `public`:

| Array | Shape | Because a mistake… |
|---|---|---|
| `public` | allow-list | …exposes a value to anonymous callers on the internet |
| `secret` | deny-list | …shows a value to an already-authenticated admin on their own screen |

Same structure, opposite safe default, because the consequences differ by orders of magnitude. Masking everything outside `public` hid 47 of 51 settings — including the listen port and the log level — which protects nothing and teaches an operator to click reveal without reading.

### Unknown keys are rejected on write

Only keys in the shipped catalogue can be set. A free-form "add any property" form makes a typo permanent: the key sits in the file forever, looks configured, and does nothing.

### Unknown keys are reported on read

At startup the server compares `app-custom-config.json` and every `YOURPHR_*` variable against the catalogue, and logs one warning per key that maps to no setting:

```text
config: "operator.nmae" in /opt/fasten/db/config/app-custom-config.json is not a known setting and has no effect
config: environment variable YOURPHR_WEB_LISTEN_PORT does not map to any known setting and has no effect
```

__Warn, never refuse.__ Refusing on an unknown key would turn a *removed* setting into a boot loop on upgrade — every instance still carrying the old key would fail to start.

Environment variables are compared in their own spelling. `EnvVarFor` is lossy — both `.` and `-` become `_` — so mapping known keys *to* variable names is exact, while inverting is a guess.

The provisioning variables described above are exempt. Flagging them would train an operator to ignore the warning, which is the only real failure mode a warning has.

> __GAP: these findings are logged, not shown.__ A startup line is read approximately never. They belong on Admin → Configuration — [#473](https://github.com/jwilleke/yourphr/issues/473).

## Secrets in code

`config.Secret` is a string that refuses to print itself. It redacts under every format verb and in JSON, so logging a struct cannot leak a value:

```go
logger.Infof("relay config: %+v", cfg)   // the secret prints as [REDACTED]
```

Reading the real value requires `Expose()`, deliberately verbose so `grep -rn '\.Expose()'` lists every place a secret leaves its wrapper.

The internal flag is named `exposeSecrets`, not `redactSecrets`, so the __zero value redacts__ — a flag that leaked unless something remembered to initialise it would be the wrong way round for the mistake this prevents.

`log.redact_secrets` (default `true`) turns it off for debugging, because sometimes the only way to learn why a provider rejects a token is to see the token. The server warns loudly on every start while it is off.

This is leak prevention, __not encryption__: the value is plain in memory and visible to a debugger. It removes a class of accident.

> __GAP: nothing uses the type yet.__ Converting `SourceCredential`'s access and refresh tokens is the highest-value change and touches sync, so it wants its own review.

## Rejected: editing `.env` from the UI

Technically possible — it is a file the process can read and write. Deliberately not done.

Only two variables genuinely need to live in the environment, and they are exactly the two that must not be editable from a UI:

- __`YOURPHR_STORAGE_DATA_DIR`__ — changing it does not move the data. The next start looks in a different directory, finds nothing, and shows the first-run wizard. The records are still on disk, but the instance behaves like a fresh install.
- __`YOURPHR_DATABASE_ENCRYPTION_KEY`__ — writing it to a plaintext file on the same volume as the encrypted database defeats the encryption. The point of that key being external is that it is not beside the thing it locks.

Everything else is already editable in-app, so there is nothing left for such an editor to usefully write.

There is also a mechanical problem: on Kubernetes and Docker Compose the app never reads `.env` — the environment arrives from the pod spec or `env_file:` before the process starts. Writing the file would appear to work and change nothing, which is the accept-then-silently-revert pattern this system has been bitten by three times.

__Reading is already solved, and better than reading the file.__ Admin → Configuration reports `source: environment` and names the variable, showing the *effective* value whatever supplied it. Reading `.env` would show one of four possible sources and mislead about the other three.

## Differences from ngdpbase

The layering, the flat-key format, the comment convention and the environment references are all taken from [jwilleke/ngdpbase](https://github.com/jwilleke/ngdpbase) — read from `src/managers/ConfigurationManager.ts` and `config/app-default-config.json`, not from its docs. Three deliberate divergences:

__No namespace prefix.__ ngdpbase requires `ngdpbase.` or `log4j.`; YourPHR keys are bare (`web.listen.port`). The prefix exists there to separate two configuration systems sharing one file. There is one system here.

__Unknown keys are rejected rather than prefix-validated.__ ngdpbase accepts any name beginning `ngdpbase.` or `log4j.` — enforced in the route layer (`WikiRoutes.ts`), not in `ConfigurationManager`, which accepts anything it is handed. YourPHR checks against the catalogue instead. Stronger, and only possible because the catalogue is complete and a test enforces that.

__No deep merge — yet.__ ngdpbase merges objects recursively and merges arrays by `id`. YourPHR replaces whole values, because no setting currently *has* an object value. Worth adopting when the first one appears; not before, since it is the one part carrying real complexity.

## Guards

Tests that keep the above true rather than aspirational:

| Guard | What it prevents |
|---|---|
| every key read in code exists in the catalogue | a setting silently reading as a zero value |
| every key is lowercase and flat | a mixed-case key that appears to work while resolving elsewhere |
| no `os.Getenv` outside an allowlist | configuration read behind the config layer's back ([#455](https://github.com/jwilleke/yourphr/issues/455)) |
| `/api/instance/public` exposes only the allow-list | a credential reaching an anonymous caller |
| masking covers under a quarter of settings | drifting back to masking everything |
| a `Secret` redacts under every format verb | a careless log line leaking a key |

## Open decisions

| | Issue |
|---|---|
| Retire `config.yaml` | [#470](https://github.com/jwilleke/yourphr/issues/470) — binary done; ConfigMap removal needs a release first. YAML layer and `--config` deleted in [#474](https://github.com/jwilleke/yourphr/issues/474) |
| Warn on unknown keys from the custom file and the environment | __done__ — [#473](https://github.com/jwilleke/yourphr/issues/473) for surfacing them in the UI |
| Fold backup state into the store | [#455](https://github.com/jwilleke/yourphr/issues/455) |
| Move ordinary settings out of environment on the reference deployment, leaving bootstrap and secrets | [#472](https://github.com/jwilleke/yourphr/issues/472) |

On the last one, the win is smaller than it first appears. Of the five non-secret, non-bootstrap variables the reference deployment passes, three are __topology__ — cluster-internal DNS and "is a sidecar present" — which belong with the deployment that defines that cluster, whatever layer they sit in. Only `backup.label` and `medications.rxterms_enrich` are settings in the ordinary sense.

That blocker is now cleared: [#467](https://github.com/jwilleke/yourphr/issues/467) shipped in v2.1.0, so `app-custom-config.json` __is__ covered by backups. Moving a value out of a versioned Git repo and into the config store no longer trades *recoverable* for *lost with the disk*.

It does change what recovery depends on, though. A value in Git is recovered by cloning the repo; a value in the config store is recovered only by a backup that was taken and can actually be restored — see [`recovery/data-recovery.md`](recovery/data-recovery.md).
