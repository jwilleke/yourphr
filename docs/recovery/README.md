# Backup & Recovery

Three pages, and it matters which one you need:

| Page | Answers |
|---|---|
| __This page__ | How do I run a backup or a restore? Buttons, endpoints, schedule, configuration. |
| [`data-recovery.md`](data-recovery.md) | __Can my instance actually come back?__ The restore drill — start here before relying on any of the above. |
| [`backup-model.md`](backup-model.md) | What is in a backup, what is deliberately not, and why. |

> __A backup you have never restored is not a backup.__ It is a file you hope is a backup. This page covers the buttons; [`data-recovery.md`](data-recovery.md) covers proving they work on *your* instance.

How YourPHR backs up and restores — the whole data root, i.e. *every user's* complete medical records (PHI) plus the instance's own configuration. All of it is __admin-only__ (gated by the admin role). Implemented under [#361](https://github.com/jwilleke/yourphr/issues/361) (backup), [#362](https://github.com/jwilleke/yourphr/issues/362) (restore) and [#467](https://github.com/jwilleke/yourphr/issues/467) (whole data root).

See also: [`docs/deployment/README.md`](../deployment/README.md), [`docs/deployment/deployment-contract.md`](../deployment/deployment-contract.md) and [`docs/releasing.md`](../releasing.md).

> ⚠️ A backup is every user's PHI, __plus live provider refresh tokens__ that grant ongoing access at Epic or CMS until revoked. At-rest encryption is __on by default__ since v2.0.0 — and while it is on, backup and restore are both refused ([#367](https://github.com/jwilleke/yourphr/issues/367)). So every backup that exists is __plaintext__, on an instance that explicitly turned encryption off. Treat the file exactly as you would treat the database. Encrypting the artifact itself is [#461](https://github.com/jwilleke/yourphr/issues/461).

## Where to find it

__Admin → Database__ card (`/admin/database`). It shows DB details (location, encryption, size, integrity, user/source counts) and drives every backup/restore action below.

The footer shows the running version as `<channel>-<semver>` (e.g. `dev-1.10.0`, `prod-1.10.0`), fetched live from the public `GET /api/version` endpoint — so you can confirm what's actually deployed.

## Backups

A backup is the __whole data root__ — the database, the instance config store (`config/`, holding the operator contact and theme) and the generated signing key — written as a gzipped tar ([#467](https://github.com/jwilleke/yourphr/issues/467)). The database inside it is a __consistent online snapshot__ taken with SQLite `VACUUM INTO` (safe while the app is running — never a raw file copy).

Two things are deliberately __not__ in it: the __cache__ (disposable and regenerable) and the __backup destination itself__ (or every archive would contain every previous archive). Both are computed from configuration rather than matched by name, so renaming your backup folder does not quietly start including it. See [`backup-model.md`](backup-model.md).

__Restore accepts both formats.__ The current `*.tar.gz` archive and the older database-only `*.db.gz` — detected by content, not by filename, so a backup renamed by a browser or a NAS still restores. Restoring a legacy backup leaves the current instance's `config/` untouched, because that backup never carried one.

__The signing key is backed up but never restored.__ Restoring it would revive every session token ever signed with it, including any lifted from the backup file. A restored instance generates its own on first start; everyone signs in again, which a restore forces anyway. Two on-demand actions plus a schedule:

### On-demand

- __Download backup__ — streams the backup to your browser; your Save dialog picks the location. The request is held open while it runs, so stay on the page (a spinner shows progress). Endpoint: `POST /api/secure/admin/database/backup/download`.
- __Back up to server now__ — writes to the configured server destination folder and returns immediately (fire-and-forget; you can leave the page). Endpoint: `POST /api/secure/admin/database/backup`.

### Scheduled (automatic)

Settable from the card; persisted to `<db-dir>/.backup_settings.json` and read by a worker that __polls once a minute__, so changes take effect __without a restart__. Model (aligned with the ngdpbase BackupManager):

- __Enable__ scheduled backups (off by default)
- __Time__ — `HH:MM`, server-local
- __Frequency__ — `daily` or `weekly` (weekly runs Sundays)
- __Keep last__ — retention; older backups beyond this count are pruned after each run
- __Destination__ — server folder (see below)

Endpoint: `POST /api/secure/admin/database/schedule`. On startup the worker seeds its "last run" from the newest existing backup, so a restart doesn't double-run the same day.

### Filenames

Date-first, ISO-ish, UTC, filesystem-safe (colons → dashes), version- and label-stamped, gzip:

```
2026-06-21T17-07-11Z-yourphr-prod-1.10.0-backup.db.gz
└──── UTC timestamp ────┘ │      │      │
                          │      │      └─ producing app version (version.VERSION)
                          │      └──────── instance label (backup.label; omitted if blank)
                          └─────────────── product name
```

They sort chronologically by name, and each backup says which __instance__ and __app version__ produced it — useful when deciding whether a backup is safe to restore. Older names (`yourphr-backup.db`, `yourphr-backup-<date>.db`, un-labeled `…-yourphr-<version>-backup.db.gz`) are still recognized and restorable.

### Destination folder

The destination is __any absolute server folder__ the app can write to. Set it in the card by typing a path or using __Browse__ (an admin-only server-folder navigator, `GET /api/secure/admin/database/browse?path=…`). It persists until changed and is shared by both the schedule and "Back up to server now". Blank → the default `<db-dir>/backups`.

> On Kubernetes the only persistent, writable path is the data volume. To back up __off__ the DB volume, mount external storage into the pod and point the destination there — see [Production](#production-kubernetes).

## Restore

Restoring __replaces the entire database__ (all users), so it is never swapped under a live, open DB. It is __staged__, then __applied on the next app restart__:

1. __Stage__ (`POST /api/secure/admin/database/restore`, requires `confirm: true`):
   - The requested file must __exactly match a backup in the destination__ (server-enumerated allowlist via `ListBackups` — a path-traversal barrier; we never build a path from raw request input).
   - Decompress (if `.gz`) → __validate__ it is an intact SQLite DB (`PRAGMA integrity_check`).
   - __Auto-backup the current DB first__ (so the restore is reversible).
   - Write the validated snapshot to `<db-dir>/.restore_pending.db`.
2. __Apply at startup__ (before the DB is opened): the current live DB is copied aside to `<db>.pre-restore`, the staged file is swapped in, and `-wal`/`-shm` are cleared so SQLite rebuilds from the restored main file. If applying fails, startup aborts rather than opening a half-restored DB.

In the UI: __Restore…__ on a backup row → type `restore` to confirm → "Restore staged. Restart the app to apply." → __restart the app/pod__. After restart, the data reflects that backup and `<db>.pre-restore` holds the prior DB as a safety net.

Restoring from an __uploaded__ file (rather than one already in the destination) is a planned follow-up.

## Configuration

Schedule settings are normally managed from the card and persisted to `<db-dir>/.backup_settings.json`. These config keys (Admin → Configuration, or `YOURPHR_*` env, e.g. `YOURPHR_BACKUP_LABEL`) provide the __initial defaults__:

| Key | Env | Meaning | Default |
|---|---|---|---|
| `backup.label` | `YOURPHR_BACKUP_LABEL` | Instance tag in filenames (e.g. `dev`, `prod`) | *(blank)* |
| `backup.destination` | `YOURPHR_BACKUP_DESTINATION` | Default destination folder | `<db-dir>/backups` |
| `backup.auto-backup` | `YOURPHR_BACKUP_AUTO_BACKUP` | Enable the schedule | `false` |
| `backup.auto-backup-time` | `YOURPHR_BACKUP_AUTO_BACKUP_TIME` | `HH:MM` server-local | `02:00` |
| `backup.auto-backup-days` | `YOURPHR_BACKUP_AUTO_BACKUP_DAYS` | `daily` \| `weekly` | `daily` |
| `backup.max-backups` | `YOURPHR_BACKUP_MAX_BACKUPS` | Retention count | `7` |

## API summary

| Method + path | Purpose | Auth |
|---|---|---|
| `GET /api/version` | Running app version (footer) | public |
| `GET /api/secure/admin/database` | DB details + schedule + backups list | admin |
| `POST /api/secure/admin/database/backup` | Back up to the server folder | admin |
| `POST /api/secure/admin/database/backup/download` | Stream a backup to the browser | admin |
| `POST /api/secure/admin/database/schedule` | Save the auto-backup settings | admin |
| `GET /api/secure/admin/database/browse?path=` | List a server folder's subdirs | admin |
| `POST /api/secure/admin/database/restore` | Stage a restore (applied on restart) | admin |

## Production (Kubernetes)

The deployed instance (`yourphr` namespace) runs from the released image; deploys are __release-gated__ (see the deployment contract).

- __DB:__ `/opt/fasten/db/fasten.db` on a `local-path` PVC (`yourphr-data`), node-local to the k3s node.
- __Off-volume backups:__ the NAS share is mounted into the app pod as a `hostPath` — node `/mnt/tank/jims/data/archive/yourphr-backup` → container __`/nas-backup`__. Set the card's destination to `/nas-backup` so backups land on the NAS, not the same volume as the DB.
- __Label:__ `YOURPHR_BACKUP_LABEL=prod` in the deployment, so prod backups are named `…-yourphr-prod-<version>-backup.db.gz` and are distinguishable from dev backups in the shared folder.
- The previous hourly raw-`cp` CronJob was __retired__ — the app's `VACUUM INTO` + gzip scheduled backup supersedes it (a consistent snapshot vs a copy of a live file).

> Because the app pod is pinned to the DB's node (local-path PVC + `Recreate` strategy), the `hostPath` resolves consistently. Confirm the node actually has the NFS share mounted at `/mnt/tank/jims` — otherwise `DirectoryOrCreate` would write to node-local disk instead of the NAS.

## Disaster recovery

### Restore a known-good backup

1. Ensure the backup file is in the instance's __destination folder__ (e.g. `/nas-backup`, or download one and place it there).
2. __Admin → Database → Restore…__ on that file → type `restore`.
3. __Restart__ the app/pod (on k8s: `kubectl -n yourphr rollout restart deploy/yourphr`).
4. Verify the data; the prior DB is kept at `<db>.pre-restore`.

### Rebuild from total loss (volume/node gone)

1. Stand up a fresh instance (the released image) with the data volume + the NAS mount.
2. Put the chosen backup in the destination folder (it's on the NAS, off the lost volume — that's the point).
3. Restore + restart as above.

This is why backups must live __off__ the DB volume (the NAS mount): a backup on the same `local-path` PVC dies with the DB.

## Security & limitations

- __Admin-only.__ Every backup/restore endpoint is gated by the admin role; the backup destination + folder browser are intentionally arbitrary admin-chosen paths (an admin already has full DB control). CodeQL path/SQL-injection findings on these were reviewed, hardened where applicable, and the by-design ones accepted — see [#365](https://github.com/jwilleke/yourphr/issues/365).
- __Plaintext backups.__ Backups exist only on instances running with `database.encryption.enabled=false` — encryption is on by default and currently refuses backup and restore ([#367](https://github.com/jwilleke/yourphr/issues/367)). So every backup file is plaintext PHI, including live provider refresh tokens ([#461](https://github.com/jwilleke/yourphr/issues/461)); treat them accordingly.
- __Verify your backups.__ A backup is only proven by a successful restore — exercise the restore path periodically.
- __Roadmap:__ card polish (free disk space, schema version, totals, vacuum) — [#364](https://github.com/jwilleke/yourphr/issues/364); restore-from-upload; at-rest encryption — [#363](https://github.com/jwilleke/yourphr/issues/363).
