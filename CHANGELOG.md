# Changelog

## [2.10.2](https://github.com/jwilleke/yourphr/compare/v2.10.1...v2.10.2) (2026-08-20)

Security patch — no features, no behavior changes.

### Bug Fixes

- __security: the Go runtime and its extended libraries are patched__ ([#575](https://github.com/jwilleke/yourphr/issues/575)). The backend was built on a Go toolchain carrying 24 published vulnerabilities its code actually reaches — including the HTTP server and TLS stack this app fronts the internet with. Toolchain moved to go1.26.6, `golang.org/x/image` and `golang.org/x/net` updated, and `golang.org/x/crypto`, `x/oauth2`, `x/mod` merged from dependency PRs. `govulncheck` now reports __zero__ vulnerabilities affecting the code.

## [2.10.1](https://github.com/jwilleke/yourphr/compare/v2.10.0...v2.10.1) (2026-08-20)

An instance that cannot make backups now says so, everywhere an operator could learn it.

### Bug Fixes

- __A default install has no backups — and now it tells you__ ([#545](https://github.com/jwilleke/yourphr/issues/545)). Encryption at rest is on by default, and backups are refused while encryption is on (a backup would be written unencrypted). Both choices are right; together they meant a stock install had __no backup path at all__, silently. The condition is now announced at every startup (`BACKUPS UNAVAILABLE` in the log), as a persistent warning on the Admin → Database page, and as a caveat under the Encryption badge — which used to present as pure good news. Making encrypted backups work is tracked in [#461](https://github.com/jwilleke/yourphr/issues/461); until then, keep an external copy of the data volume.

### Changes

- __Backup settings now live in the configuration system__ ([#545](https://github.com/jwilleke/yourphr/issues/545)). The Admin Database card's schedule, destination and retention save into the same configuration store as every other setting — visible in Admin → Configuration, applied without a restart. Settings previously kept in a private `.backup_settings.json` file migrate in automatically on first start; nothing is lost and nothing needs re-entering.

## [2.10.0](https://github.com/jwilleke/yourphr/compare/v2.9.0...v2.10.0) (2026-08-19)

You can now see who has looked at your records, and a provider connection that used to quietly expire every half hour now stays connected.

### Features

- __An access log you can read__ ([#563](https://github.com/jwilleke/yourphr/issues/563)). Account Profile now shows everyone who has viewed or exported records in your account — who, what kind of record, which day, how many times, and when last. The list is complete and unedited; reading it is not itself recorded, and YourPHR deliberately stores no network addresses or device fingerprints — identity and time answer the question that matters: *has anyone else been in my record?*

### Bug Fixes

- __Epic connections stay connected__ ([#408](https://github.com/jwilleke/yourphr/issues/408)). Epic never issues refresh tokens to the kind of app YourPHR was registered as, so every Epic connection silently died about 30 minutes after logging in and needed a fresh login to sync again. The app registration is now a confidential client — the kind Epic does refresh — and the operator supplies the client secret in Admin → Provider Catalog. Verified live: the half-hourly *"no refresh token is available"* warning is gone and every refresh now succeeds.
- __security: email headers cannot be forged through the recipient field__ ([#549](https://github.com/jwilleke/yourphr/issues/549)). A line break typed into an email address could have been interpreted as the start of a new mail header. Addresses with line breaks are now refused outright.

### Notes for operators

- __Epic sandbox needs its client secret once.__ After upgrading, open Admin → Provider Catalog → Epic (Sandbox) and set the client secret from your Epic app registration (now a confidential client), then reconnect the source once. Without it, Epic token exchange fails.

## [2.9.0](https://github.com/jwilleke/yourphr/compare/v2.8.1...v2.9.0) (2026-08-15)

Your records can now leave the app in a form somebody else can use — emailed, or downloaded as a file another health system can import.

### Features

- __Send your records by email__ ([#524](https://github.com/jwilleke/yourphr/issues/524)). The button existed and did nothing except navigate you back to the dashboard. It now emails your record summary to an address you choose.

  It asks before it sends, and says what matters plainly: __email is not private and cannot be taken back__ — the file has no password, and a copy stays in the recipient's mailbox, and with their email provider, indefinitely. Send it only to someone you would hand a paper copy of your records.

  Nothing is sent until an administrator configures email on the instance; until then the button explains that rather than failing obscurely. See [`docs/admin/email-setup.md`](docs/admin/email-setup.md).

- __Get your records as a file a doctor's office can import__ ([#523](https://github.com/jwilleke/yourphr/issues/523), [#524](https://github.com/jwilleke/yourphr/issues/524)). Both __Save Report__ and __Send to Email__ now offer a choice: a document to read or print, or a __FHIR file__ — the standard format health record systems read directly.

  A PDF proves you can *see* your records. The FHIR file is what lets you *take them somewhere else*, which is the harder half and the point of the law this project exists to fulfil. The data was always there; there was no way to get it out except by calling the API by hand.

- __Outbound email, configured once__ ([#536](https://github.com/jwilleke/yourphr/issues/536)). One mail setup shared by everything that needs to send. Off by default, and with no relay configured a message is written to the log rather than failing — so a fresh instance never sends anything and never breaks trying. Design adapted from the same author's ngdpbase.

### Bug Fixes

- __Downloaded files are named for you, not for the software.__ A saved report arrived as `ips_summary.pdf`; it is now `yourphr-records.pdf`, which is findable in a Downloads folder six months later.

### Notes for operators

- __Email requires setup before it does anything.__ Set `mail.enabled` and the relay details in Admin → Configuration. Mail sent directly from a home connection is usually discarded as spam, so in practice this points at a relay you already have — a Gmail App Password, Resend, SendGrid, or your own server. [`docs/admin/email-setup.md`](docs/admin/email-setup.md) covers each, along with the SPF/DKIM/DMARC records needed to send from your own domain.
- __The mail password is treated as a secret__ — masked on the configuration screen, redacted from logs, never sent to a browser.
- __Sending is limited to five reports per hour per account__ and is blocked for the shared demo account. An address that can email arbitrary files to arbitrary people needs a limit.
- __Certificates are always verified.__ There is no option to skip that check, deliberately: this channel carries medical records.

## [2.8.1](https://github.com/jwilleke/yourphr/compare/v2.8.0...v2.8.1) (2026-08-14)

Finishes what 2.8.0 started: claims and benefit statements are readable in the record lists too, and the app stops showing you the technical names for your own records.

### Bug Fixes

- __Claims and benefit statements now display in the record lists__ ([#521](https://github.com/jwilleke/yourphr/issues/521), [#522](https://github.com/jwilleke/yourphr/issues/522)). 2.8.0 taught them to display when you opened one, but the list you arrive at still said *"YourPHR does not know how to display this resource type (yet)"* above a column of identifiers. The list and the detail view are built separately and only one of them had been taught. Both lists now show what was billed, by whom, when, and for how much.

### Changes

- __Your records are described in plain words, not standards jargon__ ([#262](https://github.com/jwilleke/yourphr/issues/262)). The app was showing the interoperability standard's own names for things — `ExplanationOfBenefit`, `DiagnosticReport`, `MedicationRequest` — in nine places, including the record lists and page headings. They now read as __Insurance statement__, __Test report__ and __Prescription__.

  Prescriptions, medications you are taking, and medications a pharmacy dispensed stay named apart rather than all becoming "Medication": those are three different facts, and merging them would say something your record does not.

  A record type the app has no plain name for is spelled out as words rather than shown as jargon — nothing is guessed at.

## [2.8.0](https://github.com/jwilleke/yourphr/compare/v2.7.1...v2.8.0) (2026-08-14)

Insurance claims are readable instead of refused, your record can be saved to a file, and several screens stopped disagreeing with each other.

### Features

- __Insurance claims and benefit statements now display__ ([#521](https://github.com/jwilleke/yourphr/issues/521), [#522](https://github.com/jwilleke/yourphr/issues/522)). Both previously showed *"YourPHR does not know how to display this resource type (yet)"* and offered raw JSON — on the two documents whose whole purpose is to say what was billed and what you owe.

  An __explanation of benefits__ leads with the money, in ordinary words: *Amount billed*, *Paid by insurance*, *Applied to your deductible*, rather than the payer's `submitted` / `benefit` / `deductible`. Amounts the app does not recognise keep the payer's own wording instead of vanishing, and the currency comes from the record rather than being assumed.

  A __claim__ says plainly what it is: a bill your provider sent to your insurance, and *not* a statement of what you owe. People receive both documents for the same visit and reasonably assume both are bills. Its total is labelled *Amount claimed*, and no balance is calculated, because the record does not state one.

- __Save Report__ ([#523](https://github.com/jwilleke/yourphr/issues/523)) downloads your record as a single file you can open, print or keep. The button previously did nothing except navigate you back to the dashboard, losing the page you were reading.

  It asks first, and says what matters: the file has no password and no expiry, so anyone who can open it — or the backup it ends up in — can read your health information. Save it where you would keep a paper copy.

### Bug Fixes

- __The dashboard no longer overstates how many practitioners you have__ ([#525](https://github.com/jwilleke/yourphr/issues/525)). The tile counted practitioners, organizations and care teams together but opened a page listing practitioners only, so it could read 40 and deliver 6. A number on a tile is a promise about what you will find when you click it.

- __Practitioner names read consistently__ ([#525](https://github.com/jwilleke/yourphr/issues/525)). The list showed each name exactly as its source system wrote it, so "Smith, John" sat beside "John Smith" in the same table. Names are now built from the structured parts every provider sends.

- __One way to see the original record, in one place__ ([#526](https://github.com/jwilleke/yourphr/issues/526)). Two screens had grown separate versions of this — a checkbox labelled "Enable Debug mode" inside a warning box on one, a "Show raw FHIR" button in the opposite corner on the other. Both now show __Show raw data__ below the record. Looking at your own record in its original form is a normal thing to do, not a developer setting, and the warning styling has gone with the name.

- __A missing detail no longer breaks a record card.__ Any record lacking an optional linked item — a provider, an organization — could fail to display at all. Affected every record type; it simply needed data with a gap to show it.

- __Benefit statements from some insurers were missing their dates and claim numbers.__ The app only read those fields when the insurer labelled the record in one particular way. Every insurer sends them; not all label it.

### Notes

- __Send to Email is still not available__ ([#524](https://github.com/jwilleke/yourphr/issues/524)) and now says so instead of quietly navigating away. Sending a complete medical record by email hands it to third-party mail servers permanently, so it needs a deliberate decision about how — the options are written up on the issue.

## [2.7.1](https://github.com/jwilleke/yourphr/compare/v2.7.0...v2.7.1) (2026-08-14)

A cryptography library in the browser bundle was three years behind on security fixes, and the usual alerting could not see it.

### Bug Fixes

- __security: the bundled crypto library is patched__ ([#530](https://github.com/jwilleke/yourphr/issues/530)). YourPHR ships a WebCrypto polyfill so that browsers without built-in cryptography — which includes any browser served over plain HTTP rather than HTTPS — can still complete the secure handshake when connecting to a provider. That polyfill depended on a __copy of `elliptic` frozen at version 6.5.0__, taken from a personal fork rather than the official release, so none of the security fixes published since ever reached it. Three advisories applied, the most serious rated __critical__.

  It went unreported because the dependency is fetched from a source-code URL rather than the package registry, and automated alerting matches advisories by registry name. The alerts page read clean the entire time. Routine auditing is what surfaced it.

  The build now takes the patched official release (6.6.1) in place of the fork. Nothing changes in how the application behaves.

### Changes

- __`lforms` 42 → 43__ and __`ng2-charts` 6 → 9__ — questionnaire rendering and charts. Verified against the full browser test suite as well as the unit tests, since both are display components that unit tests barely exercise.
- __`gorm.io/driver/postgres` 1.6.0 → 1.6.2.__

### Notes for operators

- No action required, and no configuration changes. If you set `web.trusted_proxies` after upgrading to 2.7.0, that setting is unaffected.

## [2.7.0](https://github.com/jwilleke/yourphr/compare/v2.6.2...v2.7.0) (2026-08-13)

A client could tell YourPHR what its own IP address was, and be believed. __If you run behind a reverse proxy, this release needs one setting from you__ — see the operator note below.

### Features

- __auth: `web.trusted_proxies` decides whose forwarding headers are believed__ ([#529](https://github.com/jwilleke/yourphr/issues/529)). The server never told its HTTP framework which proxies to trust, and that framework's default is to trust *all* of them — so `X-Forwarded-For` and `X-Real-IP` were honoured from any caller, and the address they named became the client's identity.

  That address is what the sign-in rate limiter counts against ([#104](https://github.com/jwilleke/yourphr/issues/104)). Sending a different one on each attempt started a fresh count every time, so the limit never triggered and online password guessing was unthrottled from a single machine. The per-account limit added in [#509](https://github.com/jwilleke/yourphr/issues/509) still applied, so a sustained attempt against __one__ account was always covered; what was not covered is an attempt spread across many usernames.

  The header was honoured whether or not a proxy existed, so this applied to any directly reachable instance — port-forwarded, tunnelled, or on the LAN — not only to proxied ones.

  The new setting lists the proxies whose headers may be believed. It defaults to __empty, meaning trust nothing__: the client's address is the connection it actually came from, and headers claiming otherwise are ignored. A malformed entry is logged and leaves the server trusting nothing, so a typo cannot quietly restore the old behaviour.

### Notes for operators

- __Behind a reverse proxy (including the k3s ingress), set `web.trusted_proxies` after upgrading__, in Admin → Configuration — typically `10.42.0.0/16` for a k3s pod network, or the gateway address for docker. Until you do, the app sees every request as coming from the proxy, so all users share one rate-limit bucket and a busy household can throttle itself. Nothing is unsafe in the meantime; the limit simply applies too broadly.
- __Directly reachable instances need no change.__ The default is already correct, and is now genuinely enforced.
- No default names a specific network. Guessing a deployment's topology in a shipped default is how an instance ends up trusting a network it is not on.

## [2.6.2](https://github.com/jwilleke/yourphr/compare/v2.6.1...v2.6.2) (2026-08-13)

Changing your password did not end a stolen session, on every account older than the release that promised it would. __Upgrading is strongly recommended__, and it signs nobody out.

### Bug Fixes

- __auth: a password change now really does end every other session__ ([#528](https://github.com/jwilleke/yourphr/issues/528)). The revocation counter added in 2.6.0 was `NULL` — not `0` — on every account that already existed when that version was installed, because adding an integer column leaves existing rows empty rather than zero. Incrementing it computed `NULL + 1`, which in SQL is `NULL`, so the counter never moved. The database reported the write as successful, nothing was logged, and an empty counter reads back as `0` — the same value every already-issued token carries. The check that ends a stolen session compares the two and found them equal, so __the session survived__.

  Everything built on that counter was affected: password change, an admin resetting someone's password, the `fasten reset-password` CLI, and __Sign out everywhere__. Each reported success and ended nothing. Accounts created *after* 2.6.0 were never affected, which is why this survived a green test suite — every test built its user the one way that cannot reproduce it.

  This release backfills the counter and hardens the arithmetic so an empty value can never silently swallow a write again. The backfill restores what 2.6.0 intended, so __no one is signed out by upgrading__. Sessions still in flight from before the upgrade remain valid — end them deliberately with __Sign out everywhere__ if you have reason to.

- __admin: Sign-ins now counts__ ([#528](https://github.com/jwilleke/yourphr/issues/528)). The same defect hit the sign-in counter from 2.6.0: Admin → Users showed a real __Last sign-in__ beside __Sign-ins: 0__, and it stayed at 0 no matter how often the account signed in. The timestamp is written directly so it was always right; only the count was lost. Counting starts from 0 on upgrade — history before this release was never recorded and is not invented.

## [2.6.1](https://github.com/jwilleke/yourphr/compare/v2.6.0...v2.6.1) (2026-08-13)

When the app refused an action, it told you nothing — and in one case reported a crash instead of the refusal. Both found on the live demo.

### Bug Fixes

- __ui: a refused action reports why it was refused__ ([#527](https://github.com/jwilleke/yourphr/issues/527)). The interceptor was registered with an explicit `deps` list that had gone stale against its own constructor, so the toast service was `undefined` in every shipped build — no refusal has ever produced a notification. Worse, the resulting `TypeError` was raised *while handling* the error and propagated in its place, so pressing __Delete__ on Admin → Provider Catalog as the read-only demo admin reported `Cannot read properties of undefined (reading 'show')` rather than the server's explanation.

  An explicit `deps` array replaces a class's own injection metadata, which is why it went stale silently; it is gone. Reporting is now wrapped so it can never again replace what it is reporting, and that contract is pinned by a test rather than by care.

- __ui: downloads report refusals too__ ([#527](https://github.com/jwilleke/yourphr/issues/527)). A download asks for a `blob` response, and Angular applies that to the *error* body as well — so the server's JSON arrived as a `Blob`, every check against it silently failed, and __Download backup__ showed `Download failed — check the server logs.` to a demo visitor who has no server logs. Error bodies are now decoded whatever the request asked for, and the page says what the server said. Affects all three download endpoints.

- __ui: a refusal notification no longer disappears by itself.__ Five seconds is long enough to miss entirely, after which the app simply looks broken.

## [2.6.0](https://github.com/jwilleke/yourphr/compare/v2.5.2...v2.6.0) (2026-08-12)

Account security, end to end: a password change now actually ends a stolen session, passwords have rules the server enforces, sign-ins are throttled per account as well as per address, and there are two ways to recover an account nobody can get into.

### Features

- __auth: a password policy that lives in configuration and is enforced by the server__ ([#506](https://github.com/jwilleke/yourphr/issues/506)). The only backend check was previously "not blank", so a one-character password was accepted through the API while three browser forms enforced three different rules that also contradicted their own error messages. Minimum and maximum length, a breached-password check, and a rule against containing your own username are now settings, applied at sign-up, admin user-create and change-password — and published so the sign-up form validates exactly what the server accepts.

  Not applied at sign-in, deliberately: an account created before the policy existed must still be able to get in. No composition rules ("one uppercase, one digit") — NIST SP 800-63B advises against them.

- __auth: session tokens can be revoked__ ([#508](https://github.com/jwilleke/yourphr/issues/508)). Session JWTs were stateless, so changing your password after a session was stolen left the thief signed in until their token expired — the one action a user takes after a compromise did nothing. A per-user counter, carried as a claim, now makes a password change end every other session, and adds __Sign out everywhere__ to Account Profile. Deploying this signs nobody out.

- __auth: sign-ins are throttled per account, not only per IP address__ ([#509](https://github.com/jwilleke/yourphr/issues/509)). Per-address limiting never sees a slow distributed attempt against one account, and makes a household throttle itself when everyone shares one connection. Only failures count, so a busy account is never throttled for being busy.

- __cli: `fasten reset-password`__ ([#510](https://github.com/jwilleke/yourphr/issues/510)), for when nobody can sign in at all. There is no password-reset flow in this product — no reset route, no email — so recovery previously meant generating a bcrypt hash by hand and editing the database. The command generates a password, writes it to a file only the operator can read, and prints the path rather than the value.

- __users: an admin can set another user's password__ ([#511](https://github.com/jwilleke/yourphr/issues/511)) from Admin → Users — the family case, where somebody simply forgot theirs. Generated rather than typed by the admin, shown once, and it ends that account's existing sessions.

- __users: `last_login` and `login_count`__ ([#512](https://github.com/jwilleke/yourphr/issues/512)), so an admin can tell a live account from an abandoned one and a patient can answer "has anyone else been in my record?". __No IP address and no user-agent are recorded__ — on a product whose premise is that nobody else holds your data, keeping a log of your household's own addresses would need a retention policy and a privacy decision of its own.

- __admin: Admin → Users becomes usable__ ([#513](https://github.com/jwilleke/yourphr/issues/513)) — search, summary cards, real columns, an empty state, and per-row actions. It was a four-column read-only table with no actions of any kind.

### Bug Fixes

- __ui: being refused an action no longer ends your session__ ([#520](https://github.com/jwilleke/yourphr/issues/520)). A `403` was treated exactly like a `401`, so pressing a button you were not entitled to press destroyed a perfectly valid session and returned you to the sign-in page. Reported from the live demo.
- __auth: sign-up says why it refused a username__ instead of "an unknown error occurred". A reserved name answered `500`, so the one failure with a clear explanation was the one nobody was told about — and `admin` is what most people type first.
- __auth: a reserved username is allowed for an account the instance PROVISIONS__ ([#519](https://github.com/jwilleke/yourphr/issues/519)). The deny-list guards self-service registration, where a stranger picks the name; it was also refusing `admin` for accounts an operator configures, so no deployment could have an admin called `admin`.

### Notes for operators

__Nothing to do.__ Every new setting ships with a working default, no session is invalidated by upgrading, and no configuration becomes required.

__If you run an internet-facing instance,__ the two worth knowing about are `password.min_length` (raise it if you want) and `web.rate_limit.auth_per_account_per_minute`. Both are documented in [`docs/deployment/README.md`](docs/deployment/README.md).

__If you have ever been locked out,__ `fasten reset-password --username <name>` is now the answer, and it needs no database surgery.

## [2.5.2](https://github.com/jwilleke/yourphr/compare/v2.5.1...v2.5.2) (2026-08-12)

Being refused an action no longer ends your session.

### Bug Fixes

- __ui: a `403` logged you out and returned you to the sign-in page__ ([#520](https://github.com/jwilleke/yourphr/issues/520)). The HTTP interceptor treated `403` exactly like `401`, but they are different answers: the backend returns `401` only when it cannot identify the caller, and `403` when it can and the answer is still no. So a valid session was destroyed for pressing a button the account was not entitled to press — pressing __Connect__ as the public demo's read-only admin ended the session, and any non-admin reaching an admin-gated route had the same experience.

  It also swallowed the error in a way that completed the request as a *success*, so the calling screen's error handler never ran and could not report the reason. That is why it looked like a flash of something rather than a message.

  `401` still signs you out. `403` now leaves you where you are, reaches the calling screen so it can react, and — for the public demo's refusals — shows what the server actually said.

### Notes for operators

__Nothing to do.__ No configuration or API change; a session that was valid before is still valid.

## [2.5.1](https://github.com/jwilleke/yourphr/compare/v2.5.0...v2.5.1) (2026-08-12)

You can call your admin account `admin`, and sign-up finally tells you when it refuses a username.

### Changes

- __auth: a reserved username is now allowed for an account the instance PROVISIONS__ ([#519](https://github.com/jwilleke/yourphr/issues/519)). `admin`, `administrator`, `root`, `system` and a dozen others were refused for *every* account, so no deployment could have an admin called `admin` — the first name every operator tries. The deny-list is documented as protecting __user registration__ from phishing and confusion attacks (a stranger registering `admin` and then messaging other users as though they were staff), and that needs the attacker to choose the name. `bootstrap.admin.username` and `demo.admin.username` are set by the operator, so the list was costing something and buying nothing there.

  Self-service sign-up is __unchanged__ — registering as `admin` is still refused, as is creating one from Admin → Users. Only provisioning is exempt, through a separate repository entry point, so a user-creating path added later inherits the guard rather than silently skipping it.

### Bug Fixes

- __auth: sign-up answered `500` when it refused a username__, which the sign-up page renders as "an unknown error occurred during sign-up" — so the one failure with a clear explanation was the one nobody was told about, and `admin` is what most people type first. It now answers `400` with the reason, and both sign-up screens display what the server said.

### Notes for operators

__Nothing to do.__ If you already run an instance, no account changes and no name becomes invalid.

__If you are provisioning a new instance,__ `YOURPHR_BOOTSTRAP_ADMIN_USERNAME=admin` now works. Provisioning a reserved name is logged at INFO, so it appears in the record rather than happening quietly.

## [2.5.0](https://github.com/jwilleke/yourphr/compare/v2.4.0...v2.5.0) (2026-08-12)

A public demo now runs itself: no password anybody knows, an admin tour a stranger can take without being able to break anything, and a reset that is a restart.

### Features

- __demo:__ the demo sign-in credential is __generated per instance__ and known to nobody ([#515](https://github.com/jwilleke/yourphr/issues/515)). `POST /api/auth/demo-signin` never accepted credentials from the browser — the server verifies them — so the only thing a human-chosen password ever bought was the ability to type it at the login form, and it kept costing: a seed built with a seven-character password that our own form rejected, a collision with the password policy in [#506](https://github.com/jwilleke/yourphr/issues/506), and a credential published inside a public image. It is now generated at startup, rotated whenever it drifts from the stored hash, and never printed anywhere. A restored seed therefore heals itself with no operator step.

  The password __check__ deliberately stays: minting a token for whoever `demo.username` names would turn one mis-set flag into an auth bypass on any instance holding a user called `demo`.

- __demo:__ a __read-only demo admin__ ([#516](https://github.com/jwilleke/yourphr/issues/516)) — a second one-click entrance that can see Configuration, Users, Database and Logs and change nothing, so someone evaluating YourPHR can answer "what is it like to run one?" without an operator handing out a real credential. Read-only is enforced by the API and __default-deny__: reads are allowed, everything else is refused, and a route added in a future release is blocked by inheritance rather than by somebody remembering. Revealing a configured secret and browsing the server's directories are refused too — read-only is not the same as harmless. Off by default, and it requires demo mode as well.

- __demo:__ __deep links__ ([#517](https://github.com/jwilleke/yourphr/issues/517)). `/demo` and `/demo-admin` sign a visitor in and land them inside the product, so a demo can be shared as one link rather than as a login page with instructions. Inert on any instance that is not a demo.

- __demo:__ `demo.reset_on_restart` ([#518](https://github.com/jwilleke/yourphr/issues/518)) — the app reinstalls the demo database baked into its own image at startup, so resetting a public demo is a restart instead of a shell and an `rm`. This is the only code path in the product that deliberately destroys a live database, so it is armed by three settings together and then still has to __prove__ the database belongs to a demo: every account in it must be the demo, the demo admin, or the bootstrap admin, or the reset is refused and the instance starts normally with its data intact. Encrypted databases are refused outright. A reset also clears the cache and the generated JWT signing key, so sessions from before it end cleanly rather than pointing at users that no longer exist.

### Notes for operators

__Nothing to do.__ Every new setting defaults to off, and none of this runs on an instance that has not opted into demo mode.

__If you run a demo instance:__ stop setting `demo.password` — it is provisioned for you now, and any value you set is replaced the first time the account and the configuration disagree. The demo admin and the reset are separate opt-ins (`demo.admin.enabled`, `demo.reset_on_restart`); see [`docs/deployment/README.md`](docs/deployment/README.md).

## [2.4.0](https://github.com/jwilleke/yourphr/compare/v2.3.0...v2.4.0) (2026-08-11)

A demo instance can now rebuild itself from the image — and a bug is fixed that made two published settings read backwards for anyone configuring by environment.

### Features

- __demo:__ the release image can carry a __pre-built demo database__, which an instance installs on first start when its data directory is empty ([#505](https://github.com/jwilleke/yourphr/issues/505)). Resetting a demo becomes "delete the database, restart"; a fresh volume, or a rebuilt namespace, self-seeds with nobody at a keyboard. Off by default and demo-only — `YOURPHR_BOOTSTRAP_SEED_RESTORE=true` — because an ordinary install must never come up holding synthetic patient records.

  The seed is rebuilt __on every release__, so it always matches that release's schema, and it lives in the container registry rather than on one node's local disk. It contains the shared demo account and __no admin__: the image is public, so a baked admin credential would be a published one, identical on every deployment. Restoring therefore __refuses__ unless admin provisioning is also configured, rather than producing an instance that is populated, reachable, and administrable by nobody.

### Bug Fixes

- __api:__ `/api/instance/public` served booleans as __strings__ when they came from the environment, because environment variables are strings. Both directions failed silently: a demo configured that way never rendered its one-click sign-in (`"true"` is not `true`), and — the one that matters — an instance with __signup closed still advertised the sign-up link__, because `"false"` is not `false`. Values now arrive with the type their shipped default declares. Found by configuring a real instance entirely through the environment; no unit test would have caught it, because they set values through a typed config object.
- __bootstrap:__ admin provisioning ([#504](https://github.com/jwilleke/yourphr/issues/504), new in 2.3.0) triggered on "no users" and therefore never fired on an instance whose database already held a non-admin account — leaving it with users, no administrator, and the first-run wizard suppressed precisely because users exist. It now triggers on the absence of an __admin__, so it is the answer to that state rather than a bystander to it. It also refuses to adopt an existing account that happens to share the configured name, which would otherwise be a privilege-escalation path dressed as convenience.

### Notes for operators

__Nothing to do.__ Both new settings default to off, and the seed the image carries is inert unless a deployment asks for it.

__If you configure by environment and publish settings,__ the API fix is worth knowing about: an instance with `YOURPHR_SIGNUP_ENABLED=false` was still showing "Create an Account" on the sign-in page before this release. The gate itself was always enforced server-side, so no account could actually be created — the link simply lied.

## [2.3.0](https://github.com/jwilleke/yourphr/compare/v2.2.1...v2.3.0) (2026-08-11)

An internet-facing instance can now own itself from the first second, instead of racing whoever loads the page first.

### Features

- __bootstrap:__ an instance can __provision its own admin at startup__, so a deployment needs nobody at a keyboard ([#504](https://github.com/jwilleke/yourphr/issues/504)). Set `YOURPHR_BOOTSTRAP_ADMIN_ENABLED=true` and `YOURPHR_BOOTSTRAP_ADMIN_USERNAME=owner`; __you do not supply a password.__ The app generates one, writes it `0600` to `<data root>/.admin_bootstrap_password`, and logs the path — never the value. Read it once with `docker compose exec … cat` or `kubectl exec … cat`, store it, and it deletes itself the moment that admin first signs in.

  This closes a real hole rather than a theoretical one. The first account on an empty database becomes the admin, and the app decides that by __counting users__ — it cannot tell the operator from a stranger. On any host reachable before you have signed up, whoever arrives first owns the instance. Off by default, so a stock install still shows the first-run wizard and the human still becomes owner.

- __demo:__ the shared public-demo account is now __barred from connecting providers or uploading records__ ([#496](https://github.com/jwilleke/yourphr/issues/496)). Every visitor to a demo shares one login, and connecting is an ordinary user action — so without this, a visitor could authorize their own real Medicare or Epic account into that shared login and the next visitor would read their claims. Enforced server-side on all six routes that bring outside data in, because a disabled button is not a control. The Sources page explains why the controls are greyed rather than hiding them.

### Notes for operators

__Nothing to do.__ Both features are off by default and no existing behaviour changed.

__If your instance is reachable from the internet,__ bootstrap provisioning is worth adopting: it removes the window in which an anonymous visitor can claim ownership of a fresh install. See the first-run section of [`docs/deployment/README.md`](https://github.com/jwilleke/yourphr/blob/main/docs/deployment/README.md).

__Pick a username that is not reserved.__ `admin`, `administrator`, `root`, `system`, `support`, `api` and similar are refused to blunt phishing and confusion attacks; provisioning tells you so at startup instead of failing obscurely.

__One caveat worth knowing:__ the generated-password file lives in the data root, which is exactly what a backup contains. It deletes itself on first sign-in, so only a backup taken before you ever log in can carry it.

## [2.2.1](https://github.com/jwilleke/yourphr/compare/v2.2.0...v2.2.1) (2026-08-11)

A throttled sign-in no longer claims your password is wrong.

### Bug Fixes

- __auth:__ hitting the sign-in rate limit was reported as __"username or password is incorrect"__ ([#481](https://github.com/jwilleke/yourphr/issues/481)). The credential may be perfectly good, so the user retries — which extends the window they are locked out for. Now: *"too many sign-in attempts — wait a minute and try again"*.
- __auth:__ `POST /api/auth/logout` no longer counts against that limit. It carries no credential and reveals nothing, so it was never a guessing surface, and its failure mode was backwards — a rate-limited logout leaves the session cookie in place, i.e. the limiter kept you signed in.
- __e2e:__ the test harness silently attached to any backend already listening on `:9191`, including one holding an unrelated database, so its clean-database guarantee quietly did not hold and the resulting failures pointed at the application ([#481](https://github.com/jwilleke/yourphr/issues/481)). It now refuses, names the port, and says how to free it. The same investigation found that the suite's intermittent login failure was __the rate limiter, not a flake__ — ~16 auth calls from one IP against a cap of 10.
- __deps:__ hono `4.12.32` → `4.13.1`, clearing three Dependabot advisories in the frontend build chain ([#503](https://github.com/jwilleke/yourphr/issues/503)). Build tooling only — it never reaches a running instance.

### Notes for operators

__Nothing to do.__ The rate limit still defaults to 10 attempts per minute per IP; only the message and the logout exemption changed.

__New setting, only if you need it:__ `web.rate_limit.auth_per_minute` (default `10`) now makes that cap configurable in Admin → Configuration. It is a brute-force backstop rather than a throughput setting — raise it for an instance driven by an automated suite, and leave it alone in production. Note the limiter keys on the client IP as reported by `X-Forwarded-For`, so behind a reverse proxy without trusted-proxy configuration, every client can share a single bucket.

## [2.2.0](https://github.com/jwilleke/yourphr/compare/v2.1.2...v2.2.0) (2026-08-11)

An instance can now close self-service signup, and the status-badge fix from 2.1.2 finally reaches the screens it was reported against.

### Bug Fixes

- __ui:__ status text was __still__ unreadable in light mode after 2.1.2 — on Medical Concerns, Medications, Allergies, Immunizations, Procedures, the provider catalog and the admin pages ([#486](https://github.com/jwilleke/yourphr/issues/486), reported and re-tested by __@thevoltagesource__). The 2.1.2 fix repaired the shared badge *component*; every screen in the report writes its badges by hand and was untouched. Those templates used `badge-secondary` and friends — __Bootstrap 4 class names that Bootstrap 5 removed__ — and a bare `.badge` is white text with *no background*, so it vanished on a white page and looked correct on a dark one. 52 sites across 18 files now use contrast-paired `text-bg-*` utilities.

### Features

- __auth:__ `signup.enabled` closes self-service account creation on an internet-facing instance ([#498](https://github.com/jwilleke/yourphr/issues/498)). Default `true`, so nothing changes unless you set it. __The first run is always exempt__ — with an empty user table, registration proceeds regardless and that account becomes the instance owner and admin, which is the only way an admin ever comes into existence. An operator still adds people from Admin → Users, so this removes self-service, not multi-user support.
- __demo:__ `demo.enabled` puts a one-click "Explore the demo" button on the sign-in page of a public demo instance ([#495](https://github.com/jwilleke/yourphr/issues/495)). Off by default. The demo password is configuration verified server-side by `POST /api/auth/demo-signin`, so it never reaches the browser, and the endpoint stays an ordinary sign-in rather than a password-less bypass. __Not yet safe to publish on a shared account__ — a visitor could still connect a real provider to it; that guard is [#496](https://github.com/jwilleke/yourphr/issues/496).

### Tests

- __ui:__ the badge contrast spec now measures the `text-bg-*` utilities in __both__ colour modes rather than light only ([#486](https://github.com/jwilleke/yourphr/issues/486)). A colour that passes in one mode and fails in the other is exactly how this shipped twice.
- __ci:__ `make lint-frontend` now fails the build on any Bootstrap 4 badge class anywhere in the frontend, naming the replacement. Type checkers, linters and code review are all blind to colour, and a reviewer in dark mode cannot see this class of bug at all — so it is checked by grep rather than by eyes.

### Documentation

- __deployment:__ a new section states plainly that __the first account created owns the instance__: it becomes the admin, it is the only route to an admin, and there is no password-reset flow. Also spelled out in the README's Logging In section, with the consequence that matters on a public host — register immediately, because the app decides by counting users, not by who you are.

### Notes for operators

__Nothing to do.__ Both new settings default to today's behaviour: `signup.enabled` is `true`, `demo.enabled` is `false`.

__If your instance is reachable from the internet,__ consider setting `signup.enabled` to `false` in Admin → Configuration. Anyone who can reach the sign-in page can currently create an account.

__@thevoltagesource:__ the badge fix is in this release — please re-check __in light mode__.

## [2.1.2](https://github.com/jwilleke/yourphr/compare/v2.1.1...v2.1.2) (2026-08-05)

Status badges are readable again, and the footer finally links the Terms it tells you to read.

### Bug Fixes

- __ui:__ status text was unreadable in both light and dark mode, across most lists — Medical Concerns, Medications, the admin provider list ([#486](https://github.com/jwilleke/yourphr/issues/486), reported by __@thevoltagesource__). Two independent causes, both now fixed and measured:
  - badge text is white by default, and five of the theme's seven variants were below WCAG AA behind it — `light` at __1.09:1__, effectively invisible. Every variant now uses a contrast-paired utility and lands between 4.53:1 and 19.26:1.
  - in dark mode a blanket `!important` colour on every `span` overrode that pairing, forcing every badge to 1.02–2.17:1 regardless of its background. That rule now excludes badges.
- __legal:__ the footer linked Privacy but not __Terms__, while the Privacy Policy links *to* the Terms — so a reader sent there had no way back ([#463](https://github.com/jwilleke/yourphr/issues/463))
- __legal:__ the Privacy Policy showed a literal `https://<your-instance>/contact` placeholder to a reader who is already on the instance. Now a working link that resolves under any path prefix ([#463](https://github.com/jwilleke/yourphr/issues/463))

### Tests

- __ui:__ contrast is now measured, not assumed. A new spec reads __computed__ styles from real elements in a real browser, in __both__ themes, and fails the build below WCAG AA. It caught the dark-mode bug above within minutes of being written — a check that parsed the stylesheet instead would have missed every one of these, because they come from `!important` interactions rather than from the utilities themselves ([#486](https://github.com/jwilleke/yourphr/issues/486))

### Documentation

- __recovery:__ recorded why CodeQL's 14 `go/path-injection` alerts on the backup destination are dismissed rather than fixed, and the conditions that would make that dismissal wrong — dismissed alerts are never re-raised by a later scan, so nothing else would remind you ([#488](https://github.com/jwilleke/yourphr/issues/488))

### Notes for operators

__Nothing to do.__ Purely visual and documentation fixes.

__If you have a custom theme,__ note that badge colours now come from contrast-paired utilities. Retuning a palette colour will fail the new contrast spec rather than silently shipping an unreadable badge — which is the intent.

## [2.1.1](https://github.com/jwilleke/yourphr/compare/v2.1.0...v2.1.1) (2026-08-05)

Fixes the Privacy Policy and Terms pages your instance actually serves.

### Bug Fixes

- __legal:__ the served `/privacy` and `/terms` pages carried three defects that only appeared in the rendered copy — the one patients read ([#463](https://github.com/jwilleke/yourphr/issues/463)):
  - the cross-link between the two documents pointed at a `.md` filename, which works when browsing GitHub and __404s on the served page__. It is now page-relative, so it resolves correctly on an instance served under a `web.listen.basepath` prefix as well as at the root.
  - a maintainer instruction — *"update `gh-pages` `privacy.html` when you change it"* — was being rendered to patients in the middle of a legal document. Moved to `backend/pkg/legal/README.md`.
  - trailing two-space hard breaks rendered as `<br>`, producing arbitrary mid-sentence line breaks in the header block.

### Documentation

- __recovery:__ a new [restore drill](https://github.com/jwilleke/yourphr/blob/main/docs/recovery/data-recovery.md). A backup you have never restored is not a backup — it is a file you hope is a backup. Covers what CI proves versus what only you can prove, a drill to run on a throwaway instance, and a success checklist that can be failed
- __recovery:__ all backup and recovery pages consolidated under `docs/recovery/`, with a hub table saying which of the three answers which question
- __docs:__ corrected two claims that had gone stale — that at-rest encryption is off by default (it has been __on__ since v2.0.0), and that `app-custom-config.json` is not covered by backups (it has been since v2.1.0)
- __docs:__ fixed twelve broken relative links across the docs tree

### Notes for operators

__Nothing to do.__ If you have opened `/privacy` or `/terms` on your instance and found the "Terms of Service" link dead, this fixes it.

__Both legal-document digests changed__, because the digest hashes the Markdown and the Markdown changed. Nothing depends on that today — consent pinning is [#465](https://github.com/jwilleke/yourphr/issues/465) and still open.

`Last updated` on both documents is deliberately unchanged: the wording of the policy did not change, and that date is what tells a reader whether they need to read it again.

## [2.1.0](https://github.com/jwilleke/yourphr/compare/v2.0.0...v2.1.0) (2026-08-05)

A backup now contains your instance, not just its database — and the SSRF guard on user-supplied FHIR URLs actually holds.

### Features

- __backup:__ a backup is the whole data root, not just the database. Restoring onto a fresh instance used to return the records and lose the operator contact, the theme, the backup schedule and any legal-document override — the instance came back as *records without identity* ([#467](https://github.com/jwilleke/yourphr/issues/467))
- __backup:__ a destination must prove it works before a schedule can use it. Enabling a schedule writes a small test file, fsyncs it, reads it back and removes it, and is __refused__ with the real OS error if any step fails. A schedule pointing at a directory that does not exist used to save happily and fail silently at 02:00 every night ([#468](https://github.com/jwilleke/yourphr/issues/468))
- __backup:__ a __Test path__ button beside the destination field, reporting permission denied / no such directory / read-only filesystem / no space as the operating system reports them ([#468](https://github.com/jwilleke/yourphr/issues/468))

### Security

- __ssrf:__ the guard on user-supplied FHIR base URLs was bypassed by any non-dotted-quad IP form. `net.ParseIP` accepts only dotted-quad, so `2130706433`, `0x7f.0.0.1` and `127.1` all parsed as nothing and skipped the check entirely — while the resolver read them as `127.0.0.1`, and `2852039166` as the cloud metadata address. The check now runs at __dial time on the resolved address__, which also closes DNS rebinding and redirects ([#484](https://github.com/jwilleke/yourphr/issues/484))
- __credentials:__ provider `client_secret`, access tokens and refresh tokens are now a type that refuses to print itself. One handler was logging an entire credential at `Info` — and the `json:"-"` tag that kept `client_secret` out of API responses did nothing there, because `%v` does not consult json tags ([#477](https://github.com/jwilleke/yourphr/issues/477), [#476](https://github.com/jwilleke/yourphr/issues/476))
- __wizard:__ the first-run setup logged the database encryption key in cleartext ([#476](https://github.com/jwilleke/yourphr/issues/476))
- __deps:__ Angular to 20.3.27, closing two high-severity i18n XSS advisories that the proposed dependency PR would have left open — it moved one package of the three ([#478](https://github.com/jwilleke/yourphr/issues/478)); plus `ip-address`, `fast-uri`, `socket.io-parser`, `undici` and `postcss`, all build-tree only ([#483](https://github.com/jwilleke/yourphr/issues/483), [#479](https://github.com/jwilleke/yourphr/issues/479), [#480](https://github.com/jwilleke/yourphr/issues/480))

### Bug Fixes

- __sources:__ six code paths called stubs that always fail, so "deliberately unsupported" was indistinguishable from "broken". Dynamic client registration is now a documented constant, and two endpoints answer `501` with the working alternative instead of `400`/`404` blaming the caller ([#476](https://github.com/jwilleke/yourphr/issues/476))
- __restore:__ a backup renamed by a browser or a NAS could not be restored. Compression and archive format are now detected by __content__, not by filename ([#467](https://github.com/jwilleke/yourphr/issues/467))
- __e2e:__ the test harness passed `--config`, removed in v2.0.0 ([#474](https://github.com/jwilleke/yourphr/issues/474))

### Notes for operators

__Nothing to do.__ Existing `*.db.gz` backups still restore, detected by content rather than name, and restoring one leaves your current configuration alone.

__New backups are `*.tar.gz`__ and contain the database, `config/` and the signing key. Two things are deliberately outside: the cache, and the backup destination itself — computed from your configuration rather than matched by folder name, so renaming your backup folder does not quietly start including it.

__Restoring `config/` replaces the target instance's configuration__, because that is what "records without identity" was missing. `YOURPHR_*` environment variables still override it afterwards.

__The signing key is backed up but never restored.__ Restoring it would revive every session token ever signed with it, including any lifted from the backup file. A restored instance generates its own; everyone signs in again, which a restore forces anyway.

__Turning a backup schedule on now tests the destination first__ and refuses if it fails. Turning one *off* always works, so a dead NAS cannot trap you with a schedule you cannot disable.

__The API no longer returns provider access/refresh tokens__ in source responses. Nothing in the app reads them; if you script against the API and relied on those fields, they now read `[REDACTED]`.

## [2.0.0](https://github.com/jwilleke/yourphr/compare/v1.23.1...v2.0.0) (2026-08-04)

There is now one place a setting comes from before your instance starts, and one place it changes afterwards.

Twelve commits of configuration work land together because they only make sense together. The short version: YAML configuration is gone, `.env` is the bootstrap, and everything else moved to __Admin → Configuration__.

### ⚠ BREAKING CHANGES

- __config:__ `fasten start --config <path>` is no longer accepted. Passing it fails with a message naming the replacement rather than being ignored — silently dropping an operator's settings is the failure this release exists to remove ([#474](https://github.com/jwilleke/yourphr/issues/474))
- __config:__ `config.yaml` is gone: not shipped in the image, not read from the working directory, not read from a flag ([#470](https://github.com/jwilleke/yourphr/issues/470))
- __config:__ `database.encryption.enabled` now defaults to __true__. This is not a new recommendation — it is what a stock Docker install already had, via the `config.yaml` baked into the image for years. Defaulting to `false` when that file was removed would have left those encrypted databases unopenable ([#470](https://github.com/jwilleke/yourphr/issues/470))

### Features

- __config:__ one bootstrap template per deployment type, because what must be set before first start genuinely differs: `.env.docker.example` (nothing required), `.env.baremetal.example` (four variables — every shipped default is a container path), `.env.k8s.example`, `.env.dev.example` ([#474](https://github.com/jwilleke/yourphr/issues/474))
- __config:__ every setting an instance has is catalogued in one file, `backend/pkg/config/app-default-config.json`, with the reason for each default beside it ([#456](https://github.com/jwilleke/yourphr/issues/456))
- __config:__ the app now warns at startup about any configuration key or `YOURPHR_*` variable that maps to nothing. The reference deployment had been setting four keys that do not exist — `web.listen_port` is not `web.listen.port` — and ran that way indefinitely ([#455](https://github.com/jwilleke/yourphr/issues/455))
- __config:__ a `Secret` type that refuses to print itself under `%s`, `%v`, `%+v`, `%#v`, `%q` or `json.Marshal`, so logging a whole struct cannot leak a signing key ([#455](https://github.com/jwilleke/yourphr/issues/455))
- __config:__ ordinary settings are edited at __Admin → Configuration__ and persist to `<data>/config/app-custom-config.json` — no restart, no file editing, no redeploy ([#452](https://github.com/jwilleke/yourphr/issues/452))

### Bug Fixes

- __security:__ the first-run wizard logged the submitted database encryption key in cleartext at `Info` level, defeating the encryption it unlocks for anyone able to read the log — which the Admin Dashboard serves over HTTP
- __admin:__ editing a setting that an environment variable governs appeared to work and silently reverted on the next restart. Such a setting is now shown as environment-governed and the write is refused ([#458](https://github.com/jwilleke/yourphr/issues/458))
- __config:__ the minimum encryption-key length had never applied where it mattered. The rule lived only on the `--config` path, while the first-run wizard — how nearly every install actually sets its key — checked only that the key was non-empty. It now applies when a database is first created ([#474](https://github.com/jwilleke/yourphr/issues/474))
- __config:__ `database.encryption.key` was named as a secret but was absent from the settings catalogue, so startup warned that `YOURPHR_DATABASE_ENCRYPTION_KEY` "has no effect" — untrue, of the one variable that if ignored leaves the database unopenable ([#474](https://github.com/jwilleke/yourphr/issues/474))

### Notes for operators

__Docker, docker-compose and Kubernetes installs need no action.__ The image defaults are correct by construction and none of them ever passed `--config`.

__If you pass `--config`, the app will now refuse to start.__ Move those settings to `.env` (start from `.env.docker.example` or `.env.baremetal.example`) or to `YOURPHR_*` variables. The error names the templates.

__If you run unencrypted, say so explicitly__ with `YOURPHR_DATABASE_ENCRYPTION_ENABLED=false`. With the default now `true`, an instance that relied on the old `false` will otherwise start in standby mode asking for a key. Note that encryption still disables backup and restore ([#367](https://github.com/jwilleke/yourphr/issues/367)).

__Turning encryption on for an existing plaintext database still does not work__ — that migration is [#363](https://github.com/jwilleke/yourphr/issues/363).

__Bare metal must set `YOURPHR_WEB_SRC_FRONTEND_PATH`.__ The default points inside the container image, and without it the backend starts and serves no interface with nothing in the log explaining why. `.env.baremetal.example` documents it.

See [`docs/configuration-system.md`](https://github.com/jwilleke/yourphr/blob/main/docs/configuration-system.md) for the whole model.

## [1.23.1](https://github.com/jwilleke/yourphr/compare/v1.23.0...v1.23.1) (2026-08-03)

### Bug Fixes

- __admin:__ the Configuration screen masked 47 of 51 settings, including `web.listen.port` and `log.level`. Only genuine secrets are masked now — 5 keys ([#458](https://github.com/jwilleke/yourphr/issues/458))

  Masking was derived as "everything outside the `public` array", which conflated two different questions: *may an anonymous caller read this* and *should this be hidden on an admin's own screen*. A short `secret` array now governs masking. The two arrays have deliberately opposite shapes — `public` is an allow-list, because a mistake there exposes a value to the internet; `secret` is a deny-list, because a mistake there merely shows a value to an already-authenticated admin.

### Notes for operators

- Nothing to do. The Configuration screen simply shows what it should have shown: everything except `jwt.issuer.key`, `relay.secret`, `database.encryption.key` and the two sandbox client secrets, which stay behind a click.
- A key listed in __both__ `secret` and `public` is now flagged on the screen — marking something secret while serving it to anonymous callers defeats the masking, and that contradiction should be visible.

## [1.23.0](https://github.com/jwilleke/yourphr/compare/v1.22.0...v1.23.0) (2026-08-03)

Your instance serves its own Privacy Policy and Terms — offline, and replaceable by the operator who actually holds the records.

### Features

- __legal:__ Privacy Policy and Terms of Service are served by the instance at `/privacy` and `/terms`, embedded in the binary rather than fetched from `yourphr.org` ([#463](https://github.com/jwilleke/yourphr/issues/463))
- __legal:__ an operator can publish their own text by dropping `privacy-policy.md` or `terms-of-service.md` into `<data>/config/`; the page states whether you are reading the operator's document or the shipped one ([#463](https://github.com/jwilleke/yourphr/issues/463))
- __legal:__ each document carries a `sha256:` digest of its source, shown at the foot of the page — the identifier that will pin consent records in [#465](https://github.com/jwilleke/yourphr/issues/465) ([#463](https://github.com/jwilleke/yourphr/issues/463))

### Bug Fixes

- __legal:__ the privacy policy'"'"'s Contact section pointed only at "the operator who runs the server", which told a patient nothing actionable. It now points at that instance'"'"'s `/contact` page, which renders the operator's real details ([#454](https://github.com/jwilleke/yourphr/issues/454))

### Notes for operators

- __The links in the app now stay inside your instance.__ Previously every Privacy/Terms link left for `yourphr.org`, which broke on an offline or air-gapped deployment — including at the moment a user was asked to consent.
- __You are the data controller; you can now say so.__ The shipped policy states that the project holds no records and the operator does. If your deployment differs from that description — you host for others, you changed retention, you added a feature that shares data — publish your own text rather than pointing users at a document you did not write. Setup is in [`docs/deployment/README.md`](https://github.com/jwilleke/yourphr/blob/main/docs/deployment/README.md).
- __An empty or unreadable override is an error, not a fallback.__ Serving the stock policy in place of one you deliberately replaced is the failure the override exists to prevent, so the instance says so loudly instead. Remove the file to go back to the shipped text.
- __If you have CMS Blue Button production approval, PP/ToS changes need CMS pre-approval first__ — that applies to an operator override as much as to the shipped document.
- __`yourphr.org/privacy.html` is now behind the in-repo source.__ The published pages were not regenerated in this release, so the public copies lack the Contact-section change. They remain valid for a CMS submission — just not byte-identical to what an instance serves. Regenerating them is tracked in [#463](https://github.com/jwilleke/yourphr/issues/463).
- Consent records are unchanged in this release; nothing to migrate. Persisting the document digest onto them is [#465](https://github.com/jwilleke/yourphr/issues/465).

## [1.22.0](https://github.com/jwilleke/yourphr/compare/v1.21.1...v1.22.0) (2026-08-03)

Configuration becomes something an operator can see and change: one shipped catalogue, one overrides file, and an Admin screen that shows which is which.

### Features

- __config:__ `app-default-config.json` is the shipped catalogue — every setting an instance can have, with its default, loaded in one loop instead of 35 hardcoded calls ([#456](https://github.com/jwilleke/yourphr/issues/456))
- __config:__ a `public` array decides what `GET /api/instance/public` serves; adding a setting to the public surface is a line of JSON, not handler code ([#457](https://github.com/jwilleke/yourphr/issues/457))
- __admin:__ new __Configuration__ screen (`/admin/config`) — every setting, its value, whether you set it or it defaulted, with per-key edit, reset, and reveal ([#458](https://github.com/jwilleke/yourphr/issues/458))
- __ui:__ __Contact Us__ page driven by the Admin Instance card, replacing the operator details that used to sit inline in the footer ([#454](https://github.com/jwilleke/yourphr/issues/454))
- __config:__ values may reference environment variables — `${YOURPHR_RELAY_SECRET}` — so the shipped file can name a secret without holding one ([#460](https://github.com/jwilleke/yourphr/issues/460))

### Bug Fixes

- __config:__ the operator contact email is no longer served to callers without a login; signed-in users still see it ([#459](https://github.com/jwilleke/yourphr/issues/459))
- __config:__ a pre-1.22 nested `app-custom-config.json` is converted to flat keys on first start, with the original kept as `.nested` ([#456](https://github.com/jwilleke/yourphr/issues/456))
- __config:__ ten settings were read in code with no default registered at all, so they silently did nothing unless something set them — `backup.auto-backup*`, `backup.max-backups`, `database.validation_mode`, `web.listen.https.certfile`/`keyfile`, `medications.rxterms_enrich`, `medications.rxterms_api_fallback`, `sync.token_refresh.interval_minutes` ([#456](https://github.com/jwilleke/yourphr/issues/456))

### Security

- The JWT signing key is no longer defaulted to a committed placeholder that the code recognised *by value* to mean "generate one". It is now an environment reference resolving to empty, and empty already meant generate — the special case is gone rather than defended by a test ([#460](https://github.com/jwilleke/yourphr/issues/460)).
- Admin Configuration masks every value outside the `public` array, and a masked value is __not sent to the browser__ until explicitly revealed. Revealing one key is a separate request, logged with the acting admin ([#458](https://github.com/jwilleke/yourphr/issues/458)).

### Notes for operators

- __`/api/instance/public` response keys changed__ from short names (`contact_email`) to config keys (`operator.contact_email`). Only affects anything reading that endpoint directly — the app itself is updated. The endpoint first shipped in 1.21.0, so this is a two-day-old surface.
- __Your operator email stops being publicly readable.__ If you *want* it public — a public help desk, say — add `operator.contact_email` back to the `public` array in Admin → Configuration. Doing so is flagged there and in the startup log, which is intended: publishing an address is a real decision, not a mistake.
- The custom config file is converted from nested to flat keys on first start. No action needed; the original is kept alongside as `app-custom-config.json.nested`.
- New documentation on __what the data volume actually holds__ and when to enable at-rest encryption: [`docs/deployment/README.md`](https://github.com/jwilleke/yourphr/blob/main/docs/deployment/README.md). Worth reading — provider refresh tokens live in that database, and they grant *ongoing* access to records at Epic, CMS or Medicare, not just historical data.
- Enabling `database.encryption.enabled` still disables backup and restore entirely ([#367](https://github.com/jwilleke/yourphr/issues/367)). [#461](https://github.com/jwilleke/yourphr/issues/461) closes that gap.

## [1.21.1](https://github.com/jwilleke/yourphr/compare/v1.21.0...v1.21.1) (2026-08-02)

__Fixes a startup crash introduced in 1.21.0. Upgrade directly from 1.20.3 to this release; do not deploy 1.21.0.__

### Bug Fixes

- __config:__ `storage.data_dir` no longer relocates `database.location` or `cache.location` ([#451](https://github.com/jwilleke/yourphr/issues/451))

  1.21.0 moved those paths under the data root whenever their value equalled the built-in default — but a value that *equals* the default is indistinguishable from one nobody set, and a deployment that deliberately configures `database.location: /opt/fasten/db/fasten.db` hits exactly that. The DB was relocated to `/opt/fasten/db/db/fasten.db`, which does not exist, and the backend crash-looped on `unable to open database file`. Any instance setting `YOURPHR_STORAGE_DATA_DIR` together with a `database.location` matching the default was affected.

  `storage.data_dir` now does one thing: name the directory holding what the instance owns and must not lose — the custom config store, the generated JWT signing key, backups. It never moves the database or the cache.

### Notes for operators

- No action needed beyond upgrading. `YOURPHR_STORAGE_DATA_DIR` is safe to keep set; it is now purely additive.
- If you deployed 1.21.0 and saw a crash loop, no data was lost — the database was never moved, only looked for in the wrong place.

## [1.21.0](https://github.com/jwilleke/yourphr/compare/v1.20.3...v1.21.0) (2026-08-02)

One instance data root, one instance config store, and the operator contact finally visible to the people whose records these are.

### Features

- __config:__ `storage.data_dir` (`YOURPHR_STORAGE_DATA_DIR`) names the instance data root; `db/`, `cache/`, `backups/`, the generated JWT key and the settings files derive under it ([#451](https://github.com/jwilleke/yourphr/issues/451))
- __config:__ instance custom config store at `<data root>/config/app-custom-config.json`, deep-merged over the built-in defaults, replacing the per-concern settings files; `.operator_settings.json` migrates automatically ([#452](https://github.com/jwilleke/yourphr/issues/452))
- __api:__ `GET /api/instance/public` — unauthenticated, explicitly allowlisted instance identity (operator name, contact email, contact URL, theme) ([#453](https://github.com/jwilleke/yourphr/issues/453))
- __ui:__ the footer shows who operates this instance and how to reach them, when the operator has set it ([#454](https://github.com/jwilleke/yourphr/issues/454))
- __ci:__ the relay image is published with semver tags on a release — `ghcr.io/jwilleke/yourphr-relay:X.Y.Z`, `:X.Y`, `:latest` ([#450](https://github.com/jwilleke/yourphr/issues/450), reported by @thevoltagesource)

### Refactoring

- __config:__ environment reads route through `config.Interface` instead of `os.Getenv`, so a value set in `config.yaml` is no longer invisible to them; an AST test fails the build on new direct reads ([#455](https://github.com/jwilleke/yourphr/issues/455))

### Notes for operators

- __`YOURPHR_STORAGE_DATA_DIR` must equal the directory that actually persists__ — the volume mount, not a sibling of it. Everything the instance owns lives under it, including the new config store. Leave it unset and the root is derived from `database.location`'s parent exactly as before, so an existing install does not move. Prod and demo now set it explicitly to `/opt/fasten/db`.
- Operator contact set in Admin → Instance is now rendered in the footer. It was previously stored and displayed nowhere.
- `.operator_settings.json` is folded into the config store on first start and renamed `.migrated` rather than deleted.
- Self-hosters tracking the relay image can move from `:main-<run>` to `:X.Y.Z`. `:main-<run>` is a CI run counter, not a version, and is not part of the deployment contract.
- `relay.FromEnv` was removed (no callers; `FromConfig` supersedes it).

## [1.20.3](https://github.com/jwilleke/yourphr/compare/v1.20.2...v1.20.3) (2026-08-01)

Session reliability, enrollee data controls, admin logs, CMS prod-access runbook, and first patient-entered vitals slice.

### Features

- __auth:__ sliding browser session JWT (60m window, renew when ≤30m remain, 12h absolute max from `session_start`) ([#445](https://github.com/jwilleke/yourphr/issues/445))
- __sources:__ split __Disconnect__ (tokens only) vs __Remove data__ vs combined full teardown; PP/ToS revoke disconnects Medicare-class without wiping records ([#437](https://github.com/jwilleke/yourphr/issues/437))
- __pghd:__ patient-entered home vitals (`POST /resource/patient-entry`, UI `/resource/add`) — weight, HR, temp, SpO2, BP on the YourPHR source ([#313](https://github.com/jwilleke/yourphr/issues/313) first slice)
- __docs:__ CMS Blue Button production access runbook (form, Zoom script, PP/ToS gates) ([#433](https://github.com/jwilleke/yourphr/issues/433))

### Bug Fixes

- __admin-logs:__ filter ring-buffer lines by running log level (Error hides buffered info/debug) ([#435](https://github.com/jwilleke/yourphr/issues/435))
- __sync:__ clear stuck import progress — wire `source_complete`, poll job status when SSE misses, buffer SSE channel ([#337](https://github.com/jwilleke/yourphr/issues/337))

### Notes for operators

- After Flux picks `1.20.3` on demo: long sessions should not kick at 1h if active; Connected Sources Actions show Disconnect / Remove data; Medical History __Add record__ saves a home vital; CMS application path is in `docs/cms-bluebutton-production-access.md`.
- Config (optional): `jwt.session_ttl_minutes`, `jwt.session_absolute_hours`, `jwt.session_renew_if_remaining_minutes` (env `YOURPHR_JWT_SESSION_*`).

## [1.20.2](https://github.com/jwilleke/yourphr/compare/v1.20.1...v1.20.2) (2026-08-01)

### Bug Fixes

- __adverse-event:__ Explore table Date/Event/Outcome/Seriousness/Actuality with SMART-style fallbacks (`meta.lastUpdated`, `suspectEntity`); detail card wired ([#449](https://github.com/jwilleke/yourphr/issues/449))

### Notes for operators

- After Flux picks `1.20.2`, re-check demo Explore __AdverseEvent__ (12 rows) for non-empty Date/Event/Outcome/Actuality.

## [1.20.1](https://github.com/jwilleke/yourphr/compare/v1.20.0...v1.20.1) (2026-08-01)

Explore list/detail polish and CI markdown fixes.

### Bug Fixes

- __explore:__ resource-detail breadcrumb trail — source/patient › Explore › type › FHIR title (e.g. Death Certification (308646001)); remove hardcoded `unknown` ([#448](https://github.com/jwilleke/yourphr/issues/448))
- __media:__ Explore Media datatable (status, modality, title, content type, created, operator, subject) ([#446](https://github.com/jwilleke/yourphr/issues/446))
- __medication-request:__ Explore columns status/intent/medication/authored/requester first ([#447](https://github.com/jwilleke/yourphr/issues/447))
- __docs:__ markdownlint MD034/MD049 so Markdown Lint CI is green

### Notes for operators

- After Flux picks `1.20.1`, re-check demo Explore: Media, MedicationRequest, and resource-detail breadcrumbs.

## [1.20.0](https://github.com/jwilleke/yourphr/compare/v1.19.1...v1.20.0) (2026-08-01)

Explore display improvements from demo SMART Health IT acceptance.

### Features

- __consent:__ first-class Explore table, `ConsentModel`, and detail card — no more parse error / Id-only fallback ([#440](https://github.com/jwilleke/yourphr/issues/440))
- __diagnostic-report:__ lab-oriented Explore columns (status, category, title, results summary) ([#443](https://github.com/jwilleke/yourphr/issues/443))
- __encounter:__ Explore columns for status, class, type, period; practitioner/org reference fallbacks ([#444](https://github.com/jwilleke/yourphr/issues/444))

### Bug Fixes

- __device:__ Unique ID from R4 `udiCarrier[]` array + distinctIdentifier/serial fallbacks ([#442](https://github.com/jwilleke/yourphr/issues/442))

### Notes for operators

- Re-check Explore on demo after Flux picks `1.20.0`: Device Unique ID, Consent×3, DiagnosticReport×6, Encounter×21 for the SMART Health IT source.

## [1.19.1](https://github.com/jwilleke/yourphr/compare/v1.19.0...v1.19.1) (2026-08-01)

### Bug Fixes

- __config:__ repair broken `config.yaml` YAML — the `#441` metrics block had been spliced into the middle of `web.listen`, so the server failed to start (`yaml: line 20: did not find expected key`). That broke CI E2E on every push since metrics landed and would break any install using the image default config. Also fix `TODO.md` band headings (MD026 trailing punctuation)

## [1.19.0](https://github.com/jwilleke/yourphr/compare/v1.18.2...v1.19.0) (2026-08-01)

Runtime deployment labels and frontend build-chain security pins.

### Features

- __web:__ `web.environment_name` / `YOURPHR_WEB_ENVIRONMENT_NAME` — footer shows `demo-1.19.0` / `prod-1.19.0` / `dev-…` from runtime config so one release image can label instances differently; `GET /api/version` returns `{ version, environment_name }` ([#438](https://github.com/jwilleke/yourphr/issues/438))

### Security

- __frontend:__ yarn resolutions for Dependabot build-chain alerts — postcss 8.5.18, webpack-dev-server 5.2.6, brace-expansion 2.1.2, js-yaml 4.3.1, engine.io 6.6.9, @hono/node-server 2.0.12, picomatch 4.0.4 ([#416](https://github.com/jwilleke/yourphr/issues/416))

### Notes for operators

- Set the footer label per instance (no rebuild):
  - demo: `YOURPHR_WEB_ENVIRONMENT_NAME=demo`
  - production: `YOURPHR_WEB_ENVIRONMENT_NAME=prod`
  - local: `YOURPHR_WEB_ENVIRONMENT_NAME=dev` (or leave unset for build-time default)
- Empty `web.environment_name` keeps the previous Angular build-time name (release images still default to `prod` until the env is set).

## [1.18.2](https://github.com/jwilleke/yourphr/compare/v1.18.1...v1.18.2) (2026-08-01)

Oracle SMART import usability, structured sync metrics, and Admin Metrics card.

### Bug Fixes

- __smart:__ Patient is always fetched first; fat resource types soft-truncate at 250 pages/type; global 5000-page budget soft-stops remaining types instead of hard-failing the plan ([#439](https://github.com/jwilleke/yourphr/issues/439))

### Features

- __sync:__ durable job `data.summary` (outcome, duration_ms, total_resources, by_type, platform/environment) and `sync_complete` log line ([#441](https://github.com/jwilleke/yourphr/issues/441))
- __metrics:__ opt-in Prometheus scrape (`metrics.enabled` / `YOURPHR_METRICS_*`, default off; internal only) for sync job counters and duration histogram ([#441](https://github.com/jwilleke/yourphr/issues/441))
- __admin:__ Metrics card on Admin Dashboard — scrape status, process counters, recent sync summaries; `GET /api/secure/admin/metrics` ([#441](https://github.com/jwilleke/yourphr/issues/441))

### Notes for operators

- Re-sync existing Oracle/Cerner sources after deploy so a missing Patient row is repaired (#439).
- Enable scrape only on a cluster-internal port: `metrics.enabled: true` (or `YOURPHR_METRICS_ENABLED=true`); do not put it on public Ingress.
- Job summaries appear on new syncs only; open Admin → Metrics or `GET /api/secure/jobs`.

### Known issues

- FHIR Consent still has no card ([#440](https://github.com/jwilleke/yourphr/issues/440))
- Large Cerner imports can still be slow (request count); first-import vs incremental remains future work
- yarn Dependabot build-chain alerts ([#416](https://github.com/jwilleke/yourphr/issues/416))

## [1.18.1](https://github.com/jwilleke/yourphr/compare/v1.18.0...v1.18.1) (2026-08-01)

Explore sandbox filter for admins, vendor status dated from live retests, and markdownlint CI cleanups.

### Features

- __explore:__ admin toggle to show/hide sandbox sources (default off; preference in localStorage) so patient-facing Explore stays clean of `/sandbox` test connects

### Documentation

- __vendors:__ dated Blue Button sandbox login regression (2026-07-31), SMART Health IT E2E on demo, Oracle page-cap abort ([#439](https://github.com/jwilleke/yourphr/issues/439)), Epic sandbox E2E notes
- __vendors:__ remove obsolete `blue-button.md` (superseded by `medicare.md`)

### Bug Fixes

- __ci:__ markdownlint MD051/MD036/MD012 in Blue Button docs and `TODO.md`

### Known issues

- Oracle large imports can abort at the global 1000-page cap and leave Patient missing ([#439](https://github.com/jwilleke/yourphr/issues/439))
- FHIR Consent has no card yet (raw-only on Explore) ([#440](https://github.com/jwilleke/yourphr/issues/440))
- Reference display resolve/link for Practitioner participants still open ([#280](https://github.com/jwilleke/yourphr/issues/280))

## [1.18.0](https://github.com/jwilleke/yourphr/compare/v1.17.0...v1.18.0) (2026-07-31)

Operator-visible scheduled backup health so failures no longer stay silent for weeks when a destination falls outside the allowlist.

### Features

- __admin / backup:__ durable `.backup_health.json` (last success/attempt, consecutive failures, summary); Admin Database health banner; Admin Dashboard Database card badge ([#434](https://github.com/jwilleke/yourphr/issues/434))
- __admin / backup:__ `GET /api/secure/admin/database` returns `backup_health` and `allowed_backup_roots` for operators

### Bug Fixes

- __backup:__ allowlist includes destination already saved via Admin UI (`.backup_settings.json`), so UI-only NAS paths keep working after path confinement ([#434](https://github.com/jwilleke/yourphr/issues/434), relates to [#383](https://github.com/jwilleke/yourphr/issues/383))
- __backup:__ scheduled worker rate-limits Error logs (1st + every 15th failure; Debug in between)

### Notes for operators

- Open __Admin → Dashboard__ (Database badge) or __Admin → Database__ to see backup health without tailing logs.
- First-time external/NAS destinations still need `backup.allowed-roots` or `backup.destination` in config; paths already saved in the Admin UI are allowlisted automatically. See comments on `backup:` in `config.yaml`.
- Health file lives next to the DB as `.backup_health.json` (data volume; not in git).

### Known issues

- Browser / push notifications for backup failures are not in this release (Phase 1 is durable status + UI only).
- CMS production credentials / application demo still block live end-to-end production proof ([#433](https://github.com/jwilleke/yourphr/issues/433), [#408](https://github.com/jwilleke/yourphr/issues/408)).
- 12 `frontend/yarn.lock` Dependabot alerts remain ([#416](https://github.com/jwilleke/yourphr/issues/416)).

## [1.17.0](https://github.com/jwilleke/yourphr/compare/v1.16.0...v1.17.0) (2026-07-31)

CMS Blue Button production-access UX and catalog path: legal consent, attributions, Medicare labeling, pre-connect messaging, enrollee data controls, and a production Medicare catalog template — plus modular connection policy for all medical sources.

### Features

- __account:__ PP/ToS active opt-in on Account Profile; gate medical-source connects until granted; revoke removes Medicare-class sources ([#427](https://github.com/jwilleke/yourphr/issues/427))
- __ui:__ third-party attributions registry, `/attributions` page, CMS Blue Button non-endorsement notice on Medicare path ([#428](https://github.com/jwilleke/yourphr/issues/428))
- __catalog:__ patient-facing production label forced to __Medicare__ for Blue Button-class sources ([#429](https://github.com/jwilleke/yourphr/issues/429))
- __sources:__ pre-connect informed modal (Cancel / Continue) before OAuth; modular generic vs Medicare copy ([#430](https://github.com/jwilleke/yourphr/issues/430))
- __connect:__ modular connection policy for all catalog medical sources (`consent_policy`, `pre_connect_profile`); defaults require consent + pre-connect ([docs/connection-policy.md](docs/connection-policy.md))
- __sources / account:__ enrollee data controls — Disconnect & remove data, Account Profile data-controls card pointing at `/sources`, PP source aligned with delete-source behavior ([#431](https://github.com/jwilleke/yourphr/issues/431))
- __catalog:__ production Medicare template (no secrets) + `YOURPHR_PROD_BLUEBUTTON_*` env seed; full operator docs in `docs/medicare-bluebutton.md` and provider-catalog README ([#432](https://github.com/jwilleke/yourphr/issues/432))
- __admin:__ Instance card for operator name / contact email / help URL (deploy-local, not hardcoded)
- __legal:__ slim public Privacy Policy + Terms of Service sources (`docs/legal/`)

### Bug Fixes

- __smart:__ distinct relay connect errors and safer poll timeout ([#406](https://github.com/jwilleke/yourphr/issues/406))
- __docs:__ markdownlint / TODO double-blank fixes for CI

### Notes for operators

- Production Medicare on `/sources`: enable the seeded __Medicare__ catalog entry (or set `YOURPHR_PROD_BLUEBUTTON_CLIENT_ID` / `_SECRET`) after CMS production credentials; register the relay `callback_url` with CMS. See [docs/medicare-bluebutton.md](docs/medicare-bluebutton.md).
- Disconnect removes the source __and__ imported records for that source on this instance (matches updated Privacy Policy source text).
- Live `yourphr.org` privacy.html may need a gh-pages republish if you want public PP to match `docs/legal/privacy-policy.md`.

### Known issues

- CMS production credentials / application demo still block live end-to-end production proof ([#433](https://github.com/jwilleke/yourphr/issues/433), [#408](https://github.com/jwilleke/yourphr/issues/408)).
- 12 `frontend/yarn.lock` Dependabot alerts remain ([#416](https://github.com/jwilleke/yourphr/issues/416)).
- `zone.js` 0.16.x held for Angular 20 peers; angular-eslint 21 held.

## [1.16.0](https://github.com/jwilleke/yourphr/compare/v1.15.1...v1.16.0) (2026-07-29)

__YourPHR now runs on arm64.__ This closes the v1.15.1 known issue of the same name — if you are on an Apple Silicon Mac, a Raspberry Pi 5, or an Ampere/Graviton VPS, `docker pull` now resolves natively with no `--platform` flag and no emulation.

### Features

- __docker:__ publish `linux/arm64` alongside `linux/amd64` for both the app image (`ghcr.io/jwilleke/yourphr`) and the OAuth relay (`ghcr.io/jwilleke/yourphr-relay`) ([#405](https://github.com/jwilleke/yourphr/issues/405)). Previously the app image was amd64-only, so `docker pull` failed outright on every arm64 host with `no matching manifest for linux/arm64/v8` — a self-hosted PHR that could not run on the cheapest and most common self-hosting hardware, and a documented quick-start that did not work on a large share of developer laptops.

  The two images are built differently, on purpose. The app image needs a full Angular build plus a CGO/SQLCipher static Go link, both of which are slow and fragile under QEMU, so it now builds as a __native matrix__ on `ubuntu-latest` and `ubuntu-24.04-arm`: each architecture pushes by digest and a new `merge` job assembles the manifest list. The `fasten --help` smoke test in the final image stage therefore runs natively on each architecture. The relay is `CGO_ENABLED=0` pure Go with a COPY-only final stage, so it simply cross-compiles on one runner.

  Acting on this issue's own warning that a green workflow does not prove a working image, the merge job inspects the pushed manifest and fails the run if either platform is missing. The change was additionally verified by building and running the image natively on arm64 hardware before release: it builds, starts, and serves `/web/`.

### Notes for operators

- Nothing to do on upgrade — same tags, same configuration. Existing amd64 deployments are unaffected.
- Releases up to and including `v1.15.1` remain amd64-only; they are not retro-published. To check what any tag ships: `docker buildx imagetools inspect ghcr.io/jwilleke/yourphr:<tag>`.

### Known issues

- The 12 `frontend/yarn.lock` build-chain Dependabot alerts remain, now tracked as [#416](https://github.com/jwilleke/yourphr/issues/416). All are build and dev-server tooling — none reach the shipped image or patient data.
- `backend/pkg/web/handler/testdata/ccda_to_fhir_converted_C-CDA_R2-1_CCD.xml.json` still does not match current converter output (65 vs 67 resources); harmless for tests, untrustworthy as ground truth.
- `jgiannuzzi/go-sqlite3` remains a pinned 2023 fork ([#401](https://github.com/jwilleke/yourphr/issues/401)); `zone.js` 0.16.x remains held on the Angular 20 peer constraint ([#378](https://github.com/jwilleke/yourphr/pull/378)).

## [1.15.1](https://github.com/jwilleke/yourphr/compare/v1.15.0...v1.15.1) (2026-07-29)

Follow-ups from end-to-end testing of the v1.15.0 out-of-box C-CDA change ([#404](https://github.com/jwilleke/yourphr/issues/404)). Both were found by actually running the stack; unit tests, CI and `docker compose config` passed cleanly through each.

### Bug Fixes

- __import:__ correct the C-CDA setup hint. v1.15.0 still told operators to run `docker compose --profile cda up -d`, but that profile was __removed__ in the same release — following the instruction did nothing. The hint now reflects reality: reaching it means either the feature was turned off deliberately (it is on by default) or the app runs from its own manifests rather than the shipped compose files, and it addresses both. Tests now assert the dead instruction is *absent*, since asserting only that text is *present* let the content rot unnoticed.
- __ci:__ build the C-CDA converter image for `linux/arm64` as well. Making the sidecar start by default in v1.15.0 meant an amd64-only image broke `docker compose up` outright on every arm64 host with `no matching manifest for linux/arm64/v8` — including users who only import FHIR JSON and never wanted the converter. The multi-arch image is published, so this needs no upgrade to take effect.

### Known issues

- __YourPHR still cannot run on arm64__: the *app* image is amd64-only, so Apple Silicon, Raspberry Pi and ARM VPS hosts cannot run it at all. The converter fix above was necessary but not sufficient. Tracked in [#405](https://github.com/jwilleke/yourphr/issues/405); workaround is `DOCKER_DEFAULT_PLATFORM=linux/amd64` (emulated, slower).
- `backend/pkg/web/handler/testdata/ccda_to_fhir_converted_C-CDA_R2-1_CCD.xml.json` no longer matches current converter output (65 vs 67 resources). Harmless — tests mock with it — but it is not trustworthy as ground truth until refreshed.
- C-CDA conversion is verified as *working*, not as *clinically faithful*: nobody has yet checked that converted resources faithfully represent the source document.
- `zone.js` 0.16.x remains held on Angular 20's peer constraint ([#378](https://github.com/jwilleke/yourphr/pull/378)); `jgiannuzzi/go-sqlite3` remains a pinned 2023 fork ([#401](https://github.com/jwilleke/yourphr/issues/401)); 12 `frontend/yarn.lock` build-chain Dependabot alerts remain.

## [1.15.0](https://github.com/jwilleke/yourphr/compare/v1.14.0...v1.15.0) (2026-07-29)

### ⚠️ Operators — read before upgrading

The C-CDA converter sidecar is now __enabled by default__, and the image bakes `config.yaml`, so this changes the default for __every Docker deployment__.

- __Using the shipped `docker-compose.yml` or `docker-compose-prod.yml`?__ Nothing to do — the sidecar now starts alongside the app.
- __Running the app without that sidecar__ (a hand-rolled k8s Deployment, your own manifests)? Uploading XML will now report *"C-CDA conversion service unreachable"* instead of *"not enabled"*. Either deploy the sidecar — see [`deploy/yourphr-cda-converter.example.yaml`](deploy/yourphr-cda-converter.example.yaml) — or set `YOURPHR_CDA_CONVERTER_ENABLED=false`.

Nothing else is affected, no data is at risk, and existing `YOURPHR_CDA_CONVERTER_*` settings still override the defaults.

### Features

- __import:__ C-CDA / CCD (XML) import now works __out of the box__ ([#404](https://github.com/jwilleke/yourphr/issues/404)). XML is what patient portals actually export — Epic MyChart and friends hand people XML, not FHIR JSON — yet importing your own records previously required three separate discoveries, all of them plumbing: realise XML was supported, start a second container hidden behind a compose profile, and set two `YOURPHR_*` variables whose prefix silently ignores near-misses. A stock `docker compose up -d` now imports an Epic export with no extra steps.

### Bug Fixes

- __docker:__ `docker-compose-prod.yml` defined __no `cda-converter` service at all__, so C-CDA import was impossible on the production compose path regardless of how carefully the documented variables were set — `YOURPHR_CDA_CONVERTER_URL` had nothing to point at. This is the wall the [#397](https://github.com/jwilleke/yourphr/issues/397) reporter hit. The service is now defined in both compose files.
- __import:__ an unreachable converter now reports the address it tried and the three ways out — start the sidecar, repoint the URL, or disable the feature — rather than a bare connection error. It deliberately does *not* repeat the "set these variables" advice, since in that state they are already correct ([#404](https://github.com/jwilleke/yourphr/issues/404)).

### Security / privacy

- The converter remains `expose`-only and is __never__ published to a host port: raw C-CDA is PHI and must not be reachable from outside the compose network. Verified against the resolved output of both compose files. Running it by default does not change the AGPL position — it stays a separate process, so no combined-work entanglement.

### Known issues

- `zone.js` 0.16.x remains held on Angular 20's `zone.js ~0.15.0` peer constraint ([#378](https://github.com/jwilleke/yourphr/pull/378)).
- `jgiannuzzi/go-sqlite3` is still a pinned fork of a 2023 commit and will not pick up upstream `mattn/go-sqlite3` security fixes. [#401](https://github.com/jwilleke/yourphr/issues/401) made the arrangement safe, not permanent.
- 12 Dependabot alerts remain, all `frontend/yarn.lock` build/dev-chain transitives that do not ship in the served image. No Dependabot PR currently covers them.
- Which converter to depend on long-term is an open question ([#403](https://github.com/jwilleke/yourphr/issues/403)).

## [1.14.0](https://github.com/jwilleke/yourphr/compare/v1.13.4...v1.14.0) (2026-07-29)

### Features

- __admin:__ the Admin Dashboard now shows the __effective__ SMART OAuth relay configuration and, for each value, __where it came from__ — configured, inherited from `relay.url`, or fallen back to the built-in default — along with the environment variable to change ([#402](https://github.com/jwilleke/yourphr/issues/402), suggested by @thevoltagesource while verifying [#399](https://github.com/jwilleke/yourphr/issues/399)).

  The problem this solves is not "is this URL correct" but __"is my configuration being read at all"__ — two states that were previously indistinguishable. That ambiguity is what made [#399](https://github.com/jwilleke/yourphr/issues/399) and [#397](https://github.com/jwilleke/yourphr/issues/397) expensive to diagnose: in one, `YOURPHR_RELAY_URL` was honoured for polling but silently ignored for the callback; in the other, no `YOURPHR_*` value reached the container at all. The card leads with the callback URL to register with each FHIR vendor, and a value that silently fell back is labelled as such rather than presented as a neutral fact. Collapsed by default; the Ready / Not ready badge stays visible when collapsed. The shared secret is never returned by the API or rendered.

- __api:__ `GET /api/secure/source/relay-config` gained `ready`, `public_url`, `poll_url` and `secret`, each carrying `source` plus the `config_key` / `env_var` to change. `callback_url` and `configured` are unchanged, so existing callers keep working ([#402](https://github.com/jwilleke/yourphr/issues/402)).

### Dependencies

- __backend:__ `gorm.io/gorm` 1.30.0 → 1.31.2, `gorm.io/driver/sqlite` 1.5.4 → 1.6.0, `gormigrate/v2` 2.1.1 → 2.1.6 ([#374](https://github.com/jwilleke/yourphr/pull/374), [#377](https://github.com/jwilleke/yourphr/pull/377)). These were held for 34 days because they drag `go-sqlite3` past the version pin that wired in SQLCipher; the [#401](https://github.com/jwilleke/yourphr/issues/401) fix in v1.13.4 removed that hazard, and encryption was re-verified on the merged result.

### Known issues

- `zone.js` 0.16.x remains held on Angular 20's `zone.js ~0.15.0` peer constraint ([#378](https://github.com/jwilleke/yourphr/pull/378)).
- `jgiannuzzi/go-sqlite3` is still a pinned fork of a 2023 commit and will not pick up upstream `mattn/go-sqlite3` security fixes. [#401](https://github.com/jwilleke/yourphr/issues/401) made the arrangement safe, not permanent.
- 12 Dependabot alerts remain, all `frontend/yarn.lock` build/dev-chain transitives that do not ship in the served image. No Dependabot PR currently covers them.

## [1.13.4](https://github.com/jwilleke/yourphr/compare/v1.13.3...v1.13.4) (2026-07-29)

### ⚠️ Behaviour change — read before upgrading

The app now __refuses to start__ if `database.encryption.enabled` is true but SQLCipher is not actually active, instead of starting and writing patient data unencrypted. This is intentional (see below), but it converts a previously silent problem into a visible startup failure. A healthy instance is unaffected.

### Security

- __database:__ keep SQLCipher wired, and fail closed if it ever is not ([#401](https://github.com/jwilleke/yourphr/issues/401)). At-rest encryption depended on a `replace` directive in `go.mod` pinned to an exact `go-sqlite3` version. A `replace X vN => Y` matches __only__ version `vN`, so any dependency bump that moved `go-sqlite3` off it — a routine `gorm.io/driver/sqlite` upgrade does exactly that — silently stopped matching and linked the stock driver. The stock driver treats the `_cipher=sqlcipher` DSN pragmas as unknown parameters and ignores them: the database opens, the app runs, and PHI is written in __plaintext__ while the config still reports encryption as enabled. Nothing errors. Two independent layers now prevent this — the `replace` is unversioned so it applies to every version, and startup asserts `PRAGMA cipher` returns `sqlcipher` or refuses to boot. Verified against the exact upgrade that caused it.

### Bug Fixes

- __docker:__ pass `YOURPHR_*` config from `.env` / `.env_custom` into the container ([#397](https://github.com/jwilleke/yourphr/issues/397)). `docker compose` reads `.env` only to substitute `${...}` inside the compose file; it does not forward those values to the container, and the services declared only `HOST_IP`/`HOST_PORT`. Every `YOURPHR_*` setting placed in `.env` was therefore silently ignored — the documented configuration mechanism did not work at all on the primary deployment path, with no warning. Both compose files now declare `env_file` (optional, so a missing file is not an error). __If you use a compose file from an earlier release, update it or your `.env` settings will continue to be ignored__; confirm with `docker compose config | grep YOURPHR_`.

### Build

- __frontend:__ `make dep-frontend` clears `frontend/.angular/cache` when `yarn.lock` changes, and a new `make clean-frontend-cache` target clears it on demand. The cache stores absolute module paths, so a dependency change that moves a package between nested and hoisted `node_modules` leaves them dangling — builds then fail locally while CI (which starts with no cache) passes the same commit. It lives outside `node_modules`, so reinstalling never cleared it.

### Documentation

- `docs/devserver.md` — troubleshooting for local-only frontend build failures
- `docs/import/c-cda.md` and `.env.example` — corrected; they previously described `.env` behaviour that only held for non-Docker installs

### Known issues

- `gorm` / `gormigrate` bumps ([#374](https://github.com/jwilleke/yourphr/pull/374), [#377](https://github.com/jwilleke/yourphr/pull/377)) are __now unblocked__ by the [#401](https://github.com/jwilleke/yourphr/issues/401) fix but had not landed when this was cut; they will ship in a later release.
- `zone.js` 0.16.x remains held on Angular 20's `zone.js ~0.15.0` peer constraint ([#378](https://github.com/jwilleke/yourphr/pull/378)).
- `jgiannuzzi/go-sqlite3` is still a pinned fork of a 2023 commit and will not pick up upstream `mattn/go-sqlite3` security fixes. [#401](https://github.com/jwilleke/yourphr/issues/401) makes the arrangement safe, not permanent.
- 12 Dependabot alerts remain, all `frontend/yarn.lock` build/dev-chain transitives that do not ship in the served image.

## [1.13.3](https://github.com/jwilleke/yourphr/compare/v1.13.2...v1.13.3) (2026-07-29)

### Bug Fixes

- __import:__ C-CDA / CCD (XML) setup is discoverable instead of a dead end. Uploading the XML files from a provider export (Epic MyChart and similar) failed with `C-CDA import is not enabled on this server (set cda_converter.enabled)` — which named a config *key*, not an environment variable. The prefix is `YOURPHR_`, so `FASTEN_CDA_CONVERTER_ENABLED` and a bare `CDA_CONVERTER_ENABLED` were silently ignored, and even the correct name alone still failed because the converter sidecar must be running and `cda_converter.url` must be set. `.env.example` documented none of it. Every converter error now names all three requirements ([#397](https://github.com/jwilleke/yourphr/issues/397))
- __import:__ the Convert dialog no longer offers a button that cannot work — when the server can't convert, it shows the setup steps instead ([#397](https://github.com/jwilleke/yourphr/issues/397))

### Features

- __import:__ new `GET /api/secure/source/cda-converter/status` reports `{enabled, ready, setup_hint}`. `ready` requires *both* the flag and a converter address, so the half-configured state (enabled, no URL) is no longer indistinguishable from a working one. The configured URL is never returned — the sidecar is internal infrastructure ([#397](https://github.com/jwilleke/yourphr/issues/397))

### Documentation

- new [`docs/import/c-cda.md`](docs/import/c-cda.md) — enabling C-CDA import, a config-key → environment-variable table, and troubleshooting
- `.env.example` gains a C-CDA section (it previously had no CDA entries at all)
- `docs/devserver.md` gains a troubleshooting section for local-only frontend build failures — clear `.angular/cache` first when a module path contains a nested `node_modules`; the cache stores absolute paths, survives reinstalling `node_modules`, and does not self-prune

### Known issues

- Unchanged from v1.13.2: `gorm` / `gormigrate` bumps ([#374](https://github.com/jwilleke/yourphr/pull/374), [#377](https://github.com/jwilleke/yourphr/pull/377)) remain excluded — both drag `go-sqlite3` past the version-pinned `replace` that wires in the SQLCipher driver, silently disabling database encryption ([#401](https://github.com/jwilleke/yourphr/issues/401)). `zone.js` 0.16.x is held on Angular 20's `zone.js ~0.15.0` peer constraint ([#378](https://github.com/jwilleke/yourphr/pull/378)). 12 Dependabot alerts remain, all `frontend/yarn.lock` build/dev-chain transitives that do not ship in the served image.

## [1.13.2](https://github.com/jwilleke/yourphr/compare/v1.13.1...v1.13.2) (2026-07-28)

Dependency and security maintenance. No functional changes.

### Security

- __frontend:__ clear 12 Dependabot advisories via a grouped `npm_and_yarn` bump — `websocket-driver` (the only __critical__), `fast-uri`, `hono`, `immutable`, `linkify-it`, `shell-quote`, `tar` ([#400](https://github.com/jwilleke/yourphr/pull/400)). Open alerts drop from 24 to 12.
- __backend:__ `golang.org/x/image` 0.38.0 → 0.41.0 (GHSA-q675-qj96-32m9) — the only advisory affecting a runtime dependency rather than the frontend build chain ([#390](https://github.com/jwilleke/yourphr/pull/390))
- __frontend:__ `morgan` 1.10.0 → 1.11.0 (GHSA-4vj7-5mj6-jm8m) ([#394](https://github.com/jwilleke/yourphr/pull/394))

### Dependencies

- __backend:__ `github.com/samber/lo` 1.35.0 → 1.53.0, `golang.org/x/mod` 0.36.0 → 0.38.0, `gorm.io/driver/postgres` 1.5.3 → 1.6.0
- __frontend:__ `@ng-select/ng-select` 15.2.0 → 20.7.0 (realigns with Angular 20 — v15 targeted Angular 15), `@angular-eslint/builder` 20.7.0 → 21.0.1, `@compodoc/compodoc` 1.1.19 → 1.2.1, `@types/jasminewd2` 2.0.10 → 2.0.13
- __ci:__ `actions/cache` 5 → 6, `actions/setup-node` 6 → 7, `actions/setup-go` 6 → 7, `DavidAnson/markdownlint-cli2-action` 23 → 24

### Tests

- fix two stale assertions left by the [#399](https://github.com/jwilleke/yourphr/issues/399) relay change, which had `main` red between v1.13.1 and this release. Application code was unaffected; both were test-only. `sandbox.component.spec.ts` still expected the browser to send `redirect_uri`, and `source_connect_test.go` lacked mock expectations for the new relay config lookups.

### Known issues

- `gorm.io/gorm` and `gormigrate` bumps ([#374](https://github.com/jwilleke/yourphr/pull/374), [#377](https://github.com/jwilleke/yourphr/pull/377)) are __deliberately excluded__: both drag `go-sqlite3` past the version-pinned `replace` that wires in the SQLCipher driver, silently disabling database encryption. Tracked in [#401](https://github.com/jwilleke/yourphr/issues/401).
- `zone.js` 0.16.x is held — it violates Angular 20's `zone.js ~0.15.0` peer constraint ([#378](https://github.com/jwilleke/yourphr/pull/378)).
- 12 Dependabot alerts remain, all in `frontend/yarn.lock` build/dev-chain transitives that do not ship in the served image.

## [1.13.1](https://github.com/jwilleke/yourphr/compare/v1.13.0...v1.13.1) (2026-07-28)

### Bug Fixes

- __relay:__ self-hosted OAuth relays now work without rebuilding the frontend — the SMART on FHIR `redirect_uri` was built from a compile-time constant baked into the Angular bundle, so a deployment that set `YOURPHR_RELAY_URL` polled its own relay but still sent the project relay's `/callback` to the provider. `redirect_uri` is now derived by the backend at request time and is no longer sent by the browser ([#399](https://github.com/jwilleke/yourphr/issues/399))

### Features

- __relay:__ relay settings are ordinary config keys (`config.yaml` / `.env` / `.env_custom` / env), with the URLs split by who reaches them: `relay.url` (`YOURPHR_RELAY_URL`) is where the __backend__ polls `/pending` and may be cluster-internal, while `relay.public_url` (`YOURPHR_RELAY_PUBLIC_URL`) is the public origin the __provider__ redirects the browser to — `<that>/callback` is the value registered with the FHIR vendor. `relay.public_url` falls back to `relay.url` when that is public https, else to the project relay, so existing deployments are unchanged ([#399](https://github.com/jwilleke/yourphr/issues/399))
- __relay:__ new `GET /api/secure/source/relay-config` reports the effective callback URL and whether a relay secret is configured (never the secret), so operators can confirm what to register with their vendor ([#399](https://github.com/jwilleke/yourphr/issues/399))

## [1.13.0](https://github.com/jwilleke/yourphr/compare/v1.12.1...v1.13.0) (2026-07-02)

### Features

- __medications:__ patient-friendly drug names via NLM __RxTerms__ — the raw RxNorm title ("Amoxicillin 250 MG / Clavulanate 125 MG Oral Tablet") now displays as "Amoxicillin/Clavulanate (Oral Pill)" with a separate __Strength__ column ("250-125 mg"), distinct from Dose. Resolved from an embedded __offline__ RxTerms crosswalk (no external calls; ~21k drugs), with an optional RxNav API fallback for uncovered codes. Opt-in via `medications.rxterms_enrich` ([#387](https://github.com/jwilleke/yourphr/issues/387))
- __dev:__ `make serve-frontend-lan` — run the dev frontend on `0.0.0.0` so other LAN devices can reach it

### Bug Fixes

- __medications:__ DailyMed "FDA label" links now resolve — search by the simplified ingredient name instead of the full RxNorm string, which never matched ([#386](https://github.com/jwilleke/yourphr/issues/386))

## [1.12.1](https://github.com/jwilleke/yourphr/compare/v1.12.0...v1.12.1) (2026-07-01)

### Bug Fixes

- __encounter:__ suppress the raw vendor-local class code from the card — Epic's local "HOV" (and any non-standard class code) no longer renders as a cryptic "Class:" row; only recognized standard ActCodes (AMB/IMP/EMER/…) surface, and the Type row + title already convey the setting ([#371](https://github.com/jwilleke/yourphr/issues/371))

### Documentation

- add `docs/devserver.md` — how to run + check the local dev servers, plus the dev test accounts

## [1.12.0](https://github.com/jwilleke/yourphr/compare/v1.11.2...v1.12.0) (2026-06-25)

### Features

- __conditions:__ deduped "problem list" view — a new `condition.Reconcile` + `/conditions/reconciled` collapses the same problem reported as multiple Condition resources (per-visit diagnoses + a problem-list entry) into one entry. Problem-list views (medical-history, dashboard, medical concerns, patient profile) now show one entry per condition instead of duplicates like "Ischemic chest pain" ×3. `/conditions/classified` stays faithful 1:1 ([#262](https://github.com/jwilleke/yourphr/issues/262))

### Bug Fixes

- __medical-history:__ omit `entered-in-error` records from display — resources the source marked a mistake (e.g. Cerner documents that were entered in error, previously shown titled "Error") are no longer surfaced, consistent with how conditions are handled ([#384](https://github.com/jwilleke/yourphr/issues/384))

## [1.11.2](https://github.com/jwilleke/yourphr/compare/v1.11.1...v1.11.2) (2026-06-25)

### Bug Fixes

- __security:__ confine the backup destination to an allowlist of roots (data volume + configured `backup.destination` + `backup.allowed-roots`), rejecting relative paths and `..` escapes — fixes a CodeQL path-injection where the admin-provided destination flowed into a filesystem path ([#383](https://github.com/jwilleke/yourphr/issues/383))
- __medical-history:__ surface the legible encounter label for vendor-local class codes (e.g. Epic `class` = `HOV` now shows "Outpatient" from `type[].text`) instead of the raw code; guarded by a real Epic-sandbox golden test ([#262](https://github.com/jwilleke/yourphr/issues/262))

### Performance

- __medical-history:__ lazy-load the by-Type resource universe only when the Type tab is opened, instead of fetching all 7 resource types on every page visit ([#354](https://github.com/jwilleke/yourphr/issues/354))

## [1.11.1](https://github.com/jwilleke/yourphr/compare/v1.11.0...v1.11.1) (2026-06-22)

### Bug Fixes

- __backup/restore hardening__ (from code review): required pre-restore safety copy + atomic restore swap; anchored backup-filename matching (foreign files no longer listable/prunable/restorable); unique per-backup temp dir; private (0700) download temp; legacy `.backup_dest` destination migration; best-effort + pruned pre-restore backup; single shared `HH:MM` parser; destination-aware scheduler ([#368](https://github.com/jwilleke/yourphr/issues/368))
- __security:__ gate backup + restore (refuse with a clear error) when at-rest database encryption is enabled, so an encrypted DB can't be written to a plaintext snapshot or restored into an unopenable state ([#367](https://github.com/jwilleke/yourphr/issues/367))

## [1.11.0](https://github.com/jwilleke/yourphr/compare/v1.10.0...v1.11.0) (2026-06-21)

### Features

- __medical-history:__ group by __Type__ — completes the group-by selector (Date · Condition · Provider · Place · Type); each pivots into a master/detail with honest counts ([#351](https://github.com/jwilleke/yourphr/issues/351))
- __medical-history:__ the detail pane now renders the rich `/explore` record card per visit, with a __raw-FHIR__ toggle and __copy to clipboard__ ([#351](https://github.com/jwilleke/yourphr/issues/351))
- __ui:__ consistent link styling (blue + underlined) and a 3-role button convention — primary / neutral / danger ([#366](https://github.com/jwilleke/yourphr/issues/366))

### Bug Fixes

- __medical-history:__ fix a fhir-card re-mount request storm (`net::ERR_INSUFFICIENT_RESOURCES`) ([#351](https://github.com/jwilleke/yourphr/issues/351))
- __security:__ harden backup/restore paths (restore allowlist + path hygiene); remaining CodeQL findings are admin-by-design and dismissed ([#365](https://github.com/jwilleke/yourphr/issues/365))

### Docs

- document the backup & restore system under `docs/recovery/` ([#361](https://github.com/jwilleke/yourphr/issues/361), [#362](https://github.com/jwilleke/yourphr/issues/362))

## [1.10.0](https://github.com/jwilleke/yourphr/compare/v1.9.0...v1.10.0) (2026-06-21)

### Features

- __admin:__ the footer now shows the __running__ app version as `{channel}-{semver}` (e.g. `dev-1.9.0`, `prod-1.10.0`), fetched live from a new public `GET /api/version` endpoint — instead of a static placeholder ([#361](https://github.com/jwilleke/yourphr/issues/361))
- __admin:__ backup filenames embed the producing app __version__ and an optional instance __label__ (`backup.label` / `YOURPHR_BACKUP_LABEL`), so backups are self-identifying, e.g. `2026-06-21T14-09-57Z-yourphr-prod-1.10.0-backup.db.gz` ([#361](https://github.com/jwilleke/yourphr/issues/361))

## [1.9.0](https://github.com/jwilleke/yourphr/compare/v1.8.1...v1.9.0) (2026-06-21)

### Features

- __admin:__ full Database backup workflow — on-demand __Download__ (browser Save dialog + spinner) or fire-and-forget __Back up to server__; __gzip__ backups with date-first ISO filenames; a __settable schedule__ (enable + time-of-day + days + retention; applied with no restart); and a __browseable__ destination folder ([#361](https://github.com/jwilleke/yourphr/issues/361))
- __admin:__ __restore__ the database from a backup — staged, validated (`integrity_check`), with an auto-backup of the current DB first, applied safely on the next restart; covered by a verifiable backup→restore round-trip test ([#362](https://github.com/jwilleke/yourphr/issues/362))

## [1.8.1](https://github.com/jwilleke/yourphr/compare/v1.8.0...v1.8.1) (2026-06-21)

### Features

- __admin:__ Database-card backups write to a __selectable destination folder that persists until changed__, with canonical sortable filenames (`yourphr-backup-YYYY-MM-DD-HHMMSS.db`) and a list of existing backups ([#361](https://github.com/jwilleke/yourphr/issues/361))
- __admin:__ __in-app scheduled backups__ — opt-in `backup.interval_hours` + `backup.retention` (prune), surfaced in the Database card ([#361](https://github.com/jwilleke/yourphr/issues/361))

## [1.8.0](https://github.com/jwilleke/yourphr/compare/v1.7.0...v1.8.0) (2026-06-21)

### Features

- __admin:__ Database card on the Admin dashboard (`/admin/database`) — shows DB location on disk, encryption-at-rest status, size, integrity, and user/source counts, plus a one-click __Backup now__ that streams a safe online snapshot (SQLite `VACUUM INTO`). Admin-only; the backup is the full multi-user PHI database ([#361](https://github.com/jwilleke/yourphr/issues/361))

## [1.7.0](https://github.com/jwilleke/yourphr/compare/v1.6.1...v1.7.0) (2026-06-21)

### Features

- __allergies:__ dedicated `/allergies` page (like `/medications`) — a __deduped__ list (one entry per substance, not repeated per encounter), titled by the record's text/display, with a first-seen → last-seen date range, reactions, criticality and state; "No known allergy" notes shown as their own entries, never counted as allergies ([#290](https://github.com/jwilleke/yourphr/issues/290))
- __immunizations:__ dedicated `/immunizations` page — deduped by vaccine with a __dose count__ and last-administered date ([#289](https://github.com/jwilleke/yourphr/issues/289))
- __dashboard:__ Allergies and Immunizations tiles route to the new dedicated pages; `/patient-profile` is now demographics + personal/social only ([#289](https://github.com/jwilleke/yourphr/issues/289))

## [1.6.1](https://github.com/jwilleke/yourphr/compare/v1.6.0...v1.6.1) (2026-06-21)

### Bug Fixes

- __allergies:__ "No Known X" negation assertions no longer inflate the allergy count or list as allergies — the classifier flags `noKnown` (SNOMED `716186003` et al. + "No Known…" text), the dashboard tile counts real allergies only, and /patient-profile shows a single "No known allergies on record" line ([#290](https://github.com/jwilleke/yourphr/issues/290))
- __dashboard:__ the Allergies and Immunizations tiles route to `/patient-profile` (where the data lives) instead of dead-ending at `/medical-history`; the cards now expand inline instead of hover-only ([#289](https://github.com/jwilleke/yourphr/issues/289))

## [1.6.0](https://github.com/jwilleke/yourphr/compare/v1.5.0...v1.6.0) (2026-06-21)

### Features

- __medical-history:__ Condition dimension sourced from `/conditions/classified` — the by-Condition rail lists every canonical condition (not only encounter-linked ones) with its clinical state and linked visits ([#359](https://github.com/jwilleke/yourphr/issues/359))

### Build / CI

- __deploy:__ release-gated deploys — the docker image is built + published only on a release tag (vX.Y.Z); Flux deploys strictly off semver tags. Pushes to main are CI-tested but no longer auto-deploy ([#241](https://github.com/jwilleke/yourphr/issues/241))
- __e2e:__ unblock E2E — firefox-ignore data/download specs; quarantine the lforms-modal wizard under [#131](https://github.com/jwilleke/yourphr/issues/131)
- __deps:__ Dependabot bumps across go / npm / github-actions; rejected gorm.io/driver/sqlite 1.6.0 (breaks the encrypted-DB tests)

## [1.5.0](https://github.com/jwilleke/yourphr/compare/v1.4.0...v1.5.0) (2026-06-20)

### Features

- __medical-history:__ master-detail group/filter shell ([#358](https://github.com/jwilleke/yourphr/issues/358)) ([7d855a0](https://github.com/jwilleke/yourphr/commit/7d855a0cfa046799df020c7c447b1db5bb106480))
- __medical-history:__ pure grouping logic for the group/filter view ([#351](https://github.com/jwilleke/yourphr/issues/351)) ([64f65a1](https://github.com/jwilleke/yourphr/commit/64f65a1616a4ca34b5273b6771b6e77d80a2f293))

## [1.4.0](https://github.com/jwilleke/yourphr/compare/v1.3.0...v1.4.0) (2026-06-20)

### Features

- __display:__ patient-legible detail cards — shared "Reported by" provenance + synthesized state/verification/category summary, rendered for every classifier-backed type ([#308](https://github.com/jwilleke/yourphr/issues/308))
- __display:__ Layer-1 classifiers for AllergyIntolerance, Immunization, Procedure, DiagnosticReport, Encounter, CarePlan — legible state/verification/category synthesis ([#309](https://github.com/jwilleke/yourphr/issues/309))
- __provenance:__ generic resolver now resolves `performer` (Procedure/Immunization/DiagnosticReport/Observation), attached on every read ([#309](https://github.com/jwilleke/yourphr/issues/309))
- __smart:__ follow DocumentReference/DiagnosticReport → Binary on import so document bytes are retrievable ([#342](https://github.com/jwilleke/yourphr/issues/342))
- __frontend:__ open/render + download stored Binary documents; graceful "unavailable" state ([#349](https://github.com/jwilleke/yourphr/issues/349))
- __sources:__ Oracle Health / Cerner sandbox working — enumerated v2 `.rs` scopes incl. Binary + higher-signal types ([#338](https://github.com/jwilleke/yourphr/issues/338), [#343](https://github.com/jwilleke/yourphr/issues/343))
- __sources:__ CMS Blue Button 2.0 SMART source incl. confidential-client support; end-to-end verified ([#250](https://github.com/jwilleke/yourphr/issues/250), [#279](https://github.com/jwilleke/yourphr/issues/279))
- __sources:__ split connected sources into Sandbox vs Production; admin-editable catalog ([#291](https://github.com/jwilleke/yourphr/issues/291), [#330](https://github.com/jwilleke/yourphr/issues/330))

### Bug Fixes

- __smart:__ import-engine resilience — timeout, retry, two-pass fetch, incremental upsert, graceful degradation ([#341](https://github.com/jwilleke/yourphr/issues/341))
- __security:__ bump undici to 6.27.0 and frontend build-tooling deps for Dependabot alerts ([#350](https://github.com/jwilleke/yourphr/issues/350), [#344](https://github.com/jwilleke/yourphr/issues/344))

## [1.3.0](https://github.com/jwilleke/yourphr/compare/v1.2.0...v1.3.0) (2026-06-17)

### Features

- __account:__ Account Profile page; move Delete Account off Patient Profile ([#274](https://github.com/jwilleke/yourphr/issues/274), phase 1) ([c348b68](https://github.com/jwilleke/yourphr/commit/c348b68a40c7fa95f853feca3a5ae964e0b785bf))
- __account:__ change password ([#274](https://github.com/jwilleke/yourphr/issues/274), phase 2) ([d395a0b](https://github.com/jwilleke/yourphr/commit/d395a0b0f6e0e6d11fa0305de85b7b71d5cec35b))
- __admin:__ add Sandbox Testing card to Admin Dashboard ([7deffff](https://github.com/jwilleke/yourphr/commit/7deffffe3ee47687f9f3867ab928da0de52b2570))
- __api:__ recent-resources and record-search endpoints ([b73337f](https://github.com/jwilleke/yourphr/commit/b73337f27195691001898906f1bfec4f75f834ab)), closes [#266](https://github.com/jwilleke/yourphr/issues/266)
- __ci:__ add canonical markdown-lint.yml from kit ([bdfe6ce](https://github.com/jwilleke/yourphr/commit/bdfe6ce995c70d169279676025af556da3c5e54e))
- __conditions:__ Medical Concerns list view with provenance + consumer links ([#266](https://github.com/jwilleke/yourphr/issues/266)) ([e19986b](https://github.com/jwilleke/yourphr/commit/e19986b95504a820f64f2de6f2950d23c2594112))
- __conditions:__ Personal & social section on Patient Profile; route tile there ([#266](https://github.com/jwilleke/yourphr/issues/266)) ([beca64c](https://github.com/jwilleke/yourphr/commit/beca64c05265c19ef3377ecc965c0a190dd3645d))
- __condition:__ surface resolved provenance on /conditions/classified ([ff1bfe7](https://github.com/jwilleke/yourphr/commit/ff1bfe7cadce2c2e2f31632db9b1cc0a12951bd6))
- __config:__ rename env prefix FASTEN_*-&gt; YOURPHR_* + load .env/.env_custom ([085a392](https://github.com/jwilleke/yourphr/commit/085a3924a804ba8119a230667e2eb94b42e61cb0))
- __connect:__ add Client Secret field to the SMART connect form (confidential clients) ([e6b4068](https://github.com/jwilleke/yourphr/commit/e6b40684bfb5c58e8402cc69c2fe80624b7b6b2c))
- __connect:__ make SMART login-wait window operator-tunable from backend config (no frontend rebuild) ([e1d198a](https://github.com/jwilleke/yourphr/commit/e1d198aeba400f25697418cb7b225b99c50fea2b)), closes [#292](https://github.com/jwilleke/yourphr/issues/292)
- __coverage:__ GET /api/secure/coverages/classified endpoint ([#295](https://github.com/jwilleke/yourphr/issues/295)) ([ffb957a](https://github.com/jwilleke/yourphr/commit/ffb957aa85e19ff6bc0c5e3679463310115c1ac0))
- __coverage:__ Medicare Coverage classifier ([#295](https://github.com/jwilleke/yourphr/issues/295)) ([ae553dd](https://github.com/jwilleke/yourphr/commit/ae553ddfad06aea1ebf624e8b29ffe8391b18505))
- __dashboard:__ classify conditions into health problems vs patient profile ([6758151](https://github.com/jwilleke/yourphr/commit/675815134f7d6a9f27a876c1033c09429596099a))
- __dashboard:__ clean default into a patient-first "Patient Dashboard" ([#262](https://github.com/jwilleke/yourphr/issues/262)/[#244](https://github.com/jwilleke/yourphr/issues/244)) ([314db4c](https://github.com/jwilleke/yourphr/commit/314db4c4474ab2dc0ee7193751e134b6bf94cf0b))
- __dashboard:__ collapse Concerns & Patient Profile into compact tiles ([345df1d](https://github.com/jwilleke/yourphr/commit/345df1d3182e823be0c738061fdc1d84b7282a60))
- __dashboard:__ colored, patient-settable category tiles ([18a1612](https://github.com/jwilleke/yourphr/commit/18a161229309369f8c7124acc944d9afae43966f)), closes [#266](https://github.com/jwilleke/yourphr/issues/266)
- __dashboard:__ generic profile-summary widget + Cures-Act core config ([#245](https://github.com/jwilleke/yourphr/issues/245)) ([2a35fc8](https://github.com/jwilleke/yourphr/commit/2a35fc8fdd5920376d61b7a30917ca6c3a19a3d8))
- __dashboard:__ patient-first tile dashboard with Current Medical Concerns ([4b4b439](https://github.com/jwilleke/yourphr/commit/4b4b439a8d72369321cc995659bf27f89a43b5a4))
- __dashboard:__ personalized greeting, record search, recent activity; initials avatar ([5e07945](https://github.com/jwilleke/yourphr/commit/5e07945923ec1eeb9e295881d5986b8997cd9c4b)), closes [#266](https://github.com/jwilleke/yourphr/issues/266)
- __deploy:__ package + deploy the C-CDA converter sidecar — Phase 2 ([#254](https://github.com/jwilleke/yourphr/issues/254)) ([16a93e3](https://github.com/jwilleke/yourphr/commit/16a93e3d422ad75505402017ef5f560f49e66264))
- __document:__ DocumentReference classifier + /documents/classified ([9d142f0](https://github.com/jwilleke/yourphr/commit/9d142f02ec54d0842bf530068fe6bc6076e816b3))
- __eob:__ ExplanationOfBenefit (Medicare claims) classifier + endpoint ([#294](https://github.com/jwilleke/yourphr/issues/294)) ([94be9ce](https://github.com/jwilleke/yourphr/commit/94be9ce43c5776e74c9bcc502adf9bab7f1880b7))
- __frontend:__ upgrade Bootstrap 4 -&gt; 5.3 with transitional compat shims ([6d3eb3a](https://github.com/jwilleke/yourphr/commit/6d3eb3aadaba5ef58ed910a2bc7738a5c230fc7b))
- __import:__ C-CDA/CCD upload via fhir-converter sidecar — Phase 1 ([#254](https://github.com/jwilleke/yourphr/issues/254)) ([7b222d8](https://github.com/jwilleke/yourphr/commit/7b222d894c1940873c63ed7fe3274d2ee8f86ae0))
- __import:__ route CCDA upload through self-hosted converter — Phase 3 ([#254](https://github.com/jwilleke/yourphr/issues/254)) ([6f2978c](https://github.com/jwilleke/yourphr/commit/6f2978ca50b7a15d54d52504e734a7fc2a7970d1))
- __medications:__ resolve drug name from a separate Medication reference ([#262](https://github.com/jwilleke/yourphr/issues/262)) ([c545945](https://github.com/jwilleke/yourphr/commit/c5459450fbead7f161b597331a1c142f2c112e6e))
- __medication:__ surface resolved provenance on /medications/reconciled ([62ae9ae](https://github.com/jwilleke/yourphr/commit/62ae9ae210797646fba6ad2f08143b1d329c15b6))
- __medication:__ surface resolved provenance on Current Medications view ([#264](https://github.com/jwilleke/yourphr/issues/264)) ([1984d7d](https://github.com/jwilleke/yourphr/commit/1984d7d03a8ff50e76b82b6ee51f92678fa764ee))
- __observation:__ vitals legibility recognizer + /vitals/recognized ([6fd870c](https://github.com/jwilleke/yourphr/commit/6fd870c1f7326b03b7829365b3f19a7f2104b4ed))
- __patientlink:__ associate EOB & Coverage to the imported patient ([#296](https://github.com/jwilleke/yourphr/issues/296)) ([35d4f3d](https://github.com/jwilleke/yourphr/commit/35d4f3d6f114fe248126876ca1576fc0a85ed4a2))
- __procedures:__ /procedures Medical History list view ([#275](https://github.com/jwilleke/yourphr/issues/275)) ([98475bd](https://github.com/jwilleke/yourphr/commit/98475bde948a0bbef96b2a69044f11304752814f))
- __provenance:__ add USCDI Author Time Stamp to resolved provenance ([0aa1c75](https://github.com/jwilleke/yourphr/commit/0aa1c75c31874bbd64b6ea459a87a66b8ee62223))
- __provenance:__ attach provenance on the resource-graph endpoint too ([1193e75](https://github.com/jwilleke/yourphr/commit/1193e75258052c6fbdf3ce2898bd52a41fc05e14)), closes [#271](https://github.com/jwilleke/yourphr/issues/271)
- __provenance:__ attach resolved provenance on the generic resource read path ([c523fe8](https://github.com/jwilleke/yourphr/commit/c523fe8be019a08a1da6768515c351cf5a58dd21))
- __provenance:__ reference + provenance resolver (Phase 2 plumbing) ([3ce358d](https://github.com/jwilleke/yourphr/commit/3ce358d02c3a1524a326c6505d95ca760937c299))
- __provenance:__ resolve PractitionerRole -&gt; Practitioner/Organization ([36eb646](https://github.com/jwilleke/yourphr/commit/36eb646f2b1faab123a196d80ad8774651a2c3a7)), closes [#270](https://github.com/jwilleke/yourphr/issues/270)
- __provenance:__ show "who said this" on every fhir-card (consume [#271](https://github.com/jwilleke/yourphr/issues/271)) ([332da93](https://github.com/jwilleke/yourphr/commit/332da9376601a9957dbfc6f555a402ef6123b3af))
- __provider-catalog:__ admin-configured source catalog backend ([#304](https://github.com/jwilleke/yourphr/issues/304)) ([0ae8ff4](https://github.com/jwilleke/yourphr/commit/0ae8ff41b1cd2b7ff7e145e613742a6ab4874408))
- __provider-catalog:__ seed default Blue Button + Epic entries (credential-free, disabled) ([#304](https://github.com/jwilleke/yourphr/issues/304)) ([b11a5f0](https://github.com/jwilleke/yourphr/commit/b11a5f019bc3b3ca2ef91e0b3370fa1d629bfd2c))
- __sandbox:__ add SMART Health IT, Oracle/Cerner, athenahealth prefills ([557cc7c](https://github.com/jwilleke/yourphr/commit/557cc7c668a57468b8dc37ad15a577809cb702fc))
- __sandbox:__ move BYO SMART connect to admin-only /sandbox page ([ab45110](https://github.com/jwilleke/yourphr/commit/ab4511008b2d84e4348d8090b0aabdc9c427825a))
- __smart:__ CapabilityStatement-driven fetch for providers without \$everything ([#250](https://github.com/jwilleke/yourphr/issues/250)) ([f090d6c](https://github.com/jwilleke/yourphr/commit/f090d6c587f221a3fc4053fe37d5b201c7cf5106))
- __smart:__ confidential-client (client_secret) support ([#286](https://github.com/jwilleke/yourphr/issues/286)) ([2647800](https://github.com/jwilleke/yourphr/commit/2647800e67ba2bf93baf45af4db3c54087fb959a))
- __sources:__ Epic SMART sandbox setup + one-click connect ([#257](https://github.com/jwilleke/yourphr/issues/257)) ([#260](https://github.com/jwilleke/yourphr/issues/260)) ([0c9652b](https://github.com/jwilleke/yourphr/commit/0c9652b04b98743ef52708a4bb381bd30a1bf211))
- __upload:__ ingest raw PDF/DICOM/image uploads as Binary + DocumentReference ([8b17c48](https://github.com/jwilleke/yourphr/commit/8b17c4801b02e1b31e0855f53ebed027ba926812))
- __us-core:__ add CarePlan card + complete Must-Support display ([#214](https://github.com/jwilleke/yourphr/issues/214)) ([9d53467](https://github.com/jwilleke/yourphr/commit/9d534675e68938b5f8c88ab0847f06ba337599c1)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ add CareTeam + Goal cards ([#215](https://github.com/jwilleke/yourphr/issues/215), [#216](https://github.com/jwilleke/yourphr/issues/216)) ([1024889](https://github.com/jwilleke/yourphr/commit/102488963e267aef56e1aff32723e90c236026ab)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ add dedicated Condition card (Problems & Health Concerns) ([#246](https://github.com/jwilleke/yourphr/issues/246)) ([86a87ee](https://github.com/jwilleke/yourphr/commit/86a87ee9b8f40c84cdd35a45dd7485d0a55f8d4a)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ add Device + Coverage cards ([#217](https://github.com/jwilleke/yourphr/issues/217), [#218](https://github.com/jwilleke/yourphr/issues/218)) ([370f377](https://github.com/jwilleke/yourphr/commit/370f3776b0f6b2bc5e52431c7758ed798fcc4080)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ add RelatedPerson + FamilyMemberHistory cards ([#222](https://github.com/jwilleke/yourphr/issues/222), [#223](https://github.com/jwilleke/yourphr/issues/223)) ([bb95869](https://github.com/jwilleke/yourphr/commit/bb95869799c180929b34576cd0dd67bfae861b54)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ build ServiceRequest + Specimen models + cards ([#219](https://github.com/jwilleke/yourphr/issues/219), [#220](https://github.com/jwilleke/yourphr/issues/220)) ([3a558f8](https://github.com/jwilleke/yourphr/commit/3a558f883f1eb59ab4bc40e42fba83c2c2432c60)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ complete DiagnosticReport Must-Support display ([#213](https://github.com/jwilleke/yourphr/issues/213)) ([56b2c4f](https://github.com/jwilleke/yourphr/commit/56b2c4f7c4f4759ec47ca37be4ea56f37f8870b2)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ complete Procedure Must-Support display ([#212](https://github.com/jwilleke/yourphr/issues/212)) ([9debe41](https://github.com/jwilleke/yourphr/commit/9debe41dc1802943476595263877d96cdd1839cc)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ display-conformance gate vs US Core 9.0.0 examples ([#248](https://github.com/jwilleke/yourphr/issues/248)) ([8b59471](https://github.com/jwilleke/yourphr/commit/8b5947185aa97cff5c7cdb6d932d04cbde87612c))
- __us-core:__ MedicationDispense performer + dosageInstruction display ([1db04a3](https://github.com/jwilleke/yourphr/commit/1db04a3125f6a1aa86540486411806e909daca36)), closes [#136](https://github.com/jwilleke/yourphr/issues/136) [#221](https://github.com/jwilleke/yourphr/issues/221)
- __us-core:__ Observation interpretation + explicit "No result" for valueless obs ([#242](https://github.com/jwilleke/yourphr/issues/242)) ([e61df1e](https://github.com/jwilleke/yourphr/commit/e61df1e05a76095de81efc50f628f4489fe1e19a)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ PractitionerRole — enrich model + add card ([#247](https://github.com/jwilleke/yourphr/issues/247)) ([c72136b](https://github.com/jwilleke/yourphr/commit/c72136bccbd5747f8e7678c07222d25bc0f594c3)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ richer Encounter card — add subject (Patient) + serviceType ([#240](https://github.com/jwilleke/yourphr/issues/240)) ([fd61747](https://github.com/jwilleke/yourphr/commit/fd6174786fa75fdfcd44c1a3dbbafb8ec506cc94)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ surface Observation sub-profile classification, incl. inferred ([#243](https://github.com/jwilleke/yourphr/issues/243)) ([466c5dd](https://github.com/jwilleke/yourphr/commit/466c5dd0a53875d4a1d5b5a95d4693e0f91a29b5)), closes [#136](https://github.com/jwilleke/yourphr/issues/136)
- __us-core:__ surface the 6 remaining Must-Support display gaps (44/44) ([e217451](https://github.com/jwilleke/yourphr/commit/e21745111ada8c4a32d23cd8e689d1146caa36fd))

### Bug Fixes

- __build:__ raise prod initial-bundle budget to 12mb error / 10mb warning ([3b97d5c](https://github.com/jwilleke/yourphr/commit/3b97d5c7819a84755c4b7b583ac9127deb2739e4)), closes [#209](https://github.com/jwilleke/yourphr/issues/209)
- __ci:__ least-privilege permissions on markdown-lint workflow (CodeQL); P0 — [#303](https://github.com/jwilleke/yourphr/issues/303) closed ([5b4ed71](https://github.com/jwilleke/yourphr/commit/5b4ed714679439dde1d6f2df19c6e330d5f5d349))
- __condition:__ honor a source-declared Condition.category before synthesizing ([f4f2d30](https://github.com/jwilleke/yourphr/commit/f4f2d30924b9ac892a73c891c508f9a46058902d)), closes [#266](https://github.com/jwilleke/yourphr/issues/266)
- __connect:__ extend SMART login-wait window to 4 min; only retry relay timeouts ([f7275f8](https://github.com/jwilleke/yourphr/commit/f7275f866dc3ed6943a0f789f3c5ecae7d7aaf32))
- __connect:__ resolve Blue Button patient id from Coverage/EOB, not /Patient ([b1ca792](https://github.com/jwilleke/yourphr/commit/b1ca792c8057aac3737f9fbe7da4be9502971947)), closes [#293](https://github.com/jwilleke/yourphr/issues/293)
- __connect:__ resolve patient id from /Patient when the token omits it (Blue Button) ([9a6ee17](https://github.com/jwilleke/yourphr/commit/9a6ee17de31b9d1d2f62c306f0880394f4307862)), closes [#293](https://github.com/jwilleke/yourphr/issues/293)
- __connect:__ run initial SMART sync in background so connect returns promptly ([4557c23](https://github.com/jwilleke/yourphr/commit/4557c23c87fd6ae0654fbd6e505a2bd2ef9cd700)), closes [#293](https://github.com/jwilleke/yourphr/issues/293)
- __display:__ render structured dosage + route on MedicationStatement card ([#264](https://github.com/jwilleke/yourphr/issues/264)) ([fdaabf1](https://github.com/jwilleke/yourphr/commit/fdaabf1f185b2fa67fc4073f625f1482e4c41b68))
- __docs:__ markdownlint MD022/MD029/MD032 in dashboards brainstorm ([2e1c438](https://github.com/jwilleke/yourphr/commit/2e1c4383c90ffc0f07adf73055f886cd8ea61f1c))
- __e2e:__ smart-connect spec navigates to /sandbox (BYO connect moved there) ([09a4397](https://github.com/jwilleke/yourphr/commit/09a43972cc93213f130b97643b05b7a163eb8530))
- __kit:__ unwrap boilerplate bullet lines — long lines are fine per markdownlint ([9926535](https://github.com/jwilleke/yourphr/commit/9926535ae810dfbd4ac23024fc7389abbddaa2db))
- __lint:__ clear markdown-lint failures (MD049 emphasis + exclude LICENSE) ([eef0875](https://github.com/jwilleke/yourphr/commit/eef0875ba77e979f666f7c088242822c4b8d52ac))
- __lint:__ drop inferrable number annotation on getRecentResources param ([12c8931](https://github.com/jwilleke/yourphr/commit/12c8931659d5f39b21a3d6ade3b5e153526bd1c7))
- __lint:__ drop redundant gitignored-dir excludes from markdown-lint globs ([13023d6](https://github.com/jwilleke/yourphr/commit/13023d60a12824d09133fd2318f58adac990cee9))
- __lint:__ make CHANGELOG.md pass the same markdown rulebook (un-exclude it) ([90a9fea](https://github.com/jwilleke/yourphr/commit/90a9feab694dcadb9293a0fa4ac9e2f60723545d))
- __logging:__ default log.file so Admin Server Logs card works ([0fb734f](https://github.com/jwilleke/yourphr/commit/0fb734f31185a32fc72c4c3ed263d53c8fd15908))
- __patient-profile:__ stop showing fabricated Care Provider / ethnicity / religion ([e0655dd](https://github.com/jwilleke/yourphr/commit/e0655dd925e24c23d7fbee69e1344605524a7110))
- __security:__ add least-privilege permissions to workflows ([#259](https://github.com/jwilleke/yourphr/issues/259)) ([2c6c36a](https://github.com/jwilleke/yourphr/commit/2c6c36ad4ab8227895da9043ee97bd1814680155))
- __security:__ allowlist aggregation fn + field to prevent SQL injection ([#258](https://github.com/jwilleke/yourphr/issues/258)) ([21c961b](https://github.com/jwilleke/yourphr/commit/21c961b654475a0ebfbc285adfc6397ae766cee0))
- __security:__ bump @angular/* 20.3.24 -&gt; 20.3.25 (4 Dependabot CVEs) ([538058d](https://github.com/jwilleke/yourphr/commit/538058ddca0e156885d0ca0cbbd315c0e62d1a82))
- __security:__ bump esbuild to 0.28.1 (GHSA-gv7w-rqvm-qjhr, GHSA-g7r4-m6w7-qqqr) ([457b081](https://github.com/jwilleke/yourphr/commit/457b081c7c1bfe42236acf8a3e6f2515d7ead237)), closes [#272](https://github.com/jwilleke/yourphr/issues/272)
- __security:__ bump vite 7.3.5 + @babel/core 7.29.6 (transitive Dependabot alerts) ([fe82613](https://github.com/jwilleke/yourphr/commit/fe826131e0f5ed1e39da9b29466b3f93b704f281))
- __security:__ force all @angular/* to 20.3.25 via resolutions (transitive 20.3.24) ([2902d6f](https://github.com/jwilleke/yourphr/commit/2902d6f8c10030a68cfcdcdfa2e244389928602b))
- __security:__ SSRF guard for user-supplied FHIR base URL (CodeQL go/request-forgery) ([18dd789](https://github.com/jwilleke/yourphr/commit/18dd789529aea4672cf4b93c4679766e64fe9378))
- __test:__ unbreak backend connect tests under the SMART SSRF guard ([#302](https://github.com/jwilleke/yourphr/issues/302) regression) ([e7fb64d](https://github.com/jwilleke/yourphr/commit/e7fb64dfd439e192a050337d1fdfe61cfbd4f1d8))

### Miscellaneous Chores

- release 1.3.0 ([bcbb038](https://github.com/jwilleke/yourphr/commit/bcbb038a9c9bf9f66818506833771039a1ecd0b3))

## [1.2.0](https://github.com/jwilleke/yourphr/compare/v1.1.3...v1.2.0) (2026-06-10)

### Features

- :sparkles: Add local assets support for Google Fonts and Fonts Awesome ([8fa257b](https://github.com/jwilleke/yourphr/commit/8fa257b3a4e24b929665c0157ae54381e344e0cd))
- :sparkles: Add local assets support for Montserrat, Raleway and Roboto fonts ([c6ea211](https://github.com/jwilleke/yourphr/commit/c6ea2117a08f233d78fa5c1e81086f5ee1e318f2))
- :sparkles: Add local suppport for clinic tables assets ([e7c9f9b](https://github.com/jwilleke/yourphr/commit/e7c9f9bffd76ee1a0532fdc2e2b2c5aadd1fc190))
- add .env.example template for deployment variables ([#96](https://github.com/jwilleke/yourphr/issues/96)) ([774964d](https://github.com/jwilleke/yourphr/commit/774964d8d99c5a960459bd7284bcda26b08d838a))
- Add history endpoint based on practitioner id ([d9167cd](https://github.com/jwilleke/yourphr/commit/d9167cd801c1621f021ae14fc724e4356e137882))
- Add practitioner name in encounter history page ([b6308f8](https://github.com/jwilleke/yourphr/commit/b6308f87471d7014f6352ff8544a0ea6d1b1696a))
- Add practitioner name in header subtitle ([8e3a415](https://github.com/jwilleke/yourphr/commit/8e3a415688666542ba7f79370dc2151ae0f96ca0))
- Add source ID support on BE for favorites actions ([9c5a411](https://github.com/jwilleke/yourphr/commit/9c5a41130bf702f49522e61e68faabe903a68f04))
- Adjust filtering query on related resources ([506f165](https://github.com/jwilleke/yourphr/commit/506f1658e5708ada43432ad9e2143c9cbe35e2ea))
- __admin:__ Admin Dashboard with Server Logs card ([#170](https://github.com/jwilleke/yourphr/issues/170)) ([#191](https://github.com/jwilleke/yourphr/issues/191)) ([3fffeaa](https://github.com/jwilleke/yourphr/commit/3fffeaa13a2cb0db5a3d75005ddb25d54edbd896))
- __auth:__ derive current user/role from /me instead of decoding the JWT ([#117](https://github.com/jwilleke/yourphr/issues/117), [#103](https://github.com/jwilleke/yourphr/issues/103) Phase 2a) ([#119](https://github.com/jwilleke/yourphr/issues/119)) ([532472a](https://github.com/jwilleke/yourphr/commit/532472a64f9f95613673d7bd4a7ed3d51c826b78))
- __auth:__ drop localStorage token; rely on HttpOnly session cookie ([#118](https://github.com/jwilleke/yourphr/issues/118), [#103](https://github.com/jwilleke/yourphr/issues/103) Phase 2b) ([#122](https://github.com/jwilleke/yourphr/issues/122)) ([42dfbc4](https://github.com/jwilleke/yourphr/commit/42dfbc4e6865b86a9787e84aa7fd03f41925aa20))
- __auth:__ session-cookie fallback (header-primary), Phase 1 of [#103](https://github.com/jwilleke/yourphr/issues/103) (H2) ([#112](https://github.com/jwilleke/yourphr/issues/112)) ([393f477](https://github.com/jwilleke/yourphr/commit/393f4777b678be45d17a4987037698e6124ee74d))
- __brand:__ add YourPHR text-based SVG logo + icon, wire into app ([96e68de](https://github.com/jwilleke/yourphr/commit/96e68dec4cfca5e83988dc3b97c3829836b9aeb7))
- __brand:__ regenerate favicons/app-icons from YourPHR icon ([6277c1e](https://github.com/jwilleke/yourphr/commit/6277c1e61f26e4e08df3458838c0bbaf821726eb))
- __ci:__ emit main-&lt;run_number&gt; tag for Flux numerical image policy ([0365106](https://github.com/jwilleke/yourphr/commit/0365106c5b5d0ef9ef80df43c203dc15cc167448))
- __csp:__ staged enforcing CSP with runtime-computed report-only hashes ([#124](https://github.com/jwilleke/yourphr/issues/124)) ([a371057](https://github.com/jwilleke/yourphr/commit/a3710576799b4f6a8313843fceb7211750150399))
- __dashboard:__ Medications widget ([#185](https://github.com/jwilleke/yourphr/issues/185)) ([#186](https://github.com/jwilleke/yourphr/issues/186)) ([dfcbfd4](https://github.com/jwilleke/yourphr/commit/dfcbfd4e0a8a90d26068337e3279e639008aadee))
- __discovery:__ add ssdp server ([b76f963](https://github.com/jwilleke/yourphr/commit/b76f963a6c7ccba06d532e2a57f8888f04e326db))
- __discovery:__ take the application ip from upnp interaction ([aafac40](https://github.com/jwilleke/yourphr/commit/aafac4070ba12812e2d4ece432cb0b2f50b57708))
- __e2e:__ Playwright browser-interaction test harness + smoke suite ([#131](https://github.com/jwilleke/yourphr/issues/131)) ([2acc09f](https://github.com/jwilleke/yourphr/commit/2acc09f43090a7c81c11229adbc1db4d83532c64))
- Enforcing Database Encryption & Enable HTTPS by default ([#603](https://github.com/jwilleke/yourphr/issues/603)) ([210447e](https://github.com/jwilleke/yourphr/commit/210447e3f5e3538be5f7c8c6df5358ba5e8caf1d))
- __frontend:__ BYO SMART source connect flow ([#52](https://github.com/jwilleke/yourphr/issues/52)/[#53](https://github.com/jwilleke/yourphr/issues/53)) ([#76](https://github.com/jwilleke/yourphr/issues/76)) ([5f9069f](https://github.com/jwilleke/yourphr/commit/5f9069f13211ce9aa74fb98c583ad3f9a0962ab5))
- __frontend:__ connectSource API client for backend SMART connect ([#52](https://github.com/jwilleke/yourphr/issues/52) part 1) ([#69](https://github.com/jwilleke/yourphr/issues/69)) ([0c83237](https://github.com/jwilleke/yourphr/commit/0c83237751c1e4199614b66de29482e2325d089d))
- __frontend:__ rebrand UI to YourPHR ([1c5e8c4](https://github.com/jwilleke/yourphr/commit/1c5e8c4052fc62cfcabfe8f97d3b72a19e4bc46c))
- __frontend:__ remove "Join Mailing List" checkbox from signup ([a0b6a75](https://github.com/jwilleke/yourphr/commit/a0b6a75d00631839cc7ce59d277b22d4db5e554c))
- __frontend:__ remove upstream Reddit, converter-hosting & signup policy blocks ([4cd0ad4](https://github.com/jwilleke/yourphr/commit/4cd0ad4c05227cf4140c14080fab377ffbd1e7c6))
- __frontend:__ repoint upstream doc links to yourphr.org; rebrand az-logo ([9a6c074](https://github.com/jwilleke/yourphr/commit/9a6c07454ad139484b466f758e55f165308c8a6f))
- __frontend:__ upgrade Angular 14 → 15 (foundation [#12](https://github.com/jwilleke/yourphr/issues/12), Phase 2) ([#17](https://github.com/jwilleke/yourphr/issues/17)) ([3ba0cd6](https://github.com/jwilleke/yourphr/commit/3ba0cd62d42692acdd45c524dbb6d703c626a9f1))
- __frontend:__ upgrade Angular 15 → 16 (foundation [#12](https://github.com/jwilleke/yourphr/issues/12), Phase 2) ([#18](https://github.com/jwilleke/yourphr/issues/18)) ([a8e4f8d](https://github.com/jwilleke/yourphr/commit/a8e4f8d2a47aa2930d21a2d00b4677c96000adb3))
- __frontend:__ upgrade Angular 16 → 17 (foundation [#12](https://github.com/jwilleke/yourphr/issues/12), Phase 2) ([#19](https://github.com/jwilleke/yourphr/issues/19)) ([1e6e927](https://github.com/jwilleke/yourphr/commit/1e6e927423b82ff2cb253c29d27056276906f43b))
- __frontend:__ upgrade Angular 17 → 18 (foundation [#12](https://github.com/jwilleke/yourphr/issues/12), Phase 2) ([#39](https://github.com/jwilleke/yourphr/issues/39)) ([39551f9](https://github.com/jwilleke/yourphr/commit/39551f9eceef0b6b3a1fcfc260a82843fe8c1a55))
- __frontend:__ upgrade Angular 18 → 19 (foundation [#12](https://github.com/jwilleke/yourphr/issues/12), Phase 2) ([#40](https://github.com/jwilleke/yourphr/issues/40)) ([f0438eb](https://github.com/jwilleke/yourphr/commit/f0438eb43e6f7e3e5f47d5c300ce7f444c5dd95d))
- __frontend:__ upgrade Angular 19 → 20 (foundation [#12](https://github.com/jwilleke/yourphr/issues/12), Phase 2 — final) ([#41](https://github.com/jwilleke/yourphr/issues/41)) ([8a32030](https://github.com/jwilleke/yourphr/commit/8a32030f24233449b3b4976997112012ebd0e2d9))
- Implement get practitioner history flow on FE ([b5998d5](https://github.com/jwilleke/yourphr/commit/b5998d540a86a9c15d85af863153716aac4741f8))
- Integrate sort_id usage in FE flow, fix refresh favorites bug ([fa1d9e6](https://github.com/jwilleke/yourphr/commit/fa1d9e6d3a46dbe8935e022f4559912671927339))
- __ISSUE-564:__ :fire: Dark mode feature ([6b30783](https://github.com/jwilleke/yourphr/commit/6b30783b6051a01e0245585116136ca5af9b9a31))
- __ISSUE-564:__ 🔥 Dark mode feature ([e8aa036](https://github.com/jwilleke/yourphr/commit/e8aa036d35311b2478afec1dbde9a61980f6f7cb))
- __medications:__ Current Medications view ([#179](https://github.com/jwilleke/yourphr/issues/179)) ([#184](https://github.com/jwilleke/yourphr/issues/184)) ([c8f577a](https://github.com/jwilleke/yourphr/commit/c8f577aedbe69dc2b67d315d13dd0e1ec9891643))
- __medications:__ reconciled Current Medications endpoint ([#175](https://github.com/jwilleke/yourphr/issues/175)) ([#182](https://github.com/jwilleke/yourphr/issues/182)) ([016e929](https://github.com/jwilleke/yourphr/commit/016e9292c0c3fa437b68b408cc62755a605c89a7))
- __relay:__ friendly root handler at / ([#50](https://github.com/jwilleke/yourphr/issues/50)) ([#72](https://github.com/jwilleke/yourphr/issues/72)) ([b6cf801](https://github.com/jwilleke/yourphr/commit/b6cf8018608caf6521725bc4e136f04183cb3869))
- __relay:__ observability — log + Prometheus metrics on code arrival ([#50](https://github.com/jwilleke/yourphr/issues/50)) ([#77](https://github.com/jwilleke/yourphr/issues/77)) ([ac441d3](https://github.com/jwilleke/yourphr/commit/ac441d3dfc5ce11a8aed957c3abd060510562f04))
- __relay:__ self-hosted Go SMART OAuth store-and-poll relay ([#50](https://github.com/jwilleke/yourphr/issues/50)) ([#67](https://github.com/jwilleke/yourphr/issues/67)) ([6b2b242](https://github.com/jwilleke/yourphr/commit/6b2b2429c2bf53a754ce131a0162df36b7776c61))
- reserved username validation; security dep bumps; Roadmap.md ([5e85805](https://github.com/jwilleke/yourphr/commit/5e8580549e28742fca1c1149c89868f010010f1f))
- __resource-detail:__ add "Copy to Clipboard" button to debug-mode raw JSON ([#167](https://github.com/jwilleke/yourphr/issues/167)) ([#173](https://github.com/jwilleke/yourphr/issues/173)) ([6595dd4](https://github.com/jwilleke/yourphr/commit/6595dd4c27522f85abd5d8827c5cea548a6302ed))
- __search:__ index text-only CodeableConcepts in token extraction ([#171](https://github.com/jwilleke/yourphr/issues/171)) ([#194](https://github.com/jwilleke/yourphr/issues/194)) ([0c33826](https://github.com/jwilleke/yourphr/commit/0c33826789719a4a1f87fb91b1819630cb71c06d))
- __search:__ support token `:text` modifier ([#171](https://github.com/jwilleke/yourphr/issues/171)) ([#190](https://github.com/jwilleke/yourphr/issues/190)) ([7ad7dad](https://github.com/jwilleke/yourphr/commit/7ad7dad206a06edf89d4c3dda005d37c69244ab0))
- __security:__ add security response headers middleware ([#105](https://github.com/jwilleke/yourphr/issues/105), H4) ([#110](https://github.com/jwilleke/yourphr/issues/110)) ([d7708be](https://github.com/jwilleke/yourphr/commit/d7708be78219314ea9cd1496f859be95c8fea7ce))
- __security:__ enforce CSP (externalize index.html inline scripts) ([#105](https://github.com/jwilleke/yourphr/issues/105)) ([#113](https://github.com/jwilleke/yourphr/issues/113)) ([6c8d70e](https://github.com/jwilleke/yourphr/commit/6c8d70e38692b24fd67e60d019bd097df3909fe7))
- __smart-spike:__ Go SMART-on-FHIR sandbox proof-of-flow ([#48](https://github.com/jwilleke/yourphr/issues/48)) ([#56](https://github.com/jwilleke/yourphr/issues/56)) ([333eb9d](https://github.com/jwilleke/yourphr/commit/333eb9dccb967bdeac04a8feb1bfca3ab356e3e2))
- __smart:__ backend authorize-initiation endpoint ([#53](https://github.com/jwilleke/yourphr/issues/53)/[#51](https://github.com/jwilleke/yourphr/issues/51)) ([#75](https://github.com/jwilleke/yourphr/issues/75)) ([58d8db8](https://github.com/jwilleke/yourphr/commit/58d8db810483eb521f2153e2e9f822c0f871f250))
- __smart:__ backend polls the relay for the auth code ([#51](https://github.com/jwilleke/yourphr/issues/51)) ([#73](https://github.com/jwilleke/yourphr/issues/73)) ([1a6bb79](https://github.com/jwilleke/yourphr/commit/1a6bb79a826d2b916f2ba8da1f6fb46878cc84dc))
- __smart:__ backend SMART connect/token-exchange endpoint ([#51](https://github.com/jwilleke/yourphr/issues/51) part 1) ([#63](https://github.com/jwilleke/yourphr/issues/63)) ([d33bda0](https://github.com/jwilleke/yourphr/commit/d33bda077e2580fa9cbe62c917bd2f01ae203e1b))
- __smart:__ generic SMART-R4 client core — discovery/PKCE/token/fetch ([#49](https://github.com/jwilleke/yourphr/issues/49) part 1) ([#57](https://github.com/jwilleke/yourphr/issues/57)) ([11e58cd](https://github.com/jwilleke/yourphr/commit/11e58cd3ca997691d228bc899afca53fd97a2717))
- __smart:__ scheduled OAuth token-refresh worker ([#51](https://github.com/jwilleke/yourphr/issues/51)) ([#187](https://github.com/jwilleke/yourphr/issues/187)) ([94429d1](https://github.com/jwilleke/yourphr/commit/94429d1743fc222863e521148e3d5ad07468e7e2))
- __smart:__ wire generic SMART-R4 client into the factory ([#49](https://github.com/jwilleke/yourphr/issues/49) part 2) ([#59](https://github.com/jwilleke/yourphr/issues/59)) ([e6dc020](https://github.com/jwilleke/yourphr/commit/e6dc0203a938fb5a1833f98772eca2faf414a377))
- __sort:__ derive sort_title/sort_date for MedicationDispense + MedicationStatement ([#176](https://github.com/jwilleke/yourphr/issues/176)) ([#180](https://github.com/jwilleke/yourphr/issues/180)) ([a41fcd7](https://github.com/jwilleke/yourphr/commit/a41fcd70b0a7bb816ea06c2a3ed403655f4d5f09))
- sync ([b732aea](https://github.com/jwilleke/yourphr/commit/b732aea02598e74ba37c6372e21464340db84e67))
- __sync:__ Add Companion App Sync and Local Network Discovery ([c1cf3f1](https://github.com/jwilleke/yourphr/commit/c1cf3f172d0f38e9356e793ca99e586904871010))
- __ui:__ app-wide "Data Not Provided" missing-data component ([#178](https://github.com/jwilleke/yourphr/issues/178)) ([#181](https://github.com/jwilleke/yourphr/issues/181)) ([b5aac97](https://github.com/jwilleke/yourphr/commit/b5aac97ed7a99234cd28224ede1dfacb8a04bfe2))
- __ui:__ wire MedicationStatement model + MedicationDispense/Statement cards ([#177](https://github.com/jwilleke/yourphr/issues/177)) ([#183](https://github.com/jwilleke/yourphr/issues/183)) ([59db974](https://github.com/jwilleke/yourphr/commit/59db97435c679e2e124ec3616680211647f2a502))
- __us-core:__ add Provenance display model + card ([#162](https://github.com/jwilleke/yourphr/issues/162)) ([#163](https://github.com/jwilleke/yourphr/issues/163)) ([a3164fa](https://github.com/jwilleke/yourphr/commit/a3164faf5ea3a5352a90d503c63fe20c47a9fdc7))
- __us-core:__ add QuestionnaireResponse display model + card ([#160](https://github.com/jwilleke/yourphr/issues/160)) ([#164](https://github.com/jwilleke/yourphr/issues/164)) ([5ee567a](https://github.com/jwilleke/yourphr/commit/5ee567a1a1a3b35f81f4788705d0a9e0a44b3702))
- __us-core:__ complete AllergyIntolerance Must-Support display — clinicalStatus + reactions ([#145](https://github.com/jwilleke/yourphr/issues/145)) ([#155](https://github.com/jwilleke/yourphr/issues/155)) ([694fc7f](https://github.com/jwilleke/yourphr/commit/694fc7ff5cab09bfa52c395f979370b0d2f55e22))
- __us-core:__ complete Condition Must-Support display — verificationStatus, category, subject ([#143](https://github.com/jwilleke/yourphr/issues/143)) ([#156](https://github.com/jwilleke/yourphr/issues/156)) ([027f109](https://github.com/jwilleke/yourphr/commit/027f109081b12f6d0e6a59f2427e6f8f361852c5))
- __us-core:__ complete DocumentReference Must-Support display — subject, author, content.format ([#147](https://github.com/jwilleke/yourphr/issues/147)) ([#158](https://github.com/jwilleke/yourphr/issues/158)) ([7f58b86](https://github.com/jwilleke/yourphr/commit/7f58b86ac12e0384ecf48b4963734db947422aea))
- __us-core:__ complete MedicationRequest Must-Support display — subject, encounter, reported, category, dosage ([#144](https://github.com/jwilleke/yourphr/issues/144)) ([#157](https://github.com/jwilleke/yourphr/issues/157)) ([daad6ae](https://github.com/jwilleke/yourphr/commit/daad6ae1def08b560e9ed029ec14c04e46a1ffae))
- __us-core:__ complete Patient Must-Support display — tribal-affiliation + interpreter-needed ([#142](https://github.com/jwilleke/yourphr/issues/142)) ([#154](https://github.com/jwilleke/yourphr/issues/154)) ([aa885fb](https://github.com/jwilleke/yourphr/commit/aa885fb1c8404771f10fa486c8a875f604bc451b))
- __us-core:__ display the us-core-individual-sex 'Sex' element on the Patient card ([#142](https://github.com/jwilleke/yourphr/issues/142)) ([a3e29c7](https://github.com/jwilleke/yourphr/commit/a3e29c7beeebed6d8657a6d0e2b92f6755121029))
- __us-core:__ Observation profile registry + classification + multi-component BP ([#146](https://github.com/jwilleke/yourphr/issues/146)) ([#159](https://github.com/jwilleke/yourphr/issues/159)) ([b79933e](https://github.com/jwilleke/yourphr/commit/b79933ef43c8f1a952211954ec478ca682116f43))
- WIP on favorite actions integrations, add BE support and placeholder FE action ([87ac14b](https://github.com/jwilleke/yourphr/commit/87ac14ba55824bf145936e34c9cddef60c32e77c))
- WIP on Integrate mapping favorites table data and BE actions ([256a63e](https://github.com/jwilleke/yourphr/commit/256a63ec15af65c6aa65ae00e14fa6324c9ebe22))

### Bug Fixes

- Adjust name mapping on FE ([5951ef3](https://github.com/jwilleke/yourphr/commit/5951ef3076c6555c09bda0a0302cebe83c53b8d0))
- adjust variable name ([7084f31](https://github.com/jwilleke/yourphr/commit/7084f31a426f9961ac8e0c0be2d7357433abde4a))
- __allergy:__ display clinical/verification status from non-US-Core shapes + extract shared resolveStatus ([#54](https://github.com/jwilleke/yourphr/issues/54)) ([#169](https://github.com/jwilleke/yourphr/issues/169)) ([eeb9448](https://github.com/jwilleke/yourphr/commit/eeb944857f5523a9473cb9c99410b92b596de12d))
- __auth:__ auto-generate + persist JWT signing key on first run ([#102](https://github.com/jwilleke/yourphr/issues/102), Critical) ([#108](https://github.com/jwilleke/yourphr/issues/108)) ([4c70b2e](https://github.com/jwilleke/yourphr/commit/4c70b2ec82d21ac77a67d977922e266014f6ae17))
- __auth:__ stop username enumeration + rate-limit auth endpoints ([#104](https://github.com/jwilleke/yourphr/issues/104), H3) ([#111](https://github.com/jwilleke/yourphr/issues/111)) ([db9f406](https://github.com/jwilleke/yourphr/commit/db9f40601559289069d11eb347776cabb561322d))
- __brand:__ proper multi-size YourPHR favicon.ico ([f640846](https://github.com/jwilleke/yourphr/commit/f6408462526e9315c2256597cc0c0c475b0a0419)), closes [#2](https://github.com/jwilleke/yourphr/issues/2)
- __ci:__ repair GitHub Actions workflows and failing tests for fork ([c6aff60](https://github.com/jwilleke/yourphr/commit/c6aff60705e2cd5ab849ee1d3360bafdf46e514a))
- __condition:__ display clinical/verification status from non-US-Core shapes ([#54](https://github.com/jwilleke/yourphr/issues/54)) ([#168](https://github.com/jwilleke/yourphr/issues/168)) ([3748666](https://github.com/jwilleke/yourphr/commit/3748666c7f203f40ecd9768de0c0cf4e042c3dc1))
- __db:__ isolate per-table query session + bump datatypes to 1.2.7 (gorm 1.30) ([#95](https://github.com/jwilleke/yourphr/issues/95)) ([fb64451](https://github.com/jwilleke/yourphr/commit/fb64451e68035e11d27000718c948c456e5c1dc2))
- __deps:__ clear 7 fasten-sources-stub Dependabot alerts ([#85](https://github.com/jwilleke/yourphr/issues/85)) ([f20b64b](https://github.com/jwilleke/yourphr/commit/f20b64bb4600ca601d35567d485cb57782c73f9e))
- __deps:__ resolve 10 Dependabot alerts in frontend/yarn.lock ([#189](https://github.com/jwilleke/yourphr/issues/189)) ([dea2133](https://github.com/jwilleke/yourphr/commit/dea213311c4f3313057f02cf0432496bf5991bea))
- __deps:__ resolve 8 Dependabot alerts (frontend transitive + drop dead root lockfile) ([#149](https://github.com/jwilleke/yourphr/issues/149)) ([84f3411](https://github.com/jwilleke/yourphr/commit/84f34115132638e0c87d92fbd6e4fbdc8c85b992))
- __deps:__ upgrade lforms 34-&gt;42 to drop bundled vulnerable Angular 14 ([#114](https://github.com/jwilleke/yourphr/issues/114)) ([c2c9af6](https://github.com/jwilleke/yourphr/commit/c2c9af69abee0f1e3a497920567b66a635876777))
- __document-reference:__ align backend sort_title with card title order ([#201](https://github.com/jwilleke/yourphr/issues/201)) ([#202](https://github.com/jwilleke/yourphr/issues/202)) ([f585a17](https://github.com/jwilleke/yourphr/commit/f585a1716fe7da7d5e9b46e419cf84d63568c39b))
- __document-reference:__ meaningful titles for non-US-Core docs ([#198](https://github.com/jwilleke/yourphr/issues/198)) ([#199](https://github.com/jwilleke/yourphr/issues/199)) ([aa16664](https://github.com/jwilleke/yourphr/commit/aa166648de448796bd7f6cfb252b0f7ac04009c5))
- __e2e:__ create db/ dir before backend start so E2E works in CI ([#131](https://github.com/jwilleke/yourphr/issues/131)) ([1d3acf6](https://github.com/jwilleke/yourphr/commit/1d3acf62e23617b33022a6f01fae120784627e2d))
- __e2e:__ generate the test-account password at runtime, drop committed credential ([#132](https://github.com/jwilleke/yourphr/issues/132)) ([286436d](https://github.com/jwilleke/yourphr/commit/286436d026a4f43d09b7ba94d68311d8fff54d43))
- __e2e:__ readiness gate + scope data specs to chromium (Firefox CI flake) ([#131](https://github.com/jwilleke/yourphr/issues/131), [#148](https://github.com/jwilleke/yourphr/issues/148)) ([849bdf7](https://github.com/jwilleke/yourphr/commit/849bdf79f91c01ae920504da267831de80f12cb1))
- __encounter:__ proper non-US-Core Encounter display ([#54](https://github.com/jwilleke/yourphr/issues/54) follow-up) ([#195](https://github.com/jwilleke/yourphr/issues/195)) ([db6ed8f](https://github.com/jwilleke/yourphr/commit/db6ed8f0c04756dac4480c66e0c3d02bae295985))
- footer current-year + 'Starting import…' upload cue ([#204](https://github.com/jwilleke/yourphr/issues/204)) ([b147215](https://github.com/jwilleke/yourphr/commit/b1472151ee4a6c81a99439a4988c82f7c0dde37b))
- __footer:__ show semver version + canonical mission tagline ([#166](https://github.com/jwilleke/yourphr/issues/166)) ([#192](https://github.com/jwilleke/yourphr/issues/192)) ([baf0770](https://github.com/jwilleke/yourphr/commit/baf0770f2fe8bba25fced16c1a27513d9e50b65f))
- __frontend:__ make PWA manifest icon paths base-href-relative ([#126](https://github.com/jwilleke/yourphr/issues/126)) ([1621a0d](https://github.com/jwilleke/yourphr/commit/1621a0d73086d6d99b599091cfdaba3a96f71f94))
- __frontend:__ modal sits above ng-bootstrap backdrop (z-index) ([#78](https://github.com/jwilleke/yourphr/issues/78)) ([397641a](https://github.com/jwilleke/yourphr/commit/397641a82bcaf4e469c66d473e373f5f020edd68))
- __frontend:__ open SMART login popup synchronously ([#82](https://github.com/jwilleke/yourphr/issues/82)) ([#84](https://github.com/jwilleke/yourphr/issues/84)) ([d310f8f](https://github.com/jwilleke/yourphr/commit/d310f8f621e811cbf7f2124a350441be73fd6fa1))
- __frontend:__ stop loading oauth4webapi as a classic global script ([#125](https://github.com/jwilleke/yourphr/issues/125)) ([3355461](https://github.com/jwilleke/yourphr/commit/3355461621288ec9e24600ec25801d84f2644934))
- generate sort_title/sort_date for all key resource types ([dbeb79b](https://github.com/jwilleke/yourphr/commit/dbeb79b5b155d57b4a7289006e5d2bbdba80d8ff))
- handle FHIR List (contained) format in SyncAllBundle ([9ee1811](https://github.com/jwilleke/yourphr/commit/9ee1811dceb0b1ab3d1a6afd73a0afbae43ed1ba))
- implement SyncAllBundle in stub; regenerate mock; fix test expectations ([c16c5c2](https://github.com/jwilleke/yourphr/commit/c16c5c289b25ee60ee57c3f351336ed96cfdb7f9))
- __import:__ derive sort_title/sort_date for Appointment incl. non-US-Core shape ([#171](https://github.com/jwilleke/yourphr/issues/171)) ([#172](https://github.com/jwilleke/yourphr/issues/172)) ([dae3242](https://github.com/jwilleke/yourphr/commit/dae3242a05b708330568cefc530ca231632eb6c8))
- __import:__ keep manual import running if the client leaves the page ([#205](https://github.com/jwilleke/yourphr/issues/205)) ([#206](https://github.com/jwilleke/yourphr/issues/206)) ([ede2e1a](https://github.com/jwilleke/yourphr/commit/ede2e1a186de6e005d17a4ab3d0cca06134cf9d1))
- __import:__ resolve FollowMyHealth compound reference ids ([#196](https://github.com/jwilleke/yourphr/issues/196)) ([#197](https://github.com/jwilleke/yourphr/issues/197)) ([3cf2514](https://github.com/jwilleke/yourphr/commit/3cf25147707ed95c45410decb9f7489484b8e1d1))
- __import:__ stream manual upload via io.Copy instead of SaveUploadedFile ([#148](https://github.com/jwilleke/yourphr/issues/148)) ([865bc72](https://github.com/jwilleke/yourphr/commit/865bc72cae2fc28626614346702684c2a9942802))
- __import:__ surface the real temp-file error + harden temp handling ([#148](https://github.com/jwilleke/yourphr/issues/148)) ([9331e78](https://github.com/jwilleke/yourphr/commit/9331e78bcb8fd2d3f77a5b98833c91ac2bb2b5bc))
- Increase component style budget ([#607](https://github.com/jwilleke/yourphr/issues/607)) ([232932c](https://github.com/jwilleke/yourphr/commit/232932c74e82fe33773c3ffa21a820943efb031d))
- __ips:__ return 404 (not 500) when there is no patient data to summarize ([#148](https://github.com/jwilleke/yourphr/issues/148)) ([50fd6ad](https://github.com/jwilleke/yourphr/commit/50fd6adabe6797bc2681e79ea19dff2f02275940))
- __ISSUE-159:__ 🐛 Fixes [#159](https://github.com/jwilleke/yourphr/issues/159), added local assets for fonts and icons. ([cde2caa](https://github.com/jwilleke/yourphr/commit/cde2caacd94a512d842c418fbac08671888056d5))
- __ISSUE-159:__ 🐛 Fixes [#159](https://github.com/jwilleke/yourphr/issues/159), added local assets for fonts and icons. ([#574](https://github.com/jwilleke/yourphr/issues/574)) ([33e87cb](https://github.com/jwilleke/yourphr/commit/33e87cbef9546ae80dadb8aa034f8c6fb68bf735))
- __ISSUE-559:__ :bug: Fixes [#559](https://github.com/jwilleke/yourphr/issues/559), code clean up. ([#570](https://github.com/jwilleke/yourphr/issues/570)) ([cb50201](https://github.com/jwilleke/yourphr/commit/cb50201fcb641a5afa61bb38fca22456778c3931))
- __ISSUE-564:__ 🔥 Dark mode implementation ([#579](https://github.com/jwilleke/yourphr/issues/579)) ([7f7619b](https://github.com/jwilleke/yourphr/commit/7f7619b5cbfa06af4df3c3e88926f4881bb5e475))
- __relay:__ bump Dockerfile.relay to golang:1.26 (regression from [#92](https://github.com/jwilleke/yourphr/issues/92)) ([#107](https://github.com/jwilleke/yourphr/issues/107)) ([7b16447](https://github.com/jwilleke/yourphr/commit/7b16447d516cbc477f76b1ea3b55167e8a6a159d))
- __relay:__ log error_description on /callback provider errors ([#50](https://github.com/jwilleke/yourphr/issues/50)) ([#80](https://github.com/jwilleke/yourphr/issues/80)) ([ab65ae0](https://github.com/jwilleke/yourphr/commit/ab65ae0adeed8f88f06751bbe7928a6e5c7fd0ed))
- replace private fasten-sources with local stub to fix build ([cfb905c](https://github.com/jwilleke/yourphr/commit/cfb905c2aa74d6f1dce9da32efdf927b390b8799))
- reverse discovery route ([5378d9d](https://github.com/jwilleke/yourphr/commit/5378d9df1c2e6896bae3cb2ccf78f0c37266f161))
- revert e2e wip ([016d8a5](https://github.com/jwilleke/yourphr/commit/016d8a544eedf8653ff3e072d289a9755a4d858a))
- Revert upsert resource change ([8ff65ec](https://github.com/jwilleke/yourphr/commit/8ff65ec03af1bf0d83766f630bf87cea507b930f))
- run go mod vendor in Docker; drop committed vendor directory ([80f77a0](https://github.com/jwilleke/yourphr/commit/80f77a02201487b5adbdff8c5d884aee7d2bfc51))
- __security:__ enforce CSP via inline-script sha256 hashes ([#124](https://github.com/jwilleke/yourphr/issues/124)) ([936a8df](https://github.com/jwilleke/yourphr/commit/936a8dfdb05d79935a2fe6b4b66f6f79c1ea894d))
- seek bundleFile back to 0 after ExtractPatientId ([d2f9c88](https://github.com/jwilleke/yourphr/commit/d2f9c8818ec670543ddfc69c6a1c934346dd3165))
- set sort_title/sort_date for Encounter and Condition; fix encounter display fallbacks ([143913e](https://github.com/jwilleke/yourphr/commit/143913e547b632e254d9488c6aa6f2b4b8398ed1))
- stub FastenLighthouseEnvSandbox + ResourceInterface; skip go generate in Docker ([262ec2e](https://github.com/jwilleke/yourphr/commit/262ec2eb399dddd431cfad4dbc9679c06f8b04bb))
- Update specs, adjust no history data state ([eb5e95c](https://github.com/jwilleke/yourphr/commit/eb5e95cdf9d49ec542f564449a0274bcf94069a5))
- upgrade Dockerfile Go 1.21 → 1.24 to match toolchain directive ([44ad948](https://github.com/jwilleke/yourphr/commit/44ad94801ef548c95ae91b2609d2cd3353a4afb6))

### Performance Improvements

- __ci:__ stop running the test suite during the image build; cache Go + add clean-build toggle ([#121](https://github.com/jwilleke/yourphr/issues/121)) ([b0d6197](https://github.com/jwilleke/yourphr/commit/b0d6197f007072414221059b7726dd36abe67822))
- __ingest:__ compile the goja FHIRPath programs once, not per resource ([#151](https://github.com/jwilleke/yourphr/issues/151)) ([#153](https://github.com/jwilleke/yourphr/issues/153)) ([6db25d2](https://github.com/jwilleke/yourphr/commit/6db25d2ff038438ecef765b1e579b155c08fdf4e))

### Continuous Integration

- __docker:__ tag release images with semver + latest ([#203](https://github.com/jwilleke/yourphr/issues/203)) ([#207](https://github.com/jwilleke/yourphr/issues/207)) ([5f0755d](https://github.com/jwilleke/yourphr/commit/5f0755d33c930bbdb90be603e92e07e5c4f25502))
