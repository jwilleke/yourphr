# Backup & Recovery

Three pages, and it matters which one you need:

| Page | Answers |
|---|---|
| __This page__ | How do I run a backup or a restore? Buttons, endpoints, schedule, configuration. |
| [`data-recovery.md`](data-recovery.md) | __Can my instance actually come back?__ The restore drill — start here before relying on any of the above. |
| [`backup-model.md`](backup-model.md) | What is in a backup, what is deliberately not, and why. |

> __A backup you have never restored is not a backup.__ It is a file you hope is a backup. This page covers the buttons; [`data-recovery.md`](data-recovery.md) covers proving they work on *your* instance.

How yourPHR backs up and restores the databases that hold every user's medical records, plus the instance's own settings. All of it is __admin-only__. The TypeScript server (v3) is what this page describes. Older pages that talk about plaintext backups, gzip, `/opt/fasten/db/fasten.db`, or "turn off encryption to back up" were about the retired Go stack and are wrong today.

See also: [`docs/deployment/README.md`](../deployment/README.md), [`docs/guides/storage-developer-guide.md`](../guides/storage-developer-guide.md).

> ⚠️ A backup holds every user's medical records, __plus live provider refresh tokens__ that grant ongoing access at a hospital or CMS until revoked. Every backup is an __encrypted SQLite file__, written under `YOURPHR_BACKUP_ENCRYPTION_KEY`. The server refuses to back up or restore without that key. Do not turn off database encryption to make backups work — that advice was for the Go stack and does not apply. Treat the backup file and the backup key as carefully as you treat the database.

## Where to find it

__Admin → Database__ (`/admin/database`). It shows where the databases live, whether they are encrypted, their size, the last integrity check, user and source counts, and it drives every backup and restore action below.

The footer shows the running version, fetched live from the public `GET /api/version` endpoint, so you can confirm what is actually deployed.

## Backups

A backup is __one encrypted SQLite file__. It holds the tables from `records.db` (the medical records), `spike.db` (accounts, sources, tokens, the provider catalog, and the rest of the app database), and `phd-samples.db` when that file exists (connected-device samples). The same file also carries the instance's settings overrides (the contents of `<data>/config/app-custom-config.json`).

It is a consistent snapshot, taken while the app is running: the exporter attaches a new file under the backup key and copies schema and rows inside one transaction. It is not a raw copy of a live file, and it is not gzip-compressed — encrypted bytes do not compress. The copy runs on a worker thread so the site keeps answering, including the liveness probe, while a large backup is written.

Two things are deliberately __not__ in it: the destination folder itself (or every archive would contain every previous archive), and `<data>/.env` (the encryption keys, the session secret, the passkey signing key, and any other secrets kept only in the environment). See [`backup-model.md`](backup-model.md).

The long copy of a large instance runs in the background on a worker thread. Two on-demand actions plus a schedule:

### On-demand

- __Download backup__ — takes a fresh backup into the destination folder, then streams that same file to your browser; your Save dialog picks where the download lands. The request is held open while it runs, so stay on the page (a spinner shows progress). The file also stays on the server and counts toward retention. Endpoint: `POST /api/secure/admin/database/backup/download`.
- __Back up to server now__ — writes to the configured server destination folder and returns when the file is written; you can leave the page. Endpoint: `POST /api/secure/admin/database/backup`.

Both write to the destination already saved on the card. Both refuse if no backup key is set.

### Scheduled (automatic)

Settable from the card; saved in the configuration store (`<data>/config/app-custom-config.json`) under `yourphr.backup.schedule.enabled`, `yourphr.backup.schedule.time`, `yourphr.backup.schedule.days`, plus `yourphr.backup.destination` and `yourphr.backup.max-backups`. A worker checks once a minute, so a saved change takes effect on the next due minute, with no restart.

