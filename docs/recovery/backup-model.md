# The backup model

The rule the TypeScript server actually follows:

> __A backup is one encrypted SQLite file.__ It holds the tables from this instance's databases, plus the operator's settings overrides, all written under the backup key. It is not a copy of the data directory, and it is not a gzipped tar.

The Go stack backed up the whole data root as a `.tar.gz`. That rule does not describe v3, and following it would make you think `.env`, notification files, or a legal-document override in `config/` were inside the backup. They are not.

## What a backup contains

The exporter (`src/app/providers/sqlite-backup.ts`) opens the live databases and copies schema and rows into a new file encrypted with `YOURPHR_BACKUP_ENCRYPTION_KEY`. One transaction, so the snapshot is consistent against live writes. The copy runs on a worker thread.

| In the file | Source | Notes |
|---|---|---|
| Medical records, their history, and the search index | `records.db` | Tables `resources`, `resource_history`, `search_index`, `search_text`, `text_rowids`, and that file's migration ledger |
| Accounts, sources, provider tokens, the catalog, jobs, favorites, passkey rows, the access log, and the rest of the app database | `spike.db` | Everything in that file that is not a records table or a device-sample table |
| Raw connected-device samples | `phd-samples.db` | Only when that file existed at backup time. Every table in it is named with the `phd_` prefix, so a restore can send them back to that file and nowhere else |
| Settings overrides | the `backup_payloads` table | Today this is the configuration manager's payload: whatever the operator changed in `<data>/config/app-custom-config.json`. A restore replaces this instance's overrides with those from the backup, not a blend. Keys this version does not know are dropped |

The databases themselves are encrypted at rest with SQLite3 Multiple Ciphers (the SQLCipher compatible cipher) when `YOURPHR_DATABASE_ENCRYPTION_KEY` is set, and stored in the clear when that key is empty. The backup is encrypted either way. The backup key and the database key are separate secrets: the file that travels and the file that stays should not fall to the same compromise. They may be the same value if you choose; they are never assumed to be.

## What a backup does not contain

- __`<data>/.env`.__ The database key, the backup key, `YOURPHR_SESSION_SECRET`, `YOURPHR_CREDENTIALS_KEY`, and any other secret kept only in the environment are never written into the backup and never restored. A restore into a new instance needs those values supplied again. Without the original credentials key, passkey rows from the backup will not verify; people can still sign in with their password.
- __The backup destination itself.__ Otherwise each backup would contain every previous backup. The default destination is `${YOURPHR_SLOW_STORAGE}/backups`. If you do not set the slow root, it is the data directory, which is convenient and also means a lost volume takes the backups with it.
- __Notification files__, and any other file under the data directory that is not one of the databases or the configuration overrides — including a custom privacy policy or terms file you may have placed in `config/`.
- __Last-run health__ (`<data>/.backup_health.json`). It is rewritten by the next backup outcome; it does not travel in the file.

## A backup contains live credentials

This is the most important thing on this page.

The app database holds OAuth access tokens, refresh tokens and `client_secret` for every connected provider. __A refresh token grants ongoing access to that patient's records at a hospital or CMS until it is revoked__ — it is not a stale artifact of a past session. Those rows are inside the encrypted backup.

The backup key is what keeps that file from being readable if it is copied. Anyone who has both the file and the key can use those tokens. Record the key off the instance, and treat the file as you would treat the database.

## Where backups should live

The databases run in WAL mode and must sit on the fast storage root (`YOURPHR_FAST_STORAGE`; default `./data`, or `/opt/yourphr/data` in the published image). The server refuses to open them on NFS or SMB.

Backups may, and for a real instance should, live somewhere else: a NAS mount, another disk, a folder the instance can write to that would survive the data volume being destroyed. Set `YOURPHR_SLOW_STORAGE` or point __Admin → Database__ at that path. Prove the path with __Test path__ (a small file is written and then removed) before you rely on a schedule.

A destination that looks like a NAS mount is a plain empty directory when the mount is gone, and writes to it can succeed. That is why the test, and why you also keep a copy the instance cannot write to.

## Threat model, stated plainly

Nobody is targeting one family's records. The realistic exposures are undramatic:

- a NAS share readable by the whole household
- a disk sold, returned under warranty, or binned
- ransomware sweeping every writable path it can reach
- a backup copied somewhere convenient and forgotten

Encrypting the backup, keeping the backup key off the data volume, and keeping at least one copy the instance cannot write to, are what address those. An allowlist of destination folders would not.

## Related

- [`README.md`](README.md) — how to actually run a backup or restore
- [`data-recovery.md`](data-recovery.md) — the restore drill: test recovery, not backup
- [`../guides/storage-developer-guide.md`](../guides/storage-developer-guide.md) — where each file lives, and how a staged restore is applied
- [`../deployment/README.md`](../deployment/README.md) — the two encryption keys, and what the data volume holds
