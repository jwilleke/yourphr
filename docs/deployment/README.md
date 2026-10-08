# Deployment & configuration

YourPHR is __deployment-agnostic__. It is a single Go binary that serves the compiled Angular app and stores everything in an embedded __SQLite__ database — __no required external services__. Run it however suits you: `docker compose`, a plain `docker run`, a bare-metal binary, or Kubernetes. The same configuration interface works for all of them, so nothing here depends on any particular orchestrator (the maintainer's instance happens to use Flux/GitOps in a separate repo — that is *one option*, not a requirement).

The published image is __public and multi-arch__: `ghcr.io/jwilleke/yourphr` (tags `:main`, `:main-<run#>`, and release tags like `:v1.2.0`).

__Architectures: `linux/amd64` and `linux/arm64`__ — so Apple Silicon Macs, Raspberry Pi 5, and Ampere/Graviton ARM VPS hosts all pull natively, with no `--platform` flag and no emulation. Same for `ghcr.io/jwilleke/yourphr-relay` and `ghcr.io/jwilleke/yourphr-cda-converter`.

> __arm64 arrived with [#405](https://github.com/jwilleke/yourphr/issues/405); releases up to and including `v1.15.1` are amd64-only__ and fail to pull on arm64 with `no matching manifest for linux/arm64/v8`. If you are pinned to one of those tags, move to `:latest` — or, to stay put, force emulation with `docker pull --platform linux/amd64 ghcr.io/jwilleke/yourphr:<tag>` (works, but slow).

To see exactly which architectures a given tag ships:

```bash
docker buildx imagetools inspect ghcr.io/jwilleke/yourphr:latest
```

> __This page is the lead deployment doc.__ Start here for how to run YourPHR and how it is configured; the deeper, topic-specific guides are linked from [Deployment docs](#deployment-docs) below and the [See also](#see-also) at the end.

## Deployment docs

This page covers running and configuring an instance. The rest of the deployment-related docs:

| Doc | What it covers |
|---|---|
| [Deployment options](#deployment-options) (this page) | `docker run`, bare metal, Kubernetes/GitOps — all from the same `YOURPHR_*` config interface. A worked compose file is [#641](https://github.com/jwilleke/yourphr/issues/641). |
| [Configuration model](#configuration-model) (this page) | Precedence (shipped defaults < `.env` < `.env_custom` < Admin → Configuration < `YOURPHR_*`), the env mapping, and the full key reference. |
| [Sandbox provider credentials](#sandbox-provider-credentials) (this page) | The optional `YOURPHR_SANDBOX_*` one-click sandbox catalog ([#291](https://github.com/jwilleke/yourphr/issues/291)) — env-only, works on any deployment. |
| [OAuth relay (self-hosting)](#oauth-relay-self-hosting) (this page) | Self-host the public SMART redirect relay ([#20](https://github.com/jwilleke/yourphr/issues/20)) — Docker or k8s; only needed for live provider sync. |
| [`upgrading-v2-to-v3.md`](upgrading-v2-to-v3.md) | Go (v2) → TypeScript (v3) for anyone self-hosting who is __not__ on Kubernetes: stop v2, migrate a read-only copy, start v3, and how to go back. The rollback works because v2's data is never written to. |
| [`cutover-runbook.md`](cutover-runbook.md) | The Go → TypeScript cut-over ([#588](https://github.com/jwilleke/yourphr/issues/588)): freeze, copy, migrate, verify, swap the Ingress, Go kept warm as the rollback, the stop rule, and the rehearsal the runbook is not done without. |
| [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md) | The test sandboxes themselves (Blue Button, Epic, SMART Health IT, …) and how to exercise them. |
| [`../vendors/README.md`](../vendors/README.md) | Per-vendor connection notes, onboarding gates, and registration friction. |
| [`../provider-catalog/`](../provider-catalog/) | The admin-configured provider catalog model (server-held creds; patients never see `client_id`/`client_secret`). |
| [`../medicare-bluebutton.md`](../medicare-bluebutton.md) | A full worked SMART-on-FHIR connect example with exact settings. |
| [`../cms-bluebutton-production-access.md`](../cms-bluebutton-production-access.md) | CMS production access: form, Zoom demo script, PP/ToS gates (#433). |
| [`../FHIR/fhir-converter-local.md`](../FHIR/fhir-converter-local.md) | The optional C-CDA/CCD converter sidecar. |
| [`../agent-access-policy.md`](../agent-access-policy.md) | Letting a patient point their own AI client at their own records ([#657](https://github.com/jwilleke/yourphr/issues/657)): the default posture, what is logged and under whose name, what the product refuses, and how to connect a client. Off unless `yourphr.auth.agent-token.enabled` is set. |
| [`../recovery/`](../recovery/) | Backup, restore, and the __restore drill__ — what a backup contains, and how to prove your instance can come back. |

> __Deployment-agnostic by rule.__ Every option below is driven by the same `YOURPHR_*` environment contract and a SQLite file — nothing requires Kubernetes, Flux, SOPS, or any specific orchestrator. The maintainer's production instance uses Flux/GitOps in a separate repo (`mj-infra-flux`); that repo's only job is to *populate the same env vars* a `docker run` would. If a feature can only be configured one way, that is a bug — file it.

## Quick start (minimal, no external services)

```bash
docker run -p 8080:8080 -v "$(pwd)/data:/opt/yourphr/data" ghcr.io/jwilleke/yourphr:3.2.0
```

Open `http://localhost:8080` and complete the first-run setup. On first run YourPHR is __secure by default__:

- The __JWT signing key auto-generates__ and is persisted (0600) at `<db-dir>/.jwt_issuer_key` — zero config ([#102](https://github.com/jwilleke/yourphr/issues/102)). There is no default key. Upstream Fasten's *known public placeholder* is still recognised and rejected, because older deployment guides hand it to you.
- The __encryption keys__ — `YOURPHR_DATABASE_ENCRYPTION_KEY` and `YOURPHR_BACKUP_ENCRYPTION_KEY` — are supplied by you, before the first start. See [Encryption keys](#encryption-keys).

### The first account is the owner of the instance

__Whoever registers first on an empty database becomes the owner and the admin.__ They get `UserRoleAdmin`; everyone who registers afterwards is an ordinary user. This decides who controls Admin → Configuration, Admin → Database (backup, restore, download), Admin → Users, the provider catalog, and the server logs.

Two consequences that matter more than they look:

- __Register immediately after you expose the instance.__ The app decides this purely by counting users (`GetUserCount() == 0`), not by network location or any invite. On a host reachable from the internet, whoever gets there first — including a stranger or a bot — becomes the admin. If you wipe or restore an empty database on a public host, that race reopens.
- __This is the only way an admin ever comes into existence.__ There is no seeded admin account, no CLI user-create, and __no password-reset flow__. Lose the owner's password and the only recovery is editing the database directly or starting from an empty one, so record the credential somewhere durable before you do anything else.

`signup.enabled` (below) can close self-service registration, but it __never blocks the first account__ — a flag able to do that would leave a fresh deployment with no way in at all ([#498](https://github.com/jwilleke/yourphr/issues/498)).

#### Provisioning the admin instead of claiming it (recommended when internet-facing)

The race above is a race because the app decides ownership by counting users; it cannot tell you from a stranger. On a host that is reachable before you have signed up, let the instance provision its own admin instead ([#504](https://github.com/jwilleke/yourphr/issues/504)):

```bash
YOURPHR_BOOTSTRAP_ADMIN_ENABLED=true
YOURPHR_BOOTSTRAP_ADMIN_USERNAME=admin
```

__`admin` is allowed here__ ([#519](https://github.com/jwilleke/yourphr/issues/519)). That name — along with `administrator`, `root`, `system`, `support`, `api` and others — is reserved against __self-service registration__, where a stranger could pick it and message other users as though they were staff. A name you put in your own configuration is not attacker-chosen, so provisioning accepts it and logs that it did. Signing up as `admin` is still refused.

#### Recovering when nobody can sign in

There is no password-reset flow in the app — no reset route, no email, and "Forgot password?" on the sign-in page is not wired to anything. If the only admin is locked out, use the CLI ([#510](https://github.com/jwilleke/yourphr/issues/510)):

`reset-password` is a command of the image itself ([#654](https://github.com/jwilleke/yourphr/issues/654)) — the entrypoint takes a subcommand, so this needs no shell in the container and no source checkout:

```bash
# docker — against a STOPPED instance, on its volume
docker run --rm -v "$(pwd)/data:/opt/yourphr/data" \
  ghcr.io/jwilleke/yourphr:3.2.0 reset-password --user owner --data /opt/yourphr/data
# kubernetes — against the running pod
kubectl exec deploy/<name> -n <namespace> -- node dist/server/main.js reset-password --user owner
```

It generates a password, applies it, and writes the value to `<data root>/.recovery_password` (`0600`) — the same file and lifecycle as the provisioned admin above, so it __deletes itself the first time that account signs in__. The command prints the path, never the value, so the password stays out of shell history, CI logs and screen recordings. Read it the same way:

```bash
kubectl exec deploy/<name> -n <namespace> -- cat /opt/yourphr/data/.recovery_password
```

Two things it does deliberately:

- __It ends that account's existing sessions__ ([#508](https://github.com/jwilleke/yourphr/issues/508)). A reset is usually a response to losing control of an account, so leaving the old sessions alive would defeat the point.
- __The generated password satisfies this instance's own policy__ ([#506](https://github.com/jwilleke/yourphr/issues/506)), so it cannot hand you a credential the change-password screen would then refuse.

It works against a stopped instance or a running one, and refuses a username that does not exist rather than writing a password file for an account that is not there.

__You do not supply a password.__ At first start with an empty user table, the app generates one, creates the admin, and writes the value to `<data root>/.admin_bootstrap_password` (mode `0600`). Startup logs the path, never the value. Read it once:

```bash
# docker
docker exec yourphr cat /opt/yourphr/data/.admin_bootstrap_password
# kubernetes
kubectl exec deploy/<name> -n <namespace> -- cat /opt/yourphr/data/.admin_bootstrap_password
```

Generated rather than supplied on purpose: a password you set ends up in a secret store, a `.env`, or a CI log, and tends to be reused across instances. A generated one is unique per instance, rotates whenever the database is rebuilt, and lives in exactly one place.

__The file deletes itself__ after that admin's first successful sign-in — the data root is exactly what a backup contains, so a credential left there would ride inside every later archive. Store the password in your password manager when you read it; a backup taken before your first login is the only one that carries it.

Provisioning only ever acts on an __empty__ user table. It never re-provisions, never overwrites an account, and never changes an existing password — so leaving the variables set is safe, and every restart after the first does nothing.

These are __bootstrap__ variables and belong in the environment, not in the configuration store: they have to work before any admin exists to open Admin → Configuration.

## Deployment options

### A. docker-compose (easy home-server path)

The committed `docker-compose-prod.yml` + `set_env.sh` flow in the [README](../../README.md#-launch) is the simplest route — it sets the LAN `HOSTNAME`/`IP` and starts the container. Use this if you want a one-command home server.

### B. Plain `docker run`

Mount what you want to persist and pass config as env (or mount a file):

```bash
docker run -d --name yourphr -p 9090:8080 \
  -v "$(pwd)/data:/opt/yourphr/data" \
  -e YOURPHR_DATABASE_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  ghcr.io/jwilleke/yourphr:3.2.0
```

One volume: the database, the config store and the generated signing key all live under it. The
app serves plain HTTP — TLS belongs to a reverse proxy in front of it, so there is no certificate
volume to mount.

To set many keys at once, put a `.env` on that volume at `/opt/yourphr/data/.env` (see
[Configuration model](#configuration-model)), or change them from __Admin → Configuration__ on the
running instance — no restart and no redeploy.

### C. Bare metal

Build the binary (or download a release asset), then run it with a config file and/or env:

```bash
# build (needs Go + Node toolchains; see the Develop section of the README)
make build-frontend-prod
go build -o fasten ./backend/cmd/fasten/

# run — the shipped defaults are CONTAINER paths, so bare metal must set its own
cp .env.baremetal.example .env   # then edit it
./fasten start
```

`fasten migrate` runs DB migrations without starting the server.

Bare metal in particular __must__ set `YOURPHR_WEB_SRC_FRONTEND_PATH` to wherever you put the compiled Angular app. Its default points inside the container image, and without it the backend starts and serves no interface, with nothing in the log explaining why.

### D. Kubernetes / GitOps

Mount a `PersistentVolume` at `/opt/yourphr/data`; the manifests carry infrastructure only (image, volume, service, ingress). Settings live on the volume and are changed from Admin → Configuration; the encryption keys live in `/opt/yourphr/data/.env` on the same volume ([Encryption keys](#encryption-keys)). Any GitOps tool works; nothing in the app is Kubernetes- or Flux-specific.

A secret the app needs from the environment (for example the relay's shared secret) comes in through the manifest, as ngdpbase does it: a flat Secret injected with `envFrom:`, changed by editing the Secret in Git and letting the deployment roll. See [How values reach each implementation](#how-values-reach-each-implementation). __A configuration change never needs a command run inside the cluster.__

## Encryption keys

Two keys, both required, both supplied by you ([#796](https://github.com/jwilleke/yourphr/issues/796)):

| Key | Opens | Needed to restore? |
|---|---|---|
| `YOURPHR_DATABASE_ENCRYPTION_KEY` | this instance's own database files | No — a restore re-encrypts under the new instance's key |
| `YOURPHR_BACKUP_ENCRYPTION_KEY` | every backup this instance writes | __Yes — it is the only thing a restore needs.__ Lose it and every backup is unreadable. |

__Where they live:__ `<data>/.env` (`/opt/yourphr/data/.env` in a container), which the server reads at start ([#630](https://github.com/jwilleke/yourphr/issues/630)). A variable set in the pod spec or container environment __outranks__ that file, so do not set the keys in both places.

__Keep a copy somewhere else.__ `.env` sits on the same volume as the database: lose the volume and you lose the key that opens the backups on your NAS. Record both keys off the instance — a password manager, or an encrypted file on another machine — and prove the copy with a [restore drill](../recovery/data-recovery.md) that uses it. The server says so at every start.

__The trade-off, stated plainly:__ with the database key beside the database, at-rest encryption no longer protects against someone who copies the whole volume. It still protects every backup, which leaves the volume. That is the choice made for the reference instance; an instance on hardware you do not control may prefer to supply the database key from the environment instead.

__Putting the keys on a running Kubernetes volume__ (no `kubectl` on your machine needed — through the node):

```bash
grep '^YOURPHR_' my-keys.env | ssh <node> \
  'sudo kubectl -n <ns> exec -i deploy/<name> -- sh -c "cat >> /opt/yourphr/data/.env"'
```

Then restart the pod. Back up the existing `.env` first, and check for duplicate lines — the last occurrence of a variable wins.

__When the pod cannot start__ (a new, empty volume, or a crash caused by a missing key), write the file straight onto the volume's directory on the node — for k3s `local-path`, `/var/lib/rancher/k3s/storage/<pvc-dir>/.env` — owned by the container user (uid 1000), mode 0600. On a brand-new volume do this __before the first start__: an instance that starts without a database key creates an unencrypted database.

## Configuration model

Configuration is layered. __Precedence, lowest → highest:__

```
shipped defaults  <  .env  <  .env_custom  <  instance overrides  <  YOURPHR_* environment
```

- __Shipped defaults__ — `backend/pkg/config/app-default-config.json`, embedded in the binary. This file is the catalogue of every setting that exists: if a key is not in it, it is not a setting, and the app warns at startup about any `YOURPHR_*` variable that maps to nothing.
- __`.env`__ — an *optional* dotenv file, loaded before anything else evaluates ([#630](https://github.com/jwilleke/yourphr/issues/630)). Precedence, highest first: the ambient environment, then `<YOURPHR_FAST_STORAGE>/.env` (the data volume — `/opt/yourphr/data/.env` in a container), then `<cwd>/.env` (the repo root, for a direct install). The ambient environment wins so a variable set in a manifest is never silently overridden by a file. Optional throughout — configuration works on defaults plus `YOURPHR_*` alone. The `.env.*.example` templates still describe the Go stack's keys and are being rewritten ([#676](https://github.com/jwilleke/yourphr/issues/676)).
- __Instance overrides__ — `<data>/config/app-custom-config.json`, written by __Admin → Configuration__. This is where ordinary settings are changed on a running instance; no restart, no file editing, no redeploy.
- __`YOURPHR_*` environment__ — the universal override, highest precedence (ideal for secrets and k8s). A value set here __cannot be changed from the Admin screen__: that screen shows it as governed by the environment and refuses the edit, rather than accepting a change that would silently revert on the next restart.

### How values reach each implementation

yourPHR has one environment mechanism, `src/bootstrap-env.ts`, ported from ngdpbase (its [bootstrap developer guide](https://github.com/jwilleke/ngdpbase/blob/master/docs/guides/bootstrap-developer-guide.md#how-values-reach-each-implementation) is the reference). It does not know how it was launched: every implementation hands it values the same two ways, the ambient environment and `.env` files, and the ambient environment always wins.

| Implementation | Ambient environment comes from | `.env` read at start | To change a value |
|---|---|---|---|
| Bare metal | your shell or service unit | `<YOURPHR_FAST_STORAGE>/.env`, then `<checkout>/.env` | edit the file, restart |
| Docker (compose or `docker run`) | compose `environment:`, `docker run -e`, the image's `ENV` | `/opt/yourphr/data/.env` on the mounted volume | edit the volume's `.env` or the compose file, restart the container |
| Kubernetes | the Deployment: `envFrom:` a Secret (secrets) or a ConfigMap (non-secrets); inline `env:` only to override one pod | `/opt/yourphr/data/.env` on the persistent volume | change the Secret or ConfigMap in Git and roll the deployment |

Where a value belongs, by what it is:

- __A setting__ (anything that changes how the running app behaves): __Admin → Configuration__, stored in `<data>/config/app-custom-config.json`. Never an environment variable, never a manifest entry ([#472](https://github.com/jwilleke/yourphr/issues/472)). Example: `yourphr.relay.public-url`, `yourphr.relay.url`.
- __A secret__ (environment-owned, read-only on the Admin screen): `.env` on bare metal or Docker; on Kubernetes, a Secret injected with `envFrom:`. Example: `YOURPHR_RELAY_SECRET`. The reference deployment injects the relay's own Secret (`yourphr-relay`) into `yourphr-ts`, so app and relay hold one value and can never disagree ([#870](https://github.com/jwilleke/yourphr/issues/870)).
- __Bootstrap__ (where the data lives, the port): the launcher's environment.
- __Generated once, then kept:__ `YOURPHR_SESSION_SECRET` signs session tokens. When nothing supplies it, the server generates it on first start into `<data>/.env` (`0600`) and reuses it, as ngdpbase does for `NGDPBASE_SESSION_SECRET` ([#815](https://github.com/jwilleke/yourphr/issues/815)). Set it yourself only to manage it; rotating it signs everyone out.
- __Generated once, then kept:__ `YOURPHR_CREDENTIALS_KEY` signs every passkey row in the app database ([#876](https://github.com/jwilleke/yourphr/issues/876)). Generated into `<data>/.env` on first start like the session secret. __Back it up with the database:__ a database restored without its key still opens, but every passkey in it fails its signature, is set aside (never used) and raises an admin notice; people then sign in with their password and add their passkeys again.

Rules that follow, for every implementation:

- __Read once, at start.__ A changed `.env` or Secret takes effect on the next restart, never live.
- __The ambient environment beats the file.__ Set a variable in one place only; a value in the Deployment cannot be changed by editing `.env`.
- __Names are exact.__ A misnamed variable is silently unused; check it against the shipped configuration and `config/app-default-config.json`'s environment-owned key list.

`config.yaml` was removed in [#470](https://github.com/jwilleke/yourphr/issues/470) — it was a committed file baked into the image, shadowed by a ConfigMap in the reference deployment, and the binary read it implicitly from its working directory. See [`docs/configuration-system.md`](../configuration-system.md).

### The `YOURPHR_*` env mapping

Any config key can be set as an env var: prefix __`YOURPHR_`__, uppercase the key, and turn every `.` and `-` into `_`.

| Config key | Env var |
|---|---|
| `database.encryption.key` | `YOURPHR_DATABASE_ENCRYPTION_KEY` |
| `jwt.issuer.key` | `YOURPHR_JWT_ISSUER_KEY` |
| `web.listen.port` | `YOURPHR_WEB_LISTEN_PORT` |
| `web.environment_name` | `YOURPHR_WEB_ENVIRONMENT_NAME` |
| `log.level` | `YOURPHR_LOG_LEVEL` |
| `cda_converter.enabled` | `YOURPHR_CDA_CONVERTER_ENABLED` |
| `web.smart_connect.login_wait_seconds` | `YOURPHR_WEB_SMART_CONNECT_LOGIN_WAIT_SECONDS` |

## Configuration reference

| Key | Default | Notes |
|---|---|---|
| `web.listen.port` | `8080` | Backend listen port inside the container. |
| `web.listen.host` | `0.0.0.0` | Bind address. |
| `web.listen.basepath` | `""` | Sub-path when behind a reverse proxy (e.g. `/phr`). |
| `web.listen.https.enabled` | `false` | Serve HTTPS with a self-generated CA (see the README HTTPS section). |
| `web.environment_name` | `""` | Deployment label in the UI footer (`demo-1.18.2`, `prod-1.18.2`, …). Same release image for every instance — set per env (e.g. `demo` / `prod` / `dev`). Empty → frontend build-time default. |
| `web.allow_unsafe_endpoints` | `false` | __Never enable in production__ — exposes unauthenticated API access. |
| `web.smart_connect.login_wait_seconds` | `240` | How long the SMART-on-FHIR connect flow waits for the user to finish logging in at the provider before timing out. Served to the frontend, so changing it needs __no frontend rebuild__ — raise it for slow provider logins (e.g. CMS Blue Button). |
| `database.type` | `sqlite` | Only SQLite is supported; Postgres is present but __broken__. |
| `yourphr.database.location` | `${YOURPHR_FAST_STORAGE}/spike.db` | The app database. `yourphr.records.location` holds the records; both compose from the storage root, so mounting that one volume persists everything. |
| `database.encryption.enabled` | `true` | DB-at-rest encryption (encrypted SQLite build). |
| `database.encryption.key` | *(unset — required)* | Set on first-run setup or via `YOURPHR_DATABASE_ENCRYPTION_KEY` (≥10 chars). |
| `jwt.issuer.key` | *(public placeholder — auto-gen)* | Auto-generates a strong key if unset; override with `YOURPHR_JWT_ISSUER_KEY` (`openssl rand -hex 32`). Never use the committed default in production. |
| `jwt.session_ttl_minutes` | `60` | Browser session sliding window (#445). Cookie Max-Age and JWT `exp` extension length. Env: `YOURPHR_JWT_SESSION_TTL_MINUTES`. |
| `jwt.session_absolute_hours` | `12` | Hard cap from first login (`session_start`); no further renew after this. Env: `YOURPHR_JWT_SESSION_ABSOLUTE_HOURS`. |
| `jwt.session_renew_if_remaining_minutes` | `30` | Renew session JWT/cookie on authenticated API calls when less than this much lifetime remains. Env: `YOURPHR_JWT_SESSION_RENEW_IF_REMAINING_MINUTES`. |
| `log.level` | `INFO` | `DEBUG` / `INFO` / `WARN` / `ERROR`. |
| `log.file` | `""` | Optional log file (also writes to stderr). |
| `cda_converter.enabled` | `false` | C-CDA/CCD import — needs the Metriport sidecar (opt-in). See [`FHIR/fhir-converter-local.md`](../FHIR/fhir-converter-local.md). |
| `cda_converter.url` | `""` | Sidecar URL when enabled (internal-only — raw CCD is PHI). |
| `cda_converter.timeout_seconds` | `60` | Conversion timeout. |
| `bootstrap.admin.enabled` | `false` | Provision the admin at first start with a generated password instead of claiming it through the first-run wizard ([#504](https://github.com/jwilleke/yourphr/issues/504)). __Bootstrap — set in the environment, not here.__ See the first-run section above. |
| `bootstrap.admin.username` | `""` | Which account to provision. Ignored unless the above is on; enabled-with-no-username warns and provisions nothing rather than guessing. |
| `signup.enabled` | `true` | Self-service account creation ([#498](https://github.com/jwilleke/yourphr/issues/498)). Set `false` on an internet-facing instance so strangers cannot register; an operator still adds people from Admin → Users, so this removes self-service, not multi-user support. __The first run ignores this__ — with an empty user table, registration always proceeds and that account becomes the owner/admin (see above). Published via `/api/instance/public` so the sign-in page hides "Create an Account" instead of offering a link that fails. |
| `web.trusted_proxies` | `[]` | CIDRs or bare addresses whose forwarding headers are believed ([#529](https://github.com/jwilleke/yourphr/issues/529)) — e.g. `["10.42.0.0/16"]` for a k3s pod network, `["172.18.0.1"]` for a docker gateway. __Empty means trust nothing__, so `X-Forwarded-For` and `X-Real-IP` are ignored and the client address is the actual socket peer. That is the right setting for a directly reachable instance, including port-forwarded and tunnelled home deployments. Gin's own default is the opposite — it trusts every proxy, which lets a caller choose its own address and made the per-IP limit below bypassable by rotating a header. __Set this whenever the app sits behind a reverse proxy__, or every client shares the proxy's bucket. An unparseable entry is logged and leaves the server trusting nothing. |
| `web.rate_limit.auth_per_minute` | `10` | Requests allowed per __client IP__ per window on the unauthenticated credential endpoints ([#104](https://github.com/jwilleke/yourphr/issues/104)). A brute-force backstop, not a throughput setting. Too low for an automated suite driving real logins ([#481](https://github.com/jwilleke/yourphr/issues/481)) — raise it on a test instance. It keys on `c.ClientIP()`, so whether that value can be trusted is decided entirely by `web.trusted_proxies` above. Set to `0` or less to disable; the server warns on every start while it is off. |
| `web.rate_limit.auth_per_account_per_minute` | `10` | __Failed__ sign-ins allowed per username per window ([#509](https://github.com/jwilleke/yourphr/issues/509)), counted in addition to the per-IP limit. Covers what per-IP cannot: a slow distributed attempt against one account stays under every address's bucket. Successes clear the counter, so a busy account is never throttled for being busy. Set to `0` or less to disable. |
| `web.rate_limit.auth_window_seconds` | `60` | The window both auth limits are measured over — one key so they cannot drift. A non-positive value falls back to 60s rather than disabling anything; disabling is what the two limit keys are for. |
| `password.min_length` | `8` | Minimum length for a __new or changed__ password ([#506](https://github.com/jwilleke/yourphr/issues/506)). Enforced server-side by sign-up, admin user-create and change-password — never at sign-in, because an account created before the policy existed must still be able to get in. |
| `password.max_length` | `69` | Maximum length __in bytes__. bcrypt refuses anything over 72 bytes, so this produces a clear message instead of an internal error; a value above 72 is clamped. Bytes, not characters, because UTF-8 is variable width — an emoji is four bytes. |
| `password.deny_common` | `true` | Reject the handful of passwords tried first in every credential-stuffing run, from a short embedded list. No network call — a self-hosted PHR must work offline, and checking a password against a third-party API tells them somebody just set one here. |
| `password.deny_username` | `true` | Reject a password containing the account name. |
| `username.min_length` | `3` | Minimum username length. One value that the sign-in form, the sign-up form and the server all read — before this they disagreed, and the sign-in page rejected usernames the server had happily created. |
| `demo.enabled` | `false` | __Public demo instances only.__ Puts a one-click "Explore the demo" button on the sign-in page that enters a *shared* account with no credential entry ([#495](https://github.com/jwilleke/yourphr/issues/495)). Served by `/api/instance/public`, so the sign-in page can read it with no login. Never enable on an instance holding real records. |
| `demo.username` | `demo` | Which account the demo button signs in as. Ignored unless `demo.enabled`. |
| `demo.password` | `""` | __Not set by hand.__ Generated per instance at startup, set on the demo account, and rotated whenever the two drift apart ([#515](https://github.com/jwilleke/yourphr/issues/515)) — so nobody knows it, nobody types it, and no release image carries a working demo credential. Verified __server-side__ by `POST /api/auth/demo-signin`, masked in Admin → Configuration, and never served to a browser. Empty means "not provisioned yet", and the endpoint refuses rather than treating it as "no password needed". |
| `demo.admin.enabled` | `false` | Offer the __read-only__ admin tour beside the patient demo ([#516](https://github.com/jwilleke/yourphr/issues/516)), so a reviewer can see Configuration, Users, Database and Logs without an operator handing out a real credential. Requires `demo.enabled` as well. Read-only is enforced by the API, default-deny — the account can look at anything except configured secrets and the server's directories, and change nothing. |
| `demo.admin.username` | `demoadmin` | Which account the admin tour signs in as. Provisioned automatically with a generated password (`demo.admin.password`) the same way `demo.password` is. Does __not__ count as an admin for `bootstrap.admin.enabled`, so an operator admin is still provisioned. |
| `demo.reset_on_restart` | `false` | Reinstall the demo database baked into the image on __every__ start ([#518](https://github.com/jwilleke/yourphr/issues/518)), so resetting a public demo is a restart. Requires `demo.enabled` and `bootstrap.seed.restore` as well, refuses on an encrypted database, and before overwriting anything it checks that every account in the existing database is the demo, the demo admin, or the bootstrap admin — anything else and it refuses and starts normally. Also drops the cache and the generated JWT signing key, so pre-reset sessions end cleanly. The instance's custom config file is kept. |

### Passkeys

A person can sign in with a passkey (fingerprint, face or device PIN) instead of a password, and manage theirs under Account Profile → Sign-in methods: add, rename, remove ([#876](https://github.com/jwilleke/yourphr/issues/876)). Ported from ngdpbase.

- __Off until the instance knows its own address.__ Set `yourphr.application.base-url` in Admin → Configuration to the address people use, e.g. `https://phr.example.org`. A passkey is tied to that host and works nowhere else, so the server never takes the host from a request. It must be `https`, or `http://localhost` for development; anything else leaves passkeys off, and the startup log says why.
- `yourphr.auth.passkey.enabled` (default `true`) turns them off even with a base URL set.
- __Adding one needs proof it is you:__ the account's password, or a passkey it already has. A session from an agent token can never add, rename or remove one.
- __The last way in cannot be removed:__ an account with no password cannot remove its only passkey.
- Every sign-in with a passkey, and every add, rename and removal, is in the person's access log.
- The rows are signed with `YOURPHR_CREDENTIALS_KEY` (above); keep it with your database backups.

### What is recorded about sign-ins

Each successful sign-in updates two fields on the account: __when__ it happened and __how many__ there have been ([#512](https://github.com/jwilleke/yourphr/issues/512)). Both are shown on Account Profile and on Admin → Users, so a patient can answer "has anyone else been in my record?" and an admin can tell a live account from an abandoned one.

__No IP address and no user-agent are stored anywhere by this.__ That is deliberate, not an oversight: on a product whose premise is that nobody else holds your data, keeping a log of your own household's addresses would need a retention policy and a privacy decision of its own ([#507](https://github.com/jwilleke/yourphr/issues/507)). Failed attempts are not counted either — brute force is handled by throttling ([#509](https://github.com/jwilleke/yourphr/issues/509)), and a failure counter on the account is the first half of account lockout, which is a denial-of-service weapon against the account owner.

There is nothing to configure. No retention window, because nothing accumulates: two fields, overwritten.

## Secrets & credentials

There are __two distinct kinds__ — don't conflate them:

1. __Operator/server secrets__ (deployment-level, one set): the __DB encryption key__ (required while encryption is on) and an optional pinned __JWT key__. Supply via `YOURPHR_*` env or `.env_custom` — never in a committed file.
2. __Per-user OAuth credentials__ (runtime, per user *and* per connected source): when a user connects a SMART source they enter their own `client_id`/`client_secret` in the UI. These live in the `source_credentials` table ([#286](https://github.com/jwilleke/yourphr/issues/286)) — __not__ an env var or file, because they are dynamic per-user data, not server config. They are never serialized to the browser (`json:"-"`).

   Their protection at rest is __whole-database encryption, not per-column__ — so they are encrypted only when `database.encryption.enabled` is on. It is __on by default__, but an instance that wants working backups has to turn it off. See the risk note below.

### What the data volume holds

The instance data root (`storage.data_dir`, [#451](https://github.com/jwilleke/yourphr/issues/451) — the volume you mount and back up) contains, in one place:

| | |
|---|---|
| `db/fasten.db` | every imported record, plus `source_credentials`: OAuth __access and refresh tokens__ and `client_secret` for each connected provider |
| `.jwt_issuer_key` | the generated HS256 session signing key (0600) |
| `config/app-custom-config.json` | instance settings, and any secret an operator chooses to set there (0600) |
| `backups/` | database snapshots, if a local destination is used |

__Treat this volume as the crown jewels.__ A stored refresh token is not historical data — it grants *ongoing* access to that patient's records at Epic, CMS or Medicare until revoked. Anyone who can read the volume can use them.

Practical consequences:

- __With `database.encryption.enabled` off (the default), all of the above is cleartext on disk.__ A copied PVC, a snapshot, a decommissioned disk, or a `kubectl cp` of the data dir yields live provider credentials.
- __Backups are cleartext too__, and they are the copy most likely to leave the machine — a NAS, another host, cold storage. See [#461](https://github.com/jwilleke/yourphr/issues/461).
- An operator __may__ set secrets through Admin → Configuration, which writes them to `app-custom-config.json` on this volume. That is supported and adds little marginal risk given what is already here — but it is a choice, and the alternative is to keep secrets in `YOURPHR_*` env (or reference them from the config with `${VAR}`, [#460](https://github.com/jwilleke/yourphr/issues/460)) so they live in your secret manager instead.

### Privacy Policy and Terms of Service

Both documents are __served by your instance__ at `/privacy` and `/terms`, not fetched from `yourphr.org`. They are embedded in the binary, so they work with no internet access and there is no file to forget to mount.

__You are the data controller.__ The shipped policy says so — the YourPHR project holds no records, the operator of each instance does. So if your deployment differs from the stock description (you host for a clinic, you changed retention, you added a feature that shares data), you should publish your own text rather than point users at a document you did not write.

Drop either or both of these into your data directory:

```text
<data>/config/privacy-policy.md
<data>/config/terms-of-service.md
```

Markdown. Present → served instead of the shipped document, and the page tells readers it was published by the operator. Absent → the shipped document is served, and the page says the operator has not published their own. Overriding one does not affect the other.

An __empty or unreadable__ override is an error, not a silent fallback: serving the stock policy in place of one you deliberately replaced is exactly the failure this feature exists to prevent. Remove the file if you want the shipped text back.

Every served document carries a digest (`sha256:…` over the Markdown) shown at the foot of the page. It identifies precisely which text a reader saw — computed over the source rather than the rendered HTML, so upgrading the renderer does not make an old version look like a new one.

__If you have CMS Blue Button production approval, PP/ToS changes need CMS pre-approval first__ ([#367](https://github.com/jwilleke/yourphr/issues/367) context in [`../cms-bluebutton-production-access.md`](../cms-bluebutton-production-access.md)). That applies to an override on an approved instance as much as to the shipped text.

### Should a production instance enable `database.encryption.enabled`?

__Eventually yes — today, only with your eyes open.__ Turning it on refuses backup *and* restore ([#367](https://github.com/jwilleke/yourphr/issues/367)), because a `VACUUM INTO` snapshot of an encrypted database would be written in plaintext. So the choice today is:

| | At rest | Backups | Suits |
|---|---|---|---|
| `enabled: true` (default) | encrypted | __refused__ | An instance on hardware you do not control (VPS, shared host, cloud disk), where disclosure is the bigger fear |
| `enabled: false` | cleartext | work | An instance whose disk you physically control, where losing records is the bigger fear |

For most self-hosters on their own hardware, __losing the records is a worse outcome than a stolen disk__. If that describes your instance, set `YOURPHR_DATABASE_ENCRYPTION_ENABLED=false` explicitly so backups work. If your instance runs somewhere you would not leave an unlocked filing cabinet — a rented VPS, a cloud volume, a laptop that travels — keep the default and accept that you have no backups until [#461](https://github.com/jwilleke/yourphr/issues/461) lands, which removes the trade by encrypting the backup artifact itself.

Either way, treat the volume as sensitive: with encryption off it is cleartext, and with encryption on you have no backup to fall back on.

If you turn encryption off so that backups work, then __prove they work__: [`../recovery/data-recovery.md`](../recovery/data-recovery.md). Choosing "records matter more than a stolen disk" and then never testing a restore gets you the downside of both.

__Why `true` is the default,__ despite requiring an operator-supplied key with no fallback (a generated key stored next to the database protects against nothing). It is not a security recommendation — it is what a stock Docker install already *has*. The image shipped a baked `config.yaml` with encryption on for years, so those installs set a key at first-run and their database is encrypted. Defaulting to `false` when `config.yaml` was removed would have left every one of them unopenable ([#470](https://github.com/jwilleke/yourphr/issues/470)). Deployments that run unencrypted must now say so explicitly; every `.env.*.example` template does.

Turning encryption __on__ for an existing plaintext database does not work either — that migration is [#363](https://github.com/jwilleke/yourphr/issues/363).

## Sandbox provider credentials

For trying live SMART-on-FHIR sync against vendor __test sandboxes__, YourPHR ships a one-click `/sandbox` provider catalog ([#291](https://github.com/jwilleke/yourphr/issues/291)). Instead of every user pasting a `client_id`/`client_secret`, the __operator__ supplies them once as environment variables; the backend seeds the sandbox catalog from them on startup, and the secret is held server-side — it is `json:"-"` and __never serialized to the browser__.

This is __env-only and deployment-agnostic__ — populate it however your deployment supplies env (docker `environment:`/`env_file:`, a bare-metal `.env_custom`, a k8s Secret, …). Set only the providers you have a registered app for:

| Provider | `client_id` env var | `client_secret` env var | Notes |
|---|---|---|---|
| CMS Blue Button 2.0 | `YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_ID` | `YOURPHR_SANDBOX_BLUEBUTTON_CLIENT_SECRET` | Confidential — needs both. |
| Epic (sandbox) | `YOURPHR_SANDBOX_EPIC_CLIENT_ID` | *(none)* | Public/PKCE — no secret. |
| Oracle/Cerner (sandbox) | `YOURPHR_SANDBOX_ORACLE_CLIENT_ID` | *(none)* | Public/PKCE — no secret. |
| athenahealth (sandbox) | `YOURPHR_SANDBOX_ATHENA_CLIENT_ID` | `YOURPHR_SANDBOX_ATHENA_CLIENT_SECRET` | Confidential — needs both; vendor onboarding-gated. |
| SMART Health IT | *(none — fixed literal `client_id`)* | *(none)* | Open sandbox; always seeded, no config. |

__Behaviour:__ a provider whose `client_id` env value is __empty is skipped__ — that provider just doesn't appear under `/sandbox` on that instance; nothing errors and the open SMART Health IT sandbox is unaffected. Seeding is idempotent and re-runs on every startup, so updating an env value and restarting refreshes the stored creds. These are __operator/sandbox config__, not per-user data — production patient connects use the admin-configured provider catalog ([`../provider-catalog/`](../provider-catalog/)), not these env vars.

For the sandboxes themselves and how to exercise them, see [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md) and the per-vendor notes in [`../vendors/README.md`](../vendors/README.md).

## OAuth relay (self-hosting)

Live SMART-on-FHIR sync ([EPIC #20](https://github.com/jwilleke/yourphr/issues/20)) needs a small public __OAuth relay__ to catch the provider's redirect. After you authorize at the provider, it redirects the __browser__ to `…/callback?code&state`; the relay stores `{state → code}` in memory (short TTL) and the YourPHR instance polls `…/pending?state=` (shared-secret gated) to retrieve the code and finish the token exchange itself. __The relay never sees tokens, and manual record upload needs no relay at all__ — this is only for live provider sync.

__The app ships with no relay configured__ (the Go stack defaulted to the project's relay; v3 does not), and until one is set every provider connect fails with "no SMART relay is configured". Configure all three, each in its proper home ([How values reach each implementation](#how-values-reach-each-implementation)):

| What | Where | Example (the project relay) |
|---|---|---|
| `yourphr.relay.public-url`, where providers send the patient's browser back | Admin → Configuration | `https://relay.nerdsbythehour.com` |
| `yourphr.relay.url`, where the app collects the code (may be an internal address) | Admin → Configuration | `http://yourphr-relay.yourphr.svc:8080` in-cluster |
| `YOURPHR_RELAY_SECRET`, the shared secret gating `/pending`; must equal the relay's | the environment: `.env`, or a Kubernetes Secret via `envFrom:` | — |

Self-hosting the relay is optional but recommended for a real deployment, and is __deployment-agnostic__: a single Go binary (`ghcr.io/jwilleke/yourphr-relay`) configured entirely by env.

### Relay configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `YOURPHR_RELAY_SECRET` | __yes__ | — | Shared secret gating `/pending`. Generate with `openssl rand -hex 32`. Must match the app's `YOURPHR_RELAY_SECRET`. |
| `PORT` | no | `8080` | Public listener. Serves `/callback` (open) and `/pending` (secret-gated). |
| `METRICS_PORT` | no | `9090` | Prometheus `/metrics` + `/healthz`. __Internal only — do not expose publicly__ (keeps callback/poll counts off the internet). |

### Main app sync metrics (#441)

Background SMART sync jobs persist a structured summary on each job’s `data.summary` (duration, outcome, resource counts by type). Optionally scrape process counters:

| Config / env | Default | Purpose |
|---|---|---|
| `metrics.enabled` / `YOURPHR_METRICS_ENABLED` | `false` | Turn on the scrape listener |
| `metrics.port` / `YOURPHR_METRICS_PORT` | `9091` (when enabled and `addr` empty) | Port for `GET /metrics` + `/healthz` |
| `metrics.addr` / `YOURPHR_METRICS_ADDR` | — | Full bind address (e.g. `127.0.0.1:9091`); overrides port |

__Internal only__ — do not expose on public Ingress. Series include `yourphr_sync_jobs_total`, `yourphr_sync_duration_seconds`, `yourphr_sync_resources_total` (no patient/source ids in labels).

Two hard requirements:

- The relay must be __publicly reachable__ and __excluded from any forward-auth__ (e.g. Authentik). The provider redirects the user's browser to `/callback`, so it must arrive __unauthenticated__.
- The `/callback` URL must __exactly match__ the redirect URI you registered with each provider.

### Run it (Docker)

```bash
docker run -d --name yourphr-relay -p 8080:8080 \
  -e YOURPHR_RELAY_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/jwilleke/yourphr-relay:main
```

Put it behind your own TLS-terminating reverse proxy / tunnel at a public hostname (e.g. `relay.example.org`), routing only the main `:8080` port — leave `METRICS_PORT` off the internet.

### Run it (Kubernetes / GitOps)

A ready-to-adapt manifest (Secret + Deployment + Service + Ingress, with the forward-auth exclusion called out) lives at [`../../relay/deploy/yourphr-relay.example.yaml`](../../relay/deploy/yourphr-relay.example.yaml). Copy it into your GitOps repo and adjust the host + secret. The maintainer's instance does exactly this via `mj-infra-flux`; the manifest is a template, not applied from this repo.

### Point the app at it

Set both on the YourPHR app (same `YOURPHR_*` env contract as the rest of this page):

```
YOURPHR_RELAY_URL=https://relay.example.org      # default: https://relay.nerdsbythehour.com
YOURPHR_RELAY_SECRET=<the same secret the relay was given>
```

If `YOURPHR_RELAY_SECRET` is unset, the app simply doesn't use a relay (it falls back to a directly-supplied auth code) — so a manual-upload-only instance needs neither var.

## Importing records

- __FHIR JSON / NDJSON__ — uploaded directly, no extra services.
- __PDF / DICOM / image__ — uploaded as viewable documents, no extra services ([#255](https://github.com/jwilleke/yourphr/issues/255)).
- __C-CDA / CCD__ — requires the optional __Metriport fhir-converter sidecar__ (`cda_converter.*`); see [`FHIR/fhir-converter-local.md`](../FHIR/fhir-converter-local.md).
- __Live provider sync (SMART on FHIR)__ — connect a provider with your own `client_id` (bring-your-own). This is the one feature with an external touch point: an __OAuth relay__ catches the provider's redirect. The default is the project's demo relay (`relay.nerdsbythehour.com`); a self-hoster can point at their own with `YOURPHR_RELAY_URL`. __Manual upload needs no relay.__ Worked example with exact settings: [`medicare-bluebutton.md`](../medicare-bluebutton.md).

## See also

- [README — Launch / HTTPS / Develop](../../README.md#instructions)
- [`../recovery/data-recovery.md`](../recovery/data-recovery.md) — __the restore drill.__ A backup you have never restored is not a backup; test recovery, not backup
- [`../testing-sandboxes/test-sandboxes.md`](../testing-sandboxes/test-sandboxes.md) — the test sandboxes and how to exercise them
- [`../vendors/README.md`](../vendors/README.md) — per-vendor connection notes and onboarding gates
- [`../provider-catalog/`](../provider-catalog/) — admin-configured production provider catalog
- [`../medicare-bluebutton.md`](../medicare-bluebutton.md) — a full worked SMART-on-FHIR connect example
- [`../../relay/deploy/yourphr-relay.example.yaml`](../../relay/deploy/yourphr-relay.example.yaml) — example k8s manifest for the OAuth relay
- [`FHIR/fhir-converter-local.md`](../FHIR/fhir-converter-local.md) — running the C-CDA converter sidecar
- [`architecture.md`](../architecture.md) — system overview
