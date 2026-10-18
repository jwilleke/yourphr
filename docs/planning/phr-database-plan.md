# phr's database and PhrManager — plan for review

> __Status: draft for the operator's review, 2026-10-17. Nothing here is built.__ Worked out with the ngdpbase session. Once accepted, the decisions move into [`ngdp-move.md`](ngdp-move.md) and each step becomes its own issue.

## What this settles

How the `phr` add-on gets its records database, and how `PhrManager` controls access to it. The direction is already recorded in [`ngdp-move.md`](ngdp-move.md): one door for records, core decides, and records stay in a shared database under the site key (2026-10-15).

## The proposal in one paragraph

phr __declares__ its database in its own `config/default-config.json`, the way it already declares its PHR vault. When phr loads, `PhrManager` asks `engine.getManager('DatabaseManager')` for the database it declared, handing over its migrations (they're code, so they can't live in config). `PhrManager` is the only code that touches that database. For every request it reads the record's owner from the row, asks core's decision point (`engine.getManager('PolicyDecisionPoint')`, as accounting already does), enforces the answer and logs it. __No host tool is needed:__ [ngdpbase#1824](https://github.com/jwilleke/ngdpbase/issues/1824) is closed in favour of declared databases ([ngdpbase#1860](https://github.com/jwilleke/ngdpbase/issues/1860)).

## Why not the host tool

The host tools ([ngdpbase#1813](https://github.com/jwilleke/ngdpbase/issues/1813)) exist because an add-on outside `ngdpbase/addons/` can't import core's files by path (`../../dist/...`). `engine.getManager(...)` is a call made while the app is running, with no paths involved, so that reason doesn't apply to managers.

The other argument for a host tool was isolation: tying the database to the add-on so it can't open another add-on's database. The ngdpbase session's honest view, which I share: installed add-ons are trusted code running in the same process. Any add-on can already read any file or call any manager, so tying the call to a slug is no security boundary. It only prevents mistakes, like a typo opening the wrong database. A declaration prevents those too: core refuses to open a database for any owner that hasn't declared one.

__So the operator's instinct holds:__ declare it in config, get it through `getManager`, and the add-on's manager controls access.

## Decisions for the operator

| # | Decision | Recommendation |
|---|---|---|
| D1 | Declared database plus `getManager`, instead of a host tool | __Decided (operator, 2026-10-17).__ [ngdpbase#1824](https://github.com/jwilleke/ngdpbase/issues/1824) is closed in favour of C1 ([ngdpbase#1860](https://github.com/jwilleke/ngdpbase/issues/1860)). |
| D2 | Records stay in `phr.db` under the site's one database key, and files stay in each person's sealed vault | __Decided (operator, 2026-10-18).__ The threat model, plainly: the key sits in the site's `.env` on the same server. It protects a stolen disk, or a backup taken without the `.env` (backups never carry the key). It does not protect against the operator or anyone with shell access, who can read every person's rows. Vault files are sealed per person. Per-person sealing of records (a database inside each person's vault, [ngdpbase#1812](https://github.com/jwilleke/ngdpbase/issues/1812), with background work through the sealed inbox, [ngdpbase#1811](https://github.com/jwilleke/ngdpbase/issues/1811)) is a later step, needed before yourphr.org hosts other people's records; a migration can move `phr.db` rows into per-person stores. |
| D3 | What happens when a site has no database encryption key, or phr can't load | __Decided (operator, 2026-10-18; [#948](https://github.com/jwilleke/yourphr/issues/948), core [ngdpbase#1883](https://github.com/jwilleke/ngdpbase/issues/1883)).__ phr's database declaration says `encrypt: "required"`, and phr sets the add-on configuration entry `ngdpbase.addons.phr.site-critical: true`. A site-critical add-on that fails to load __for any reason__ (no database key, a failed migration, an integrity check) puts __the whole site in maintenance mode__: visitors see a short "we're having temporary issues" page, and only admins can sign in. __Any__ add-on that fails to load, site-critical or not, sends admins a __critical notification__ with the details. Nothing is ever written unencrypted. Maintenance mode and the notification are core's. |

## Core work (ngdpbase), each its own issue

- __C1 — Declared add-on databases__ ([ngdpbase#1860](https://github.com/jwilleke/ngdpbase/issues/1860), replaces #1824):
  - An add-on declares its database in its config, e.g. `ngdpbase.addons.phr.database: { "owner": "phr", "ledgerTable": "phr_migrations", "encrypt": "required" }`, merged while the add-on is enabled (as #1220 / #1559).
  - `DatabaseManager` refuses `openAddonDatabase(owner)` unless a declaration names that owner, and refuses to open a `"required"` database without a key.
  - Admin → Add-ons lists declared databases.
  - A declared database stays known, and backed up, while its add-on is off, like the PHR vault category.
- __C2 — Database backups, decided (operator, 2026-10-17): `DatabaseManager` owns all database backups; phr does nothing__ ([ngdpbase#1723](https://github.com/jwilleke/ngdpbase/issues/1723), open). `DatabaseManager` backs up and restores every database it opens, the site's own and every add-on's, through the `backup()`/`restore()` hooks `BackupManager` already calls on each manager. That means one consistent copy (SQLite's online backup, never a raw file copy) on a worker thread, under a separate backup key, with an all-or-nothing staged restore. A declared add-on database is backed up even while its add-on is off (needs C1), and a large one goes beside the backup as its own encrypted file. __This must ship before any real PHR record is written.__
- __C3 — Access control for add-on records__ ([ngdpbase#1823](https://github.com/jwilleke/ngdpbase/issues/1823)): resource types with an `owner`, the owner rule, list filters, conditions and obligations. The decision point itself is already reachable through `getManager`. What's missing is that it doesn't yet understand an add-on's records.

## phr work, each its own issue, in order

1. __Declare the database__ in phr's `config/default-config.json` (once C1 ships).
2. __`PhrManager` opens `phr.db`__ in `register()` through `getManager('DatabaseManager')`, passing its migrations. All tables are prefixed `phr_`. phr reports itself off if the site has no database or no key.
3. __The schema__ is ported from today's FHIR store (`SqliteFhirRepository`): resources, history, search index and text index. Each table has a required `owner` column in its primary key, and indexes start with `owner` (lessons from #537, #812, #908). There's no `''` "unknown owner": a row nobody owns can't be written.
4. __The one door, `access(ctx, action, kind, work)`__ in `PhrManager`, works like this:
   1. It reads the owner from storage, never from the request.
   2. It asks core's decision point (self, proxy or job).
   3. It refuses or allows, and records an audit event either way. phr declares its own `phr-*` audit events, and each carries the row's `owner`, because the person's access view is built from them.
   4. It hands `work` a handle locked to that owner.

   A list is decided once, and the decision point returns a filter as data, which the door turns into bound SQL parameters. A refused list is a refusal, never zero rows.
5. __A lint__ allows only `PhrManager`'s storage file to open the database or write SQL, like ngdpbase's `check-page-door`.
6. __Tests__ (vitest, with a fake decision point):
   - user A can't read user B's records through any method;
   - proxy access works within the grant and is refused beyond it;
   - a job is decided as the person who started it;
   - a refused list refuses rather than returning empty;
   - every call is logged, with its owner.
7. __The first record source:__ the "my records folder" importer ([#939](https://github.com/jwilleke/yourphr/issues/939)). It's planned separately and builds on all of the above.

__Until C3 ships__, `access()` still goes through core's decision point, as accounting does: `pdp.decide(subject, { action })`, enforced by core's own deny handling, never `requirePermission` (managers use the PDP; operator decision). On top of that, `PhrManager` compares the row's owner with the subject. That owner comparison is the part C3 replaces; nothing else changes, because nothing else touches the database.

__Proxy access already works in the interim.__ Under a proxy grant, core makes the subject the person represented. So when Jim acts for Mom within her grant, "owner = subject" lets him into Mom's records, and the audit names Jim as the actor.

## Requirements already decided

- __Everything is audited__, allowed and refused, with the record's owner on each event (2026-10-15).
- __The person's access view__ is a core feature built from those audit events. It shows everyone who read or changed her data, other than herself, plus refused attempts by others (Normal), or every entry (All) (2026-10-16, [ngdpbase#1825](https://github.com/jwilleke/ngdpbase/issues/1825)).
- __No PHR content in logs or error messages.__ Logs and errors name record ids and kinds, never values.

## Lifecycle items to plan

- __Takeout:__ a person exports all their PHR rows. Vault files already export through core.
- __Account deletion:__ what happens to a person's rows when their account is closed.
- __Survivorship__ ([ngdpbase#1545](https://github.com/jwilleke/ngdpbase/issues/1545)): who may reach a person's rows after they die.

## What a site needs

- `ngdpbase.database.provider: "sqlite"`: without it, no add-on can have a database.
- `NGDPBASE_DATABASE_KEY` in the site's `.env`: phr refuses to start without it (D3).
- On the local test site: both get set before step 2.

## What happens when

| Situation | Result |
|---|---|
| phr turned off | `phr.db` isn't opened; the file stays intact. With C1, core still lists and backs it up. |
| phr removed | Through core's retire flow ([ngdpbase#1490](https://github.com/jwilleke/ngdpbase/issues/1490)), never by deleting files. |
| No database key | phr refuses to start and says why on Admin → Add-ons. |
| Backup and restore | `DatabaseManager` does it for phr once C2 ships. Until then, no real records. |

## Order

C1 and C2 (core) can be built alongside phr steps 2–6 on test data. Real records wait for C1 and C2. Step 4 starts with the interim check and switches to core's decision when C3 ships.
