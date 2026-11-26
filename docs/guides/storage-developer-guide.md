---
name: Storage developer guide
description: Where data lives and how it changes shape — the three SQLite databases, who may open them, dated migrations, at-rest encryption, backup and restore
dateModified: 2026-11-23
category: guides
relatedModules: [SqliteRecordsProvider, SqliteFhirRepository, SqlitePhdSamplesProvider, DatabaseManager, BackupManager, sqlite-migrations]
---

# Storage developer guide

Where yourPHR's data lives, who may open it, and how its schema changes. All three databases are SQLite through `better-sqlite3-multiple-ciphers`, run in WAL mode, and sit on the fast storage root.

## Where each kind of thing goes

| Data | Where | Key | Opened by |
| --- | --- | --- | --- |
| Accounts, sessions' token generations, agent tokens and device grants, credentials (passkeys), sources, provider catalog, jobs, favorites, glossary cache, consent, the access log | the app database, `yourphr.database.location` (default `${YOURPHR_FAST_STORAGE}/spike.db`) | `yourphr.database.encryption.key` | `SqliteDatabaseProvider` (`DatabaseManager`) and the providers built over its handle in `src/app.ts` |
| FHIR records, their history and the search index | `yourphr.records.location` (default `${YOURPHR_FAST_STORAGE}/records.db`) | the same key | `SqliteRecordsProvider` over `SqliteFhirRepository` (`RecordsManager`) |
| Raw connected-device samples | `yourphr.phd-samples.location` (default `${YOURPHR_FAST_STORAGE}/phd-samples.db`); opened only while `yourphr.health.enabled` is on | the same key, which must be set: health stays off without it | `SqlitePhdSamplesProvider` (`HealthManager`) |
| Instance overrides | `<data>/config/app-custom-config.json` | none | `FileConfigProvider` |
| Generated secrets, the bootstrap admin password | `<data>/.env`, `<data>/.admin_bootstrap_password` (mode 0600) | none | `src/cli/start.ts`, `UsersManager` |
| Notifications | `yourphr.notifications.dir` / `yourphr.notifications.file` | none | `NotificationManager` |
| Backups | `yourphr.backup.destination` (default `${YOURPHR_SLOW_STORAGE}/backups`) | `yourphr.backup.encryption.key` | `BackupManager` through `FilesystemBackupProvider` |

## Standing rules

- Only a provider opens a database or prepares a statement. `npm run check:store` (`scripts/check-store-boundary.sh`) fails CI if the driver, `SqliteFhirRepository`, a records handle's `.db` or `.prepare(` appears outside the allow-list.
- Every records query is scoped to one account. `BaseRecordsProvider` never answers for "all users", and the search index is the provider's internal: callers get indexed search and grouped aggregation as operations, not the table.
- Records are stored as the source sent them. `SqliteFhirRepository` keeps the raw resource and writes a generic index: for every FHIR-defined `SearchParameter` of the resource type it evaluates the FHIRPath expression and stores the results in one `search_index` table, with `search_text` (FTS5) for words. The same tables (`resources`, `resource_history`, `search_index`, `search_text`) serve every resource type; there is no per-type schema and no code generation.
- A record that changes gets a version in `resource_history`; a re-sync that brings back an identical record writes nothing (`'unchanged'`).
- No database may resolve onto NFS or SMB: `refuseNetworkFilesystem` checks the real paths at boot. Backups may go to a NAS.
- At-rest encryption is on when `yourphr.database.encryption.key` is set, and off when it is empty (the shipped default). The key is environment-owned (`YOURPHR_DATABASE_ENCRYPTION_KEY`).
- Connected-device readings (`phd-samples.db` and the daily Observations in `records.db`) are under that same key and are written while the patient is signed out. The stored raw row is the reading's original; no separate copy is kept. Threat model: [security-developer-guide.md](security-developer-guide.md#health-data-at-rest-and-uploads-while-the-patient-is-signed-out) ([#991](https://github.com/jwilleke/yourphr/issues/991)).
- Backups are always encrypted, under their own key (`yourphr.backup.encryption.key`), even when the databases are not. Without that key every backup action refuses with a reason. A backup is a transactional copy into a fresh encrypted file, never a raw file copy, and not gzipped (`src/app/providers/sqlite-backup.ts`).
- A restore is __staged__: the backup is opened, integrity-checked and exported to new files under the target key; the swap happens at the next server start, before anything opens (`applyStagedRestore` in `openStores`). Records and accounts are applied together or not at all. Only `start` applies staged files; the CLI tools never do.

## Migrations

Each database has its own ledger, in `src/framework/providers/sqlite-migrations.ts`'s shape:

- The app database: `APP_MIGRATIONS` in `src/app.ts`.
- `records.db`: `RECORDS_MIGRATIONS` in `src/app.ts`, ledger separate because it is a separate file.
- `phd-samples.db`: `PHD_MIGRATIONS` in `src/app/providers/SqlitePhdSamplesProvider.ts`, ledger `phd_schema_migrations`.

The rules (`runMigrations`):

- A migration has a dated, strictly ascending `id` (`YYYYMMDDHHMMSS`), a `description` naming its issue, and an `up(db)`. It runs once, in a transaction, and is recorded.
- A migration is a frozen snapshot of intent: it never imports live code, because the live code moves on.
- Add a counter-like column with `addColumnWithDefault`, which backfills existing rows; a bare `ADD COLUMN` leaves them `NULL` ([#528](https://github.com/jwilleke/yourphr/issues/528)).
- There is no `down()`. A database that records a migration this build does not know refuses to start ("database schema is newer than this build"). The rollback is the backup.

To add one: append it to the right registry with a new id, test it in `npm run migrations`, and keep the constructor's `CREATE TABLE IF NOT EXISTS` in step for fresh databases.

## Maintenance

- `compact` and `reindex` (CLI, server stopped) remove identical history copies and rebuild the search index. The search index can also be rebuilt from Admin → Database as a background job (`RecordsManager.startSearchIndexRebuild`), which holds the instance in maintenance mode while it runs.
- The records file's integrity check runs at start and then at most once a day, on a worker thread (`sqlite-integrity-worker.ts`); a failure notifies the admins.

## How you know you are done

- `npm run migrations`, `npm run backup` and `npm run check:store` pass, and `npm run roundtrip` for anything that touches encryption.
- A new migration is proven on a database built by the previous release, not only on a fresh one.

## See also

- [recovery/README.md](../recovery/README.md), [recovery/backup-model.md](../recovery/backup-model.md), [recovery/data-recovery.md](../recovery/data-recovery.md): running and proving backups (but see Known gaps)
- [fhir-records-developer-guide.md](fhir-records-developer-guide.md): what is stored in `records.db`
- [planning/phr-database-plan.md](../planning/phr-database-plan.md): the database plan

## Known gaps

- The app database file is still called `spike.db`, and the dev template calls it `fasten.db`; renaming is owed by [#676](https://github.com/jwilleke/yourphr/issues/676).
- `BackupManager` has one exporter today, so a snapshot is consistent; with several, per-manager `backup()` would give a torn snapshot, and quiescing is not designed.
- [recovery/README.md](../recovery/README.md) describes the Go stack's backup: at-rest encryption "on by default", backup and restore refused while it is on, every backup a plaintext gzipped tar of the whole data root. The TypeScript server ships encryption off, always encrypts backups under `yourphr.backup.encryption.key`, refuses without that key, and does not gzip.
