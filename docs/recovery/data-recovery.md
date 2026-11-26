# Data recovery

> __A backup you have never restored is not a backup. It is a file you hope is a backup.__
>
> Test __recovery__, not backup. A green "Backup complete" proves a file was written. It proves nothing about whether that file can bring your records back, on a machine that no longer has anything on it, on the day you actually need it.

This page is about the drill. For how the buttons work see [`README.md`](README.md); for what a backup contains and why, see [`backup-model.md`](backup-model.md).

## Why this page exists

Every failure mode below has happened to somebody, and none of them is visible from the backup side:

| What the backup side showed | What was actually true |
|---|---|
| "Backup complete", nightly, for months | The destination was a NAS mount that unmounted in March. Files were written to the empty mountpoint on the local disk, which filled. |
| A folder full of backups, correct sizes | The restore was tried on the live instance first, and nobody had practised the restart or the keys a fresh volume needs. |
| Backups running, retention pruning | The backup key lived only on the data volume. The volume was lost, and every backup on the NAS was unreadable. |
| A backup taken every night | Nobody had ever run a restore, so nobody knew staging is applied on the next start, and the first attempt was made during an outage. |

Every one is discovered in seconds by a restore drill, and never by looking at the backup.

## What is already tested, and what is not

Be clear about the boundary, because "it has tests" is often heard as "it is proven".

The repository has tests for the exporter, the staging step, the swap at start, and for a backup that does or does not carry device samples or settings. Those tests prove the code does what it claims.

__Not tested, and not testable by us:__

- that __your__ destination is still writable this week
- that __your__ NAS is still mounted, and that it is a real mount rather than an empty directory
- that your files are not silently truncated by a disk that filled three weeks ago
- that __you__ still have the backup key, and can type it into a new instance
- that __you__ can perform a restore under pressure, having done it before
- that the machine you would restore onto still exists, and that you can pull the image on it

Only a drill proves your instance can recover.

## The drill

Do this on a __separate__ instance. Never practise on the one holding your records — a restore replaces the databases, and a drill that damages live data has inverted the point of the exercise. Restore onto a copy first; only then, if you must, stage the same backup on the live instance.

### 1. Take a backup, and copy it somewhere else

Admin → Database → __Back up to server now__ or __Download backup__. Then copy the resulting `*-yourphr-backup.db` off the machine — to a laptop, another disk, anywhere that would survive the original host being destroyed.

A backup that only exists on the machine it is protecting is not protecting it. You also need the backup key, recorded somewhere that is not that same machine.

### 2. Bring up an empty instance

A fresh volume, a different port, nothing in it. Bare metal is fine; so is Docker. Give it the live __backup__ key (the one that encrypted the file) and any __database__ key for this drill instance. The restore is written under this instance's database key, so it does not have to be the live instance's key.

Turn the source-sync worker off, so restored refresh tokens are not used against a provider during the drill:

```bash
docker run -p 8081:8080 \
  -v "$(pwd)/recovery-drill:/opt/yourphr/data" \
  -e YOURPHR_BACKUP_ENCRYPTION_KEY='<the-live-backup-key>' \
  -e YOURPHR_DATABASE_ENCRYPTION_KEY='<any-key-for-this-drill>' \
  -e YOURPHR_SYNC_INTERVAL_SECONDS=0 \
  ghcr.io/jwilleke/yourphr:latest
```

Use the same image tag you actually run, if you can. Complete the first-run setup so you can sign in as the bootstrap admin long enough to open Admin → Database. Setting `YOURPHR_SYNC_INTERVAL_SECONDS=0` also turns off scheduled backups and backup alerts on this drill instance, which is what you want here.

Do not set `YOURPHR_DATABASE_ENCRYPTION_ENABLED=false`. That variable is not used. An empty database key would leave this drill's databases in the clear; a key you choose for the drill is enough.

### 3. Restore into it

Put the `*-yourphr-backup.db` file in the new instance's backup destination (the default, if you have not changed it, is `/opt/yourphr/data/backups` in the container — that is `recovery-drill/backups` on the host in the example above). Then Admin → Database → __Restore…__ on that file, type `restore`, and wait for the notice that staging is ready.

Restart the container (or the process). That restart is not a detail. Find out about it now, not while your real instance is down.

If staging failed, the notice says why — often a wrong backup key, or a file that is not one of ours. The live drill databases are left as they were.

### 4. Check what came back

This is the part that matters, and the part usually skipped. Do not accept "it started" as success.

- [ ] You can sign in with an __account from the backup__ (its password came back with `spike.db`). The drill instance's bootstrap admin was replaced when `spike.db` was swapped in.
- [ ] Record counts look right: conditions, medications, observations, documents
- [ ] Open an actual record and read it. A database can restore intact and still be the wrong database.
- [ ] The operator contact and other settings you changed are yours, not the shipped defaults — this is the difference between a database-only file and a backup that also carried settings. A backup taken before settings were included keeps the drill instance's current settings and says so in the notice.
- [ ] The backup schedule came back, if it was saved as a setting when the backup was taken
- [ ] Connected sources are listed
- [ ] If you use passkeys, they work only when this instance has the original `YOURPHR_CREDENTIALS_KEY` in its `.env`

### 5. Write down what happened

Date, version restored from, version restored to, how long it took, which keys you had to supply, and anything that surprised you. In an outage you will not be inventing the procedure — you will be following the note you wrote when nothing was on fire.

## Things that will make recovery fail

__There is no backup key, or it is only on the lost volume.__ Every backup is unreadable without `YOURPHR_BACKUP_ENCRYPTION_KEY`. A key stored only on the machine it protects is not stored.

__The destination is not what you think.__ A path that looks like a NAS mount is a plain empty directory when the mount is gone, and writes to it can succeed. Use __Test path__ when you change the destination, and keep at least one copy somewhere the instance cannot write to.

__You restore onto the live instance first.__ The server does take a fresh backup before it stages, and it keeps `*.pre-restore` files after the swap, but a drill that can only be done during an outage is not a drill. Use a copy.

__The source-sync worker is left on.__ A restored refresh token is live. On a drill instance set `YOURPHR_SYNC_INTERVAL_SECONDS=0` so the worker does not call a provider with it.

__You expected `.env` or a file in `config/` other than the settings store to come back.__ They do not. Re-add them by hand. See [`backup-model.md`](backup-model.md).

## What your backups contain

Stated plainly, because it changes where you may put them:

- every user's complete medical records
- __live provider credentials__ — OAuth access tokens, refresh tokens and `client_secret` per connected source. A refresh token grants __ongoing__ access to that patient's records at a hospital or CMS until revoked.
- accounts, including password hashes, and passkey rows (the latter need the original credentials key)
- your instance settings overrides

The file is encrypted with the backup key. Anyone who has the file *and* that key can read all of the above. Treat it accordingly.

## How often

- __Restore drill:__ at least twice a year, and after any upgrade that touches backup or restore.
- __Test path:__ whenever the destination changes, and after anything that could disturb a mount.
- __Glance at the backup list:__ monthly. Sizes that stop growing, or a newest file older than the schedule, are the two cheapest signals of a silent failure. The server will also raise a notice if a daily schedule goes 49 hours without a success, or if no backup has succeeded in 15 days.

## See also

- [`README.md`](README.md) — the buttons, endpoints and configuration
- [`backup-model.md`](backup-model.md) — what a backup contains and why
- [`../deployment/README.md`](../deployment/README.md) — the two encryption keys, and what the data volume holds
