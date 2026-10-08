# Demo mode

A developer's guide to yourPHR's public demo: what it is, every piece of code that implements it, how it is built, deployed and tested, and what to do when you add a feature it must restrict.

The live instance is `https://demo.yourphr.org`. Demo mode is off on every ordinary install, and every part of it below is inert until an operator turns it on.

## What a public demo is

A stranger who has never installed yourPHR can try it in one click, without an account and without anyone handing out a password. Three accounts live on a demo instance:

| Account | Default name | Who uses it | What it can do |
|---|---|---|---|
| The demo patient | `demo` | Every visitor, shared | A populated PHR to explore. Cannot bring outside data in, and cannot change anything that would take the demo away from the next visitor. |
| The demo admin | `demoadmin` | Visitors who want the operator view | Sees the operator screens and changes nothing. Optional. |
| The operator | `admin` (the bootstrap admin) | Whoever runs the instance | Full access, on the same instance, through the ordinary sign-in form. |

The design rests on one rule: __a restriction is enforced by the server, never only by hiding a button.__ The routes answer `curl` whatever the UI renders, so every refusal is in a manager or in the request guard, and the UI only mirrors it.

## Configuration

All keys live in [`config/app-default-config.json`](../../config/app-default-config.json), each with a `_comment_demo*` entry that explains it. They are settings, so they are set in Admin → Configuration (stored in `<data>/config/app-custom-config.json`), never in a deployment manifest ([#472](https://github.com/jwilleke/yourphr/issues/472)).

| Key | Default | Meaning |
|---|---|---|
| `yourphr.demo.enabled` | `false` | This instance is a public demo. Master switch for everything here. |
| `yourphr.demo.username` | `demo` | The shared patient account. Never published. |
| `yourphr.demo.password` | `""` | __Generated at startup, never set by hand.__ Masked in Admin → Configuration, never sent to a browser. |
| `yourphr.demo.admin.enabled` | `false` | Offer the read-only admin tour. Works only with `yourphr.demo.enabled` on as well. |
| `yourphr.demo.admin.username` | `demoadmin` | The read-only admin account. Created automatically. |
| `yourphr.demo.admin.password` | `""` | Generated at startup, like the patient's. |
| `yourphr.demo.reset-on-restart` | `false` | Restore the baked-in baseline at every start. |
| `yourphr.demo.baseline.dir` | `./baseline` | Where the baseline is. The image ships one at `/opt/yourphr/baseline`. |

Related keys that matter on a demo:

- `yourphr.web.environment-name`: set to `demo`, so the footer reads `demo-<version>` and a visitor can tell the demo from a real instance.
- `yourphr.auth.rate-limit.max-requests` / `window-seconds`: the per-IP request budget on `/api/auth/signin` and `/api/auth/demo-signin` ([#647](https://github.com/jwilleke/yourphr/issues/647)). Demo sign-in runs a bcrypt check for an anonymous caller who posts nothing, so it needs a request budget, not a failure counter. Read live.

`yourphr.demo.username`, `yourphr.demo.password` and the admin pair are in the secret-keys list, so the Configuration screen masks them.

## The role

`demo-admin` is defined in the `roles` block of [`config/app-default-config.json`](../../config/app-default-config.json) with one permission, `admin-read`:

- It sees operator screens that need only `admin-read`, such as Database and Logs.
- It does __not__ see Configuration, which needs `admin-system` ([#751](https://github.com/jwilleke/yourphr/issues/751)). Configuration shows how the instance defends itself, such as the sign-in throttle.
- It does __not__ see the users list, which needs `user-read`.

The role makes the account able to look. The request guard (below) is what makes it read-only.

## Code map

### Backend

| File | What it does |
|---|---|
| [`src/app/managers/DemoManager.ts`](../../src/app/managers/DemoManager.ts) | The one owner of demo mode: who is the demo, the two entrances, provisioning, and every refusal. Start here; its header explains each design choice. |
| [`src/app/providers/demo-reset.ts`](../../src/app/providers/demo-reset.ts) | `applyDemoReset`: restores the baseline at startup, before any database opens. The only code path that deliberately destroys a live database. |
| [`src/app.ts`](../../src/app.ts) | Wiring: calls `applyDemoReset` (search for it), registers `DemoManager` (`engine.register('demo', …)`), and calls `demo.provision()` right after `users.bootstrapAdmin()`. |
| [`src/server.ts`](../../src/server.ts) | The two entrance routes, the global read-only guard, each `refuseWrite` call, and `demo_account` on `/api/secure/account/me`. Search for `demo`. |
| [`src/framework/managers/SettingsManager.ts`](../../src/framework/managers/SettingsManager.ts) | Publishes `demo.enabled`, `demo.admin.enabled` and `demo.admin.session` to the UI. |
| [`src/app/managers/SourcesManager.ts`](../../src/app/managers/SourcesManager.ts), [`CatalogManager.ts`](../../src/app/managers/CatalogManager.ts) | Call `refuseConnect` on the doors that bring outside data in. |
| [`src/framework/managers/UsersManager.ts`](../../src/framework/managers/UsersManager.ts) | `passwordMatches` and the boot-only password set used by provisioning; `BOOTSTRAP_ADMIN_USERNAME`, which the reset's proof names. |
| [`src/http/rate-limit.ts`](../../src/http/rate-limit.ts) | The per-IP request budget on the sign-in routes. |
| [`src/framework/managers/EmailManager.ts`](../../src/framework/managers/EmailManager.ts) | Mail is off unless configured: a public demo must never email a stranger. |

### Frontend

| File | What it does |
|---|---|
| [`pages/auth-signin/`](../../frontend/src/app/pages/auth-signin/) | "Explore the demo" and "See the admin view" buttons, shown from `demo_enabled` / `demo_admin_enabled`. |
| [`pages/demo-entry/`](../../frontend/src/app/pages/demo-entry/) | Deep links `/demo` and `/demo-admin` ([#517](https://github.com/jwilleke/yourphr/issues/517)), which sign in on arrival. They fail with the same generic message whether or not demo mode exists. |
| [`services/auth.service.ts`](../../frontend/src/app/services/auth.service.ts) | `DemoSignin()` / `DemoAdminSignin()`: post an empty body. |
| [`services/auth-interceptor.service.ts`](../../frontend/src/app/services/auth-interceptor.service.ts) | Turns a 403 with `code: demo_account_restricted` into a toast instead of a silent failure. |
| [`components/header/`](../../frontend/src/app/components/header/) | The "Read-only demo" banner, from `demo_admin_session`. |
| [`pages/medical-sources/`](../../frontend/src/app/pages/medical-sources/), [`pages/account-profile/`](../../frontend/src/app/pages/account-profile/account-profile.component.html), [`pages/settings/`](../../frontend/src/app/pages/settings/settings.component.html) | Disable connect, upload, password change, sign-out-everywhere and email for the demo account, from `demo_account`. |
| [`pages/admin-config/`](../../frontend/src/app/pages/admin-config/admin-config.component.html) | Explains why the demo admin cannot open Configuration. |

### Build and deployment

| File | What it does |
|---|---|
| [`scripts/build-demo-baseline.ts`](../../scripts/build-demo-baseline.ts) (`npm run baseline`) | Builds the two baseline databases. |
| [`Dockerfile`](../../Dockerfile) | Runs the baseline build in the image build and copies it to `/opt/yourphr/baseline`. |
| `jwilleke/mj-infra-flux`: `apps/production/demo-yourphr-ts/` | The demo's Deployment, its own PVC and Service. |

## How it works

### Startup order

Order matters, and it is fixed in `assembleApp` ([`src/app.ts`](../../src/app.ts)):

1. __Staged restore and staged config__, if an operator asked for one. An explicit restore beats the demo's automatic one.
2. __Demo reset__ (`applyDemoReset`), before any database is opened.
3. Databases open, managers initialise.
4. __`users.bootstrapAdmin()`__: on an empty user table only, creates `admin` and writes its password to `<data>/.admin_bootstrap_password`.
5. __`demo.provision()`__: sets the demo passwords (next section).

### Provisioning the credentials

`DemoManager.provision()` runs at every start and does nothing unless `yourphr.demo.enabled` is on.

- If the configured `yourphr.demo.password` already matches the demo account's stored password, it changes nothing. That is the normal restart.
- If they do not match, or none is configured, it generates 24 random bytes, sets them as the account's password, and writes them to the config key. A freshly restored baseline is exactly this case, so a reset needs no operator step.
- The account is updated first and the config second. If the config write fails, the next start sees a mismatch and heals itself. A mismatch is never treated as "no password needed".
- The patient account must already exist; provisioning only logs if it does not. The baseline holds it. On a demo without a baseline, the operator creates `demo` in Admin → Users and restarts.
- The demo admin account is created here if missing, then provisioned the same way, only when `yourphr.demo.admin.enabled` is on.
- Provisioning never stops the server from starting. A demo with no way in is a log line.

Why generated: a password chosen by a person and shipped in a public image is the same published credential on every deployment. The Go demo's `demo123` also broke the password rules twice ([#505](https://github.com/jwilleke/yourphr/issues/505), [#506](https://github.com/jwilleke/yourphr/issues/506)).

### The entrances

| Route | Signs in as | Gated on |
|---|---|---|
| `POST /api/auth/demo-signin` | the demo patient | `yourphr.demo.enabled` |
| `POST /api/auth/demo-signin/admin` | the demo admin | `yourphr.demo.enabled` and `yourphr.demo.admin.enabled` |

Both post no body. `DemoManager.enter()` reads the configured password, checks it against the stored hash with `UsersManager.passwordMatches`, and only then mints a session.

The check is deliberate. Minting a token for whatever account `yourphr.demo.username` names would turn a mis-set flag into an authentication bypass: an operator flipping demo mode on an instance that has a real account called `demo` would hand it to strangers. With the check, a flag flipped without provisioning does nothing.

Every refusal returns the same generic message. The reason ("not enabled", "no such account", "credential drifted") goes to the server log, where the operator reads it, and not to a visitor probing from outside.

Both routes share the per-IP request budget with `/api/auth/signin`.

### What the UI is told

| Signal | Where | Means |
|---|---|---|
| `demo.enabled` | `/api/instance/public` | Show "Explore the demo". The account name is never published. |
| `demo.admin.enabled` | `/api/instance/public` | Show "See the admin view". False unless demo mode is also on. |
| `demo_account` | `/api/secure/account/me` | This session is the shared patient account: render its refused actions as disabled. |
| `demo.admin.session` | `/api/secure/instance` | This session is the demo admin: show the read-only banner. |
| `code: demo_account_restricted` | any 403 body | A demo refusal; the interceptor shows it as a toast. |

### The restrictions

All three are methods on `DemoManager`, and each one checks first whether the caller is the demo session. For the operator, or for any account on an instance that is not a demo, they do nothing.

__`refuseConnect(ctx)`: the demo patient may not bring outside data in__ ([#496](https://github.com/jwilleke/yourphr/issues/496)). The account is shared, so a visitor connecting their real Epic or Medicare account would show their records to the next visitor. It is called by the managers, at the door, not by routes:

- `CatalogManager`: starting a connection from the catalog, refused at the first step.
- `SourcesManager.add`: storing a source.
- `SourcesManager`'s upload and conversion path: before any conversion work.

__`refuseWrite(ctx, what)`: account changes that would take the demo from everyone__ ([#514](https://github.com/jwilleke/yourphr/issues/514)). Called from [`src/server.ts`](../../src/server.ts) for:

- changing the password (it would stop matching the configured one, and nobody could enter the demo);
- signing out everywhere;
- deleting the account;
- setting an email address ([#792](https://github.com/jwilleke/yourphr/issues/792));
- trimming the access log;
- minting or changing an agent token;
- connecting or changing a device;
- adding, renaming or removing a passkey ([#876](https://github.com/jwilleke/yourphr/issues/876)).

The demo patient __can__ still add and edit records by hand. That is the product being demonstrated, and a reset puts the baseline back.

__`refuseUnlessRead(ctx, method, path)`: the demo admin changes nothing__ ([#644](https://github.com/jwilleke/yourphr/issues/644)). This one is not called route by route. The request guard in [`src/server.ts`](../../src/server.ts) calls it on every `/api/secure/*` request:

- __Default-deny by method.__ Anything other than `GET` or `HEAD` is refused. A route added next year is refused without anyone remembering to list it. The allow-list `READ_ONLY_WRITES` is empty, and an entry there needs a reason beside it.
- __Some reads are refused too.__ `DENIED_READS` holds `/api/secure/admin/config/reveal/`, because read-only is not the same as harmless: revealing a configured secret is a read.

### The baseline

[`scripts/build-demo-baseline.ts`](../../scripts/build-demo-baseline.ts) builds `app.db` and `records.db` during the image build ([`Dockerfile`](../../Dockerfile)), so what ships is reproducible and nobody hand-curates a database strangers will read.

- __Everything is synthetic.__ It comes from the same deterministic, PHI-free corpus CI uses: one patient over 30 months, about 114 resources across nine types.
- __It goes through the ordinary sync path:__ a source is connected to a local FHIR server over the corpus, and the worker imports it. Writing rows straight into the database would build a baseline no code path could produce.
- __It holds no working password.__ The demo password is provisioned at startup.
- __It is plaintext,__ because it ships in a public image (see the reset's encryption refusal).
- The build fails if the sync produced no records: an empty demo is the bug this exists to prevent ([#494](https://github.com/jwilleke/yourphr/issues/494)).

### The reset

`applyDemoReset` in [`src/app/providers/demo-reset.ts`](../../src/app/providers/demo-reset.ts) puts the baseline back at startup, so resetting the demo is a restart, and an image bump does it with no operator present ([#645](https://github.com/jwilleke/yourphr/issues/645)).

__Armed three ways.__ All must hold:

1. `yourphr.demo.enabled`
2. `yourphr.demo.reset-on-restart`
3. `yourphr.demo.baseline.dir` holds a baseline. No baseline, nothing destroyed.

__Then it must prove what it is about to destroy.__ Every account in the existing database must be the demo patient, the demo admin or the bootstrap admin. One unrecognised account and the reset is refused, and the instance starts normally with its data intact. A production instance that somehow arrives here misconfigured must survive.

__Refused outright on an encrypted database.__ The baseline is plaintext; installing it over an instance with a key would leave databases the app cannot open. The demo deployment therefore runs with no encryption keys.

It lives among the providers because it opens the database file directly, and the database driver belongs to providers ([#609](https://github.com/jwilleke/yourphr/issues/609)). It is a function, not a manager, because it runs before the engine exists. `app-custom-config.json` is not touched, so settings survive a reset.

## Deployment

`demo.yourphr.org` runs from `apps/production/demo-yourphr-ts/` in `jwilleke/mj-infra-flux`, namespace `demo-yourphr`.

- __Same image as production.__ It follows releases through the shared `flux-system:yourphr` image policy; see [`docs/deployment/deployment-contract.md`](../deployment/deployment-contract.md).
- __No encryption keys,__ because the reset refuses an encrypted database. Its records are synthetic only.
- __Its own PVC.__
- __Settings are on the volume,__ in `config/app-custom-config.json`, set through Admin → Configuration. Environment variables carry only bootstrap values and secrets: the relay secret comes from the `demo-yourphr-relay` Secret.

Relay settings for the demo, set in Admin → Configuration by the operator:

- `yourphr.relay.public-url`: `https://demo-relay.yourphr.org`
- `yourphr.relay.url`: `http://demo-yourphr-relay.demo-yourphr.svc:8080`

## Tests

| What | Where | Run |
|---|---|---|
| `DemoManager` unit tests: inert by default, provisioning and drift, every sign-in refusal, `refuseConnect`, the `refuseWrite` set, the admin tour, default-deny | [`src/app/managers/__tests__/DemoManager.test.ts`](../../src/app/managers/__tests__/DemoManager.test.ts) | `npm test` |
| Over the wire: inert install, empty-body sign-in, connect refused at the door, admin tour and banner flag, account writes refused, rate limit | [`scripts/app-tests.ts`](../../scripts/app-tests.ts) (the "demo mode" section) | `npm run app` |
| The reset's refusals on real database files: a foreign account, an encrypted database, a missing baseline | [`scripts/demo-reset-tests.ts`](../../scripts/demo-reset-tests.ts) | `npm run demo-reset` |
| The baseline builds | [`.github/workflows/server-ci.yaml`](../../.github/workflows/server-ci.yaml) | CI, every push |

There is no Playwright journey for demo mode yet.

## Adding a feature: the demo checklist

When you add a route or a capability, answer these before merging:

1. __Does it write?__ The demo admin is already refused by the guard; nothing to do unless it must be allowed, in which case add it to `READ_ONLY_WRITES` with a reason.
2. __Does it bring outside data into an account__ (a connection, an import, an upload, a device)? Call `refuseConnect(ctx)` in the __manager__ that owns it, not in the route.
3. __Could the demo patient use it to take the demo from the next visitor__ (credentials, sessions, the account itself, contact details, keys)? Call `refuseWrite(ctx, '<what, in words>')` and add the case to the `refuseWrite` test in `DemoManager.test.ts`.
4. __Is it a read that reveals a secret?__ Add its prefix to `DENIED_READS`.
5. __UI:__ disable the control for `demo_account` (or hide it for the demo admin) so a visitor is not offered an action the server refuses. The server rule comes first; the UI only mirrors it.
6. __Does it add an account or data the reset's proof should know about?__ Update `allowedAccounts` in [`src/app.ts`](../../src/app.ts) and the baseline build.

## Known gaps

Found while writing this guide; check each before relying on the behaviour it describes.

- __Sessions survive a reset.__ The reset's header comment, and the `_comment_demo_reset` config entry, say every restart ends every session because the session key is generated at boot. Since [#815](https://github.com/jwilleke/yourphr/issues/815) the key is kept in `.env`, so a token minted before a reset stays valid afterwards. Harmless for the demo patient (same account name); the comments are wrong either way.
- __The operator's admin password on a resetting demo is unknown.__ The baseline is built through `assembleApp`, whose `bootstrapAdmin()` creates `admin` on the empty build database and writes its password into the build directory, which the build then deletes. So the shipped baseline has an `admin` whose password nobody has, and a reset restores it at every restart. The only way in is the `reset-password` CLI ([`src/cli/reset-password.ts`](../../src/cli/reset-password.ts)), and the next restart undoes that.
- __The passkeys card offers "Add a passkey" to the demo patient.__ The server refuses it and the interceptor shows a toast, but the card does not yet check `demo_account`.
- __Provisioning runs only at startup.__ Turning demo mode on in Admin → Configuration, or creating the `demo` account, takes effect after a restart, and nothing says so. See [#885](https://github.com/jwilleke/yourphr/issues/885).
- __No E2E journey.__ See Tests.
- __Stale `jwilleke/mj-infra-flux` comment.__ The demo Deployment's header says it has "NO image-automation marker yet"; it now carries one and follows releases.

## History

- The Go stack had a demo: `pkg/demo`, an auth handler and a middleware, with `demo.*` keys, a `bootstrap.seed.restore` flag and a seeded `demo123` password ([#495](https://github.com/jwilleke/yourphr/issues/495), [#515](https://github.com/jwilleke/yourphr/issues/515), [#516](https://github.com/jwilleke/yourphr/issues/516), [#518](https://github.com/jwilleke/yourphr/issues/518)).
- The TypeScript port folded those three pieces into one manager ([#643](https://github.com/jwilleke/yourphr/issues/643) entrance and restriction, [#644](https://github.com/jwilleke/yourphr/issues/644) admin tour, [#645](https://github.com/jwilleke/yourphr/issues/645) baseline and reset, [#646](https://github.com/jwilleke/yourphr/issues/646) the deployment).
- ngdpbase's demo ([`docs/demo/demo-plan.md`](https://github.com/jwilleke/ngdpbase/blob/master/docs/demo/demo-plan.md)) is a different design: an add-on with anonymous reading and magic-link sign-up. It has nothing yourPHR's shared-account demo can adopt as-is.
