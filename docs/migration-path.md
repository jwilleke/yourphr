# Migration path: Go to the TypeScript stack

A working checklist for the cut-over decided in [strategy-typescript-transition.md](planning/strategy-typescript-transition.md) and tracked on the Phase-5 ladder ([#583](https://github.com/jwilleke/yourphr/issues/583) – [#588](https://github.com/jwilleke/yourphr/issues/588), decision [#543](https://github.com/jwilleke/yourphr/issues/543)). It is for our own use: what moves by tool, what moves by hand, what does not move at all, and the order things happen in. Tick items as they land; the runbook proper is [#588](https://github.com/jwilleke/yourphr/issues/588) and will be cut from this page once the rollback has been rehearsed.

> __The order both instances move in__ is [`planning/getting-off-go.md`](planning/getting-off-go.md): `yourphr` first because downtime is acceptable there, `demo-yourphr` second because demo mode did not exist in the TypeScript stack yet. (It does now: [`guides/demo-mode.md`](guides/demo-mode.md).)
>
> __Two documents carry this out.__ [`deployment/cutover-runbook.md`](deployment/cutover-runbook.md) is *this* instance — kubectl, PVCs, the Ingress line — and now records the 2026-08-24 rehearsal: 20,068 records migrated and verified in 87 seconds, 53/53 id lists agreeing. [`deployment/upgrading-v2-to-v3.md`](deployment/upgrading-v2-to-v3.md) is everyone else, on Docker or bare metal, and is the one that decides whether v3 can ship to anybody but us.

Go is frozen (ratified 2026-08-20): patches only for security, data correctness and misrepresentation. Every new capability goes to [yourphr-ts-spike](https://github.com/jwilleke/yourphr-ts-spike).

__The decision (2026-08-21): the TypeScript stack replaces yourPHR once the two are at equal compatibility.__ [#543](https://github.com/jwilleke/yourphr/issues/543) is therefore *cut over*; the only open question is *when*, and *when* is the parity epic [#591](https://github.com/jwilleke/yourphr/issues/591) — parity meaning everything the household and the operator actually use on the live instance, enumerated by a route-by-route audit of the shared Angular app against the spike's HTTP layer, one child issue per gap. A Go feature nobody uses is retired, not ported.

## Where the ladder stands

| Rung | Issue | State |
|---|---|---|
| User accounts — bcrypt verify-then-rehash, nobody resets a password | [#583](https://github.com/jwilleke/yourphr/issues/583) | closed |
| Connected sources and their tokens — refresh and sync with no reconnect | [#584](https://github.com/jwilleke/yourphr/issues/584) | closed |
| Angular frontend served from the spike process | [#585](https://github.com/jwilleke/yourphr/issues/585) | closed |
| One-command, per-user, verified migration tool | [#586](https://github.com/jwilleke/yourphr/issues/586) | in review — verified against a production copy 2026-08-21: 20,068 records, 53/53 id lists agree |
| Package and deploy — image, release tagging, Flux entry | [#587](https://github.com/jwilleke/yourphr/issues/587) | v0.1.0 released; Flux `yourphr-ts` deployed alongside Go (no Ingress); waiting on the ghcr package being made public |
| Parity — what must work before the swap | [#591](https://github.com/jwilleke/yourphr/issues/591) | open — the gate for [#543](https://github.com/jwilleke/yourphr/issues/543) |
| Cut-over runbook — freeze, migrate, verify, swap, rollback rehearsed | [#588](https://github.com/jwilleke/yourphr/issues/588) | open |
| Cut over, keep both, or stop — decided once | [#543](https://github.com/jwilleke/yourphr/issues/543) | decided: cut over, gated on [#591](https://github.com/jwilleke/yourphr/issues/591) |

## What the tool migrates

`npm run migrate:go -- --go <copy.db> --data <spike data dir> --go-data <copy's dir> [--user <account>] [--go-answers <go-ids.json>]` in the spike repo. One-way and idempotent at every step; the Go database is opened read-only; exit 0 only when every (account, resource type) id list agrees.

| Go | Spike | How |
|---|---|---|
| `users` (live rows) | `auth_users` | username, bcrypt hash verbatim (rehashed to scrypt on first sign-in), `token_generation` carried so Go-side revocations stay revoked |
| `provider_catalog_entries` (live rows) | `provider_catalog` | by display name; client secret lands write-only; `enabled` and `authorize_url_override` carry |
| `source_credentials` (live rows, live users) | `connected_sources` | tokens and expiry verbatim; token endpoint rediscovered by the worker on first need; resource types derived from the granted scopes |
| every `fhir_*` row (live, live user) | `resources` + search index | `resource_raw` verbatim, id = `source_resource_id`, attributed `source-<spike id>` through the Go source id map |
| `config/app-custom-config.json` — four keys | config overlay | `backup.max-backups`, `backup.destination`, `jwt.session_ttl_minutes` → `auth.session.sliding-seconds` (×60), `jwt.session_absolute_hours` → `auth.session.absolute-seconds` (×3600) |

Verification is the exit criterion: per account, per type, the sorted id list in the Go tables against what the spike's search path returns; `--go-answers` adds `TestShadowExport` output, which reads through Go's own `GormRepository`. The 2026-08-21 production-copy run: 53/53 across three accounts, then 58/58 for the operator account with Go's own answers as the witness.

## What does not move by tool — required by hand

Each of these is reported by name in the tool's output; none is silent. Tick when done on the target instance or when decided not needed.

### Settings

- [ ] `operator.name`, `operator.contact_email`, `operator.contact_url` — the spike has no operator-contact setting yet. Decide: add the keys to the spike's `DefaultConfigSpec` (then the tool can translate them) or accept that the privacy/help pages show nothing until set.
- [ ] `backup.auto-backup`, `backup.auto-backup-days`, `backup.auto-backup-time` — scheduled backups are configured differently in the spike (backup module, [#582](https://github.com/jwilleke/yourphr/issues/582)). Set the schedule on the spike side; the destination and retention already carry.
- [ ] `backup.encryption.key` — spike backups are ALWAYS encrypted and refuse without a key. Bootstrap: environment only (`SPIKE_BACKUP_ENCRYPTION_KEY`). Generate and store it with the other SOPS secrets before the first backup runs.
- [ ] `database.encryption.key` — the Go production database is unencrypted; the spike's tokens are protected by its own at-rest encryption on the receiving side. Bootstrap: `SPIKE_DATABASE_ENCRYPTION_KEY`. Decide: encrypt from day one (recommended, the whole point of the receiving-side argument) and generate the key before the migration run, because the tool writes through the same stores the server opens.
- [ ] `auth.trusted-proxies` — Traefik and the Authentik forward-auth tier sit in front; set the in-cluster proxy address so throttling sees the client address, not the ingress.
- [ ] `sync.max-pages` — default 500; the Go instance ran with the default too. Confirm.
- [ ] Everything under `web.*`, `relay.*`, `cda_converter.*`, `metrics.*`, `log.*`, `theme.*`, `medications.*`, `bootstrap.*` on the Go side has no spike counterpart. The tool lists whichever of them are in the overlay; each is a decision, not a transfer.

### Catalog

- [ ] Catalog columns with no spike counterpart: `platform_type`, `brand_logo_url`, `consent_policy`, `pre_connect_profile`. Provider logos and the consent/pre-connect gating are display and policy features — decide whether the spike grows them before or after the swap.
- [ ] Sandbox credentials: the Go instance seeds sandbox catalog entries from `YOURPHR_SANDBOX_*` environment variables. The entries themselves migrate (6/6 on the production copy, secrets included); the environment-seeding path does not exist in the spike. Decide whether the Flux deployment still needs those secrets mounted.

### Accounts and roles

- [ ] The Go admin role is reported, not carried. The spike's admin is the bootstrap account ([#582](https://github.com/jwilleke/yourphr/issues/582), a named simplification). Decide who the operator account is after the swap: promote the migrated operator (needs a role column — Phase-5 work the spike has not done) or operate through the bootstrap admin and keep the migrated account as a patient account.
- [ ] Every migrated account signs in with its Go password once and is rehashed. Tell the household that nothing changes for them, and that "sign out everywhere" (token generation) still holds.

### Connected sources

- [ ] 5 of 8 production sources have an empty display name and no refresh token. They migrate, but reconnect at first token expiry regardless of stack. Before the freeze: give them names on the Go side (the tool carries whatever is there) and decide whether to reconnect them on Go first so a refresh token exists to migrate.
- [ ] Token endpoints are rediscovered from `.well-known/smart-configuration` on the first worker pass. The first sync after the swap therefore needs outbound access through the SSRF-guarded client; confirm the cluster egress allows it.
- [ ] The relay: the spike's SMART client does not use the store-and-poll relay the Go stack uses for providers that require a public callback. Decide per provider before reconnecting anything — this is [#408](https://github.com/jwilleke/yourphr/issues/408) territory.

### Records

- [ ] Rows owned by a soft-deleted account are left behind by design (0 on the production copy). Confirm that is the intended retention.
- [ ] Rows from a disconnected (soft-deleted) source keep a `legacy-<go id>` attribution (0 on the production copy). Provenance shows the id, not a display name.
- [ ] `related_resources` (Go's resource graph edges) and `resource_associations` do not migrate. The spike derives relationships from the FHIR references in `resource_raw`; confirm the medical-history and encounter views do not depend on the Go edge table.
- [ ] Go-side derived data that is not FHIR — favorites, glossary, user settings, access events, background-job history, legal consent records — does not migrate. Each needs a decision: carry (new tool step), recreate, or retire. Legal consent records are the one with a compliance angle; decide first.

### Platform

- [ ] Image and release tagging — [#587](https://github.com/jwilleke/yourphr/issues/587). The spike has no entrypoint, Dockerfile or release workflow yet. Plan: Node 24 runtime, frontend copied from the released `ghcr.io/jwilleke/yourphr` image so Angular is built once, semver tags only (same contract as [deployment-contract.md](deployment/deployment-contract.md)).
- [ ] Flux entry — a second Deployment (`yourphr-ts`) in the `yourphr` namespace with its own PVC, no Ingress change until the swap. Environment carries bootstrap and secrets only; everything else in the config store ([#472](https://github.com/jwilleke/yourphr/issues/472)).
- [ ] Probes: the spike needs `/healthz` for the liveness and readiness probes the existing Deployment uses.
- [ ] NAS backup mount (`/nas-backup`) and the backup CronJob — carry the mount to the new Deployment; `backup.destination` already migrates as `/nas-backup`.
- [ ] C-CDA converter sidecar — the spike has no CDA import path. The sidecar stays up for Go; decide whether the spike needs it before the swap or whether CDA import is a post-swap capability.
- [ ] Authentik forward-auth and the internal-only ingress — unchanged by the swap; the Ingress backend Service name is the only thing that moves.

## The cut-over, in order

From [#588](https://github.com/jwilleke/yourphr/issues/588); each step has a check that must pass before the next.

1. __Freeze.__ Announce to the household. Scale the Go Deployment's background sync off (or accept that anything synced after the snapshot is lost and re-synced by the spike's first pass). Go stays up, read-only in spirit.
2. __Snapshot.__ `sqlite3 fasten.db ".backup <copy>"` on the node, plus `config/app-custom-config.json`. Never migrate the live file.
3. __Migrate.__ `migrate:go` against the copy, into the spike's PVC-backed data dir, with the bootstrap secrets set in the environment exactly as the Deployment will set them.
4. __Verify.__ Exit 0 and `MIGRATION VERIFIED`. Then `TestShadowExport` for the operator account and a second run with `--go-answers`. Both bars or stop.
5. __Hand migrations.__ Work the checklist above; every unticked "decide" is a blocker here, not later.
6. __Swap.__ Point the Ingress backend at the `yourphr-ts` Service. Sign in as the operator and as one patient; open records, provenance, the IPS; trigger a sync and read the job summary.
7. __Rollback stays warm.__ Go keeps running with no ingress. Rollback = point the Ingress back. The runbook is not done until this has been rehearsed once for real, both directions.
8. __Stop rule.__ Two stacks serving production for more than one release cycle means pick one ([#543](https://github.com/jwilleke/yourphr/issues/543)).

## Open decisions

- ~~Cut over, keep both, or stop~~ — decided 2026-08-21: cut over, at parity ([#591](https://github.com/jwilleke/yourphr/issues/591)).

- Encrypt the spike database from day one (bootstrap key before the migration run) — recommended.
- Operator account after the swap: bootstrap admin vs a role column.
- Non-FHIR Go tables: which are carried, which are retired — legal consent first.
- Relay and CDA converter: needed before the swap, or post-swap capabilities.
