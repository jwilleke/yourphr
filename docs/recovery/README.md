# Backup & Recovery

How YourPHR backs up and restores its database — the **entire single-file SQLite DB**, i.e. *every user's* complete medical records (PHI). All of it is **admin-only** (gated by the admin role). Implemented under [#361](https://github.com/jwilleke/yourphr/issues/361) (backup) and [#362](https://github.com/jwilleke/yourphr/issues/362) (restore).

See also: [`docs/deployment/deployment-contract.md`](../deployment/deployment-contract.md) and [`docs/releasing.md`](../releasing.md).

> ⚠️ A backup is the whole DB — all users' PHI. Keep backup files (and download locations) secure. The database is **not encrypted at rest by default** (at-rest encryption is deferred — [#363](https://github.com/jwilleke/yourphr/issues/363)), so a backup file is plaintext SQLite.

## Where to find it

**Admin → Database** card (`/admin/database`). It shows DB details (location, encryption, size, integrity, user/source counts) and drives every backup/restore action below.

The footer shows the running version as `<channel>-<semver>` (e.g. `dev-1.10.0`, `prod-1.10.0`), fetched live from the public `GET /api/version` endpoint — so you can confirm what's actually deployed.

## Backups

A backup is a **consistent online snapshot** taken with SQLite `VACUUM INTO` (safe while the app is running — never a raw file copy), then **gzip-compressed**. Two on-demand actions plus a schedule:

### On-demand

- **Download backup** — streams the backup to your browser; your Save dialog picks the location. The request is held open while it runs, so stay on the page (a spinner shows progress). Endpoint: `POST /api/secure/admin/database/backup/download`.
- **Back up to server now** — writes to the configured server destination folder and returns immediately (fire-and-forget; you can leave the page). Endpoint: `POST /api/secure/admin/database/backup`.

### Scheduled (automatic)

Settable from the card; persisted to `<db-dir>/.backup_settings.json` and read by a worker that **polls once a minute**, so changes take effect **without a restart**. Model (aligned with the ngdpbase BackupManager):

- **Enable** scheduled backups (off by default)
- **Time** — `HH:MM`, server-local
- **Frequency** — `daily` or `weekly` (weekly runs Sundays)
- **Keep last** — retention; older backups beyond this count are pruned after each run
- **Destination** — server folder (see below)

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

They sort chronologically by name, and each backup says which **instance** and **app version** produced it — useful when deciding whether a backup is safe to restore. Older names (`yourphr-backup.db`, `yourphr-backup-<date>.db`, un-labeled `…-yourphr-<version>-backup.db.gz`) are still recognized and restorable.

### Destination folder

The destination is **any absolute server folder** the app can write to. Set it in the card by typing a path or using **Browse** (an admin-only server-folder navigator, `GET /api/secure/admin/database/browse?path=…`). It persists until changed and is shared by both the schedule and "Back up to server now". Blank → the default `<db-dir>/backups`.

> On Kubernetes the only persistent, writable path is the data volume. To back up **off** the DB volume, mount external storage into the pod and point the destination there — see [Production](#production-kubernetes).

## Restore

Restoring **replaces the entire database** (all users), so it is never swapped under a live, open DB. It is **staged**, then **applied on the next app restart**:

1. **Stage** (`POST /api/secure/admin/database/restore`, requires `confirm: true`):
   - The requested file must **exactly match a backup in the destination** (server-enumerated allowlist via `ListBackups` — a path-traversal barrier; we never build a path from raw request input).
   - Decompress (if `.gz`) → **validate** it is an intact SQLite DB (`PRAGMA integrity_check`).
   - **Auto-backup the current DB first** (so the restore is reversible).
   - Write the validated snapshot to `<db-dir>/.restore_pending.db`.
2. **Apply at startup** (before the DB is opened): the current live DB is copied aside to `<db>.pre-restore`, the staged file is swapped in, and `-wal`/`-shm` are cleared so SQLite rebuilds from the restored main file. If applying fails, startup aborts rather than opening a half-restored DB.

In the UI: **Restore…** on a backup row → type `restore` to confirm → "Restore staged. Restart the app to apply." → **restart the app/pod**. After restart, the data reflects that backup and `<db>.pre-restore` holds the prior DB as a safety net.

Restoring from an **uploaded** file (rather than one already in the destination) is a planned follow-up.

## Configuration

Schedule settings are normally managed from the card and persisted to `<db-dir>/.backup_settings.json`. These config keys (in `config.yaml` / `config.dev.yaml`, or `YOURPHR_*` env, e.g. `YOURPHR_BACKUP_LABEL`) provide the **initial defaults**:

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

The deployed instance (`yourphr` namespace) runs from the released image; deploys are **release-gated** (see the deployment contract).

- **DB:** `/opt/fasten/db/fasten.db` on a `local-path` PVC (`yourphr-data`), node-local to the k3s node.
- **Off-volume backups:** the NAS share is mounted into the app pod as a `hostPath` — node `/mnt/tank/jims/data/archive/yourphr-backup` → container **`/nas-backup`**. Set the card's destination to `/nas-backup` so backups land on the NAS, not the same volume as the DB.
- **Label:** `YOURPHR_BACKUP_LABEL=prod` in the deployment, so prod backups are named `…-yourphr-prod-<version>-backup.db.gz` and are distinguishable from dev backups in the shared folder.
- The previous hourly raw-`cp` CronJob was **retired** — the app's `VACUUM INTO` + gzip scheduled backup supersedes it (a consistent snapshot vs a copy of a live file).

> Because the app pod is pinned to the DB's node (local-path PVC + `Recreate` strategy), the `hostPath` resolves consistently. Confirm the node actually has the NFS share mounted at `/mnt/tank/jims` — otherwise `DirectoryOrCreate` would write to node-local disk instead of the NAS.

## Disaster recovery

### Restore a known-good backup

1. Ensure the backup file is in the instance's **destination folder** (e.g. `/nas-backup`, or download one and place it there).
2. **Admin → Database → Restore…** on that file → type `restore`.
3. **Restart** the app/pod (on k8s: `kubectl -n yourphr rollout restart deploy/yourphr`).
4. Verify the data; the prior DB is kept at `<db>.pre-restore`.

### Rebuild from total loss (volume/node gone)

1. Stand up a fresh instance (the released image) with the data volume + the NAS mount.
2. Put the chosen backup in the destination folder (it's on the NAS, off the lost volume — that's the point).
3. Restore + restart as above.

This is why backups must live **off** the DB volume (the NAS mount): a backup on the same `local-path` PVC dies with the DB.

## Security & limitations

- **Admin-only.** Every backup/restore endpoint is gated by the admin role; the backup destination + folder browser are intentionally arbitrary admin-chosen paths (an admin already has full DB control). CodeQL path/SQL-injection findings on these were reviewed, hardened where applicable, and the by-design ones accepted — see [#365](https://github.com/jwilleke/yourphr/issues/365).
- **Plaintext backups.** At-rest encryption is off by default and deferred ([#363](https://github.com/jwilleke/yourphr/issues/363)); treat backup files as sensitive PHI.
- **Verify your backups.** A backup is only proven by a successful restore — exercise the restore path periodically.
- **Roadmap:** card polish (free disk space, schema version, totals, vacuum) — [#364](https://github.com/jwilleke/yourphr/issues/364); restore-from-upload; at-rest encryption — [#363](https://github.com/jwilleke/yourphr/issues/363).