- __Enable__ scheduled backups (off by default)
- __Time__ — `HH:MM` on the __server's local clock__
- __Frequency__ — `daily` or `weekly` (weekly runs on Sunday, also by the server's clock)
- __Keep last__ — retention; older backups beyond this count are pruned after each successful run. The shipped default is `7`. `0` keeps everything.
- __Destination__ — server folder (see below)

Endpoint: `POST /api/secure/admin/database/schedule`.

On a container that does not set `TZ`, that clock is usually UTC. The default time `02:00` is then 21:00 US Eastern in winter and 22:00 in summer. The reference Kubernetes deployment does not set `TZ`.

Setting `YOURPHR_SYNC_INTERVAL_SECONDS=0` (or `yourphr.sync.interval-seconds` to `0`) turns the source-sync worker off, and also turns off the backup scheduler and the backup-alert checks. Use that on a restore-drill instance, not on the instance that is supposed to take nightly backups.

### Filenames

Date-first, UTC, filesystem-safe (colons become dashes), one encrypted SQLite file:

```
2026-09-28T12-27-27Z-yourphr-backup.db
└──── UTC timestamp ───┘
```

They sort chronologically by name. The file is encrypted with the backup key (`YOURPHR_BACKUP_ENCRYPTION_KEY`); it is not gzip-compressed. Two backups in the same second get `-2`, `-3` after the timestamp. Files named `…-yourphr-spike-backup.db`, written before [#790](https://github.com/jwilleke/yourphr/issues/790), are still listed, counted toward __Keep last__, pruned and restorable.

### Destination folder

The destination is __any absolute server folder__ the app can write to. Set it in the card by typing a path or using __Browse__ (an admin-only server-folder navigator, `GET /api/secure/admin/database/browse?path=…`). It is stored until you change it, and is used by both the schedule and "Back up to server now". Blank falls back to `<data>/backups`.

The shipped default is `${YOURPHR_SLOW_STORAGE}/backups`. `YOURPHR_SLOW_STORAGE` and `YOURPHR_FAST_STORAGE` are ordinary environment variables, not configuration keys. If you do not set the slow root, it defaults to the data directory. The published image sets both to `/opt/yourphr/data`, so backups land on the same volume as the databases unless you change the destination or set `YOURPHR_SLOW_STORAGE` to a path you have mounted off that volume.

__Test path__ on the card (`POST /api/secure/admin/database/backup/test`) writes a small probe file into the folder and removes it. If the folder does not exist or is not writable, it reports the operating-system error. Saving the schedule does not run this check; press __Test path__ before you rely on a new destination. A "Backup now" will create a missing folder if it can; the test will not.

> On Kubernetes the only persistent, writable path is usually the data volume. To back up __off__ that volume, mount external storage into the pod and point the destination there — see [Production](#production-kubernetes).

## Restore

Restoring __replaces the databases__ (all users), so the live files are never overwritten while they are open. The restore is __staged in the background__, then __applied on the next app start__:

1. __Start__ (`POST /api/secure/admin/database/restore`, requires `confirm: true` and a `backup_name` that already sits in the destination folder):
   - The requested file must __exactly match a backup in the destination__ (the server lists the folder and will only open a name it already knows — it never builds a path from raw request input).
   - The server answers immediately (`202`) and does the heavy work on a worker thread, so you can leave the page. A notice tells you when staging is ready, or why it failed.
   - It first takes a fresh backup of the current databases (so the restore is reversible).
   - It opens the chosen backup under the backup key, runs `PRAGMA integrity_check`, and writes new files under this instance's database key: `<data>/records.db.staged`, `<data>/spike.db.staged`, and `<data>/phd-samples.db.staged` only when the backup actually carries device samples. Settings, when the backup has them, are written to `<data>/config.staged.json`. The live files are not touched at this step.
   - If staging fails halfway, the staged files are removed and nothing is applied later.
2. __Apply at the next start__ of the server (not of the CLI tools — `compact`, `reindex`, `migrate` and `reset-password` never apply a staged restore). Before any database is opened, each live file steps aside as `*.pre-restore` (and its `-wal`/`-shm` siblings as `*.pre-restore-wal` / `*.pre-restore-shm`), and the staged file takes its name. `records.db` and `spike.db` are applied together or not at all; a partial set is renamed `*.incomplete` and the current databases stay as they are. Settings are applied at the same moment; the previous `app-custom-config.json` is kept as `app-custom-config.json.pre-restore`.

In the UI: __Restore…__ on a backup row → type `restore` to confirm → "Staging the restore in the background…" → wait for the notice → __restart the app or pod__. After restart, the data reflects that backup and the `*.pre-restore` files hold what was there before.

__Restore onto a copy first__, not onto the instance that holds your only live records. Practise on a separate empty instance (see [`data-recovery.md`](data-recovery.md)). Even on the live instance, the automatic backup taken just before staging, and the `*.pre-restore` files after the restart, are your way back if the restored data is not what you expected.

A backup never includes `<data>/.env`. After a restore onto a new instance you must supply, at least:

- the __backup key__ (to open the file)
- this instance's __database key__ (the restored files are re-encrypted under it; it may be different from the original instance's)
- `YOURPHR_CREDENTIALS_KEY` if you want passkeys from the backup to keep working
- any other secrets that lived only in `.env` (for example a mail password)

Accounts and their passwords come back with `spike.db`. Session cookies do not; everyone signs in again.

Restoring from an __uploaded__ file (rather than one already in the destination) is not supported. Copy the file into the destination folder first.

Old Go-era `.tar.gz` or `.db.gz` archives are not this restore path. If you still have one, see [`upgrading-v2-to-v3.md`](../deployment/upgrading-v2-to-v3.md).

## Configuration

Schedule, destination and retention are normally managed from the card and persisted in the configuration store. These keys provide the shipped defaults. Only the encryption key is environment-owned; the others can also be set as `YOURPHR_*` variables (prefix `YOURPHR_`, uppercase, and turn `.` and `-` into `_`), which then cannot be changed from the Admin screen.

| Key | Env | Meaning | Default |
|---|---|---|---|
| `yourphr.backup.encryption.key` | `YOURPHR_BACKUP_ENCRYPTION_KEY` | Key that encrypts every backup. Required. | *(empty — backups refuse)* |
| `yourphr.backup.destination` | `YOURPHR_BACKUP_DESTINATION` | Default destination folder | `${YOURPHR_SLOW_STORAGE}/backups` |
| `yourphr.backup.schedule.enabled` | `YOURPHR_BACKUP_SCHEDULE_ENABLED` | Enable the schedule | `false` |
| `yourphr.backup.schedule.time` | `YOURPHR_BACKUP_SCHEDULE_TIME` | `HH:MM` server-local | `02:00` |
| `yourphr.backup.schedule.days` | `YOURPHR_BACKUP_SCHEDULE_DAYS` | `daily` or `weekly` | `daily` |
| `yourphr.backup.max-backups` | `YOURPHR_BACKUP_MAX_BACKUPS` | Retention count; `0` keeps everything | `7` |
| `yourphr.backup.storage.provider` | `YOURPHR_BACKUP_STORAGE_PROVIDER` | `filesystem` or `null` | `filesystem` |
| `yourphr.backup.alert.stale-hours` | | Error notice when a daily schedule has no success for this many hours | `49` |
| `yourphr.backup.alert.stale-hours-weekly` | | Same, when the schedule is weekly | `193` |
| `yourphr.backup.alert.unscheduled-days` | | Warning notice when no backup has succeeded in this many days, even if the schedule is off | `15` |

There is no `backup.label` / `YOURPHR_BACKUP_LABEL`, and filenames are not stamped with the app version. There is no `<db-dir>/.backup_settings.json`. Last-run health is recorded in `<data>/.backup_health.json` for alerts; that file is not inside the backup.

## API summary

| Method + path | Purpose | Auth |
|---|---|---|
| `GET /api/version` | Running app version (footer) | public |
| `GET /api/secure/admin/database` | DB details + schedule + backups list + health | admin |
| `POST /api/secure/admin/database/backup` | Back up to the server folder | admin |
| `POST /api/secure/admin/database/backup/download` | Take a backup and stream it to the browser | admin |
| `POST /api/secure/admin/database/schedule` | Save the auto-backup settings | admin |
| `POST /api/secure/admin/database/backup/test` | Prove a destination folder is writable | admin |
| `GET /api/secure/admin/database/browse?path=` | List a server folder's subdirs | admin |
| `POST /api/secure/admin/database/restore` | Start staging a restore (`202`; applied on the next start) | admin |

## Production (Kubernetes)

The published image is `ghcr.io/jwilleke/yourphr`. Deploys on the maintainer's instance are __release-gated__ (see the deployment contract). The serving Deployment there is `yourphr-ts` in the `yourphr` namespace.

- __Data:__ `/opt/yourphr/data` on the `local-path` PVC `yourphr-ts-data`. That directory holds `records.db`, `spike.db`, `phd-samples.db` when present, `config/`, `.env`, and notifications. The databases must stay on fast local storage — SQLite's WAL mode is not safe on NFS or SMB, and the server refuses to open them there.
- __Off-volume backups:__ on the reference instance the NAS share is mounted into the app pod as a `hostPath` — node `/mnt/tank/jims/data/archive/yourphr-backup` → container __`/nas-backup`__. Point the card's destination at `/nas-backup` so backups land on the NAS, not the same volume as the databases. A self-hosted instance should do the same with whatever off-volume path it mounts; the image's default slow root is still `/opt/yourphr/data`.
- __Restart after a staged restore:__ `kubectl -n yourphr rollout restart deploy/yourphr-ts`.
- The previous hourly raw-`cp` CronJob was __retired__. The app's own scheduled backup is the consistent snapshot.

> Because the app pod uses a local-path PVC and a `Recreate` strategy, the `hostPath` resolves on the same node as the data. Confirm that node actually has the NFS share mounted at `/mnt/tank/jims` — otherwise `DirectoryOrCreate` would write to node-local disk instead of the NAS.

## Disaster recovery

### Restore a known-good backup — to a copy first

1. Stand up a __separate__ instance (or copy the data directory aside) that has the live __backup key__ and a database key. Do not practise on the only copy of your records.
2. Put the backup file in that instance's __destination folder__ (for example `/nas-backup` on the reference instance, or copy a downloaded `*-yourphr-backup.db` there).
3. __Admin → Database → Restore…__ on that file → type `restore`. Wait for the notice that staging is ready.
4. __Restart__ the app or pod.
5. Sign in with an account from the backup, check record counts, and open an actual record. The prior databases are kept as `*.pre-restore`.

Only after that copy looks right should you stage the same backup on the live instance, if that is the plan.

### Rebuild from total loss (volume or node gone)

1. Stand up a fresh instance from the released image, with a new data volume and the same off-volume backup mount.
2. Put the backup key (and, for passkeys, the original `YOURPHR_CREDENTIALS_KEY`) in the new volume's `.env` *before* the first start if you already have them, or supply them in the environment.
3. Put the chosen backup in the destination folder (it should be on the NAS, off the lost volume — that is the point).
4. Restore + restart as above, then re-add any `.env` secrets the backup never carried.

This is why backups must live __off__ the data volume: a backup on the same `local-path` PVC dies with the databases.

## Security & limitations

- __Admin-only.__ Every backup and restore endpoint requires the `admin-system` permission. The destination and folder browser are admin-chosen paths (an admin already has full database control).
- __Encrypted backups.__ A backup cannot be written or opened without `YOURPHR_BACKUP_ENCRYPTION_KEY`. The database key (`YOURPHR_DATABASE_ENCRYPTION_KEY`) is separate: the file that stays and the file that travels should not fall to the same compromise. They may be the same value if you choose, but they are never assumed to be. Record both keys somewhere that is not this instance.
- __The backup still holds live credentials.__ Encryption protects the file at rest; anyone who has the file *and* the backup key can use the refresh tokens inside it.
- __Verify your backups.__ A backup is only proven by a successful restore onto a copy — exercise that path periodically. See [`data-recovery.md`](data-recovery.md).
- If the schedule is on and no backup has succeeded for 49 hours (193 when weekly), every admin gets an error notice. If no backup has succeeded for 15 days, they get a warning even if the schedule is off.
