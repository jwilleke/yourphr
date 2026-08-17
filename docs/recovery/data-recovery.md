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
| A folder full of `.tar.gz`, correct sizes | The archive held the database and nothing else, so restoring returned records with no operator contact, no schedule, no theme. |
| Backups running, retention pruning | At-rest encryption was on, so backup and restore were __both__ refused, and nothing had run since the day it was enabled. |
| A backup taken every night | Nobody had ever run a restore, so nobody knew the restore step needed a restart, and the first attempt was made during an outage. |

Every one is discovered in seconds by a restore drill, and never by looking at the backup.

## What is already tested, and what is not

Be clear about the boundary, because "it has tests" is often heard as "it is proven".

__Tested in CI, on every commit:__

- a backup archive contains the data root, and excludes the cache and the backup destination
- the database is captured with `VACUUM INTO`, never a raw copy of a live file
- restore accepts both the current `*.tar.gz` and legacy `*.db.gz`, detected by content rather than filename
- restoring into a __fresh, empty instance__ returns records *and* operator contact, while the signing key is not restored
- a backup destination that does not exist, is read-only, or is a file is refused with the real OS error

__Not tested, and not testable by us:__

- that __your__ destination is still writable this week
- that __your__ NAS is still mounted, and that it is a real mount rather than an empty directory
- that your archives are not silently truncated by a disk that filled three weeks ago
- that __you__ can perform a restore under pressure, having done it before
- that the machine you would restore onto still exists, and that you can build or pull the image on it

CI proves the code does what it claims. Only a drill proves your instance can recover.

## The drill

Do this on a __separate__ instance. Never practise on the one holding your records — a restore replaces the database, and a drill that damages live data has inverted the point of the exercise.

### 1. Take a backup, and copy it somewhere else

Admin → Database → __Backup now__. Then copy the resulting `*.tar.gz` off the machine — to a laptop, another disk, anywhere that would survive the original host being destroyed.

A backup that only exists on the machine it is protecting is not protecting it.

### 2. Bring up an empty instance

```bash
docker run -p 8081:8080 -v "$(pwd)/recovery-drill:/opt/fasten/db" \
  -e YOURPHR_DATABASE_ENCRYPTION_ENABLED=false \
  ghcr.io/jwilleke/yourphr:latest
```

Fresh volume, different port, nothing in it. Complete the first-run setup so you can sign in.

### 3. Restore into it

Put the archive in the new instance's backup destination, then Admin → Database → __Restore__. The restore is *staged* and applied on the next start, so restart the container.

That restart is not a detail. Find out about it now, not while your real instance is down.

### 4. Check what came back

This is the part that matters, and the part usually skipped. Do not accept "it started" as success.

- [ ] You can sign in — with a __new__ password if this is a fresh instance, since accounts came from the backup
- [ ] Record counts look right: conditions, medications, observations, documents
- [ ] Open an actual record and read it. A database can restore intact and still be the wrong database.
- [ ] The __operator contact__ and theme are yours, not blank — this is the difference between a backup and a *whole-instance* backup
- [ ] The backup schedule came back
- [ ] Connected sources are listed

### 5. Write down what happened

Date, version restored from, version restored to, how long it took, and anything that surprised you. In an outage you will not be inventing the procedure — you will be following the note you wrote when nothing was on fire.

## Things that will make recovery fail

__At-rest encryption is on.__ While `database.encryption.enabled` is true, backup and restore are both __refused__ ([#367](https://github.com/jwilleke/yourphr/issues/367)). It defaults to on. An instance that has never had a successful backup will look calm and have nothing. Check Admin → Database, and if you want backups, set `YOURPHR_DATABASE_ENCRYPTION_ENABLED=false` explicitly.

__The destination is not what you think.__ A path that looks like a NAS mount is a plain empty directory when the mount is gone, and writes to it succeed. The __Test path__ button writes, fsyncs, reads back and removes — the fsync is what catches a full disk or a dropped mount, which a plain write hides in the page cache.

__You have only one copy, in one place.__ Ransomware encrypts every writable path it can reach, including the backup folder. So does a failing disk. At least one copy should be somewhere the instance cannot write to.

__Nobody knows the encryption key.__ If you enabled at-rest encryption, the database is unopenable without that key, and a key stored only on the machine it protects is not stored.

## What your backups contain

Stated plainly, because it changes where you may put them:

- every user's complete medical records
- __live provider credentials__ — OAuth access tokens, refresh tokens and `client_secret` per connected source. A refresh token grants __ongoing__ access to that patient's records at Epic or CMS until revoked. Not stale artifacts.
- the generated session signing key
- your instance configuration

And, because encryption and backup are mutually exclusive today, __every backup that exists is plaintext__. Treat the file exactly as you would treat the database. Encrypting the artifact itself is [#461](https://github.com/jwilleke/yourphr/issues/461).

## How often

- __Restore drill:__ at least twice a year, and after any upgrade that touches backup or restore. This release ([v2.1.0](https://github.com/jwilleke/yourphr/releases/tag/v2.1.0)) changed the archive format and what restore replaces, which makes it a good moment for one.
- __Test path:__ whenever the destination changes, and after anything that could disturb a mount. Enabling a schedule now runs this automatically and refuses if it fails.
- __Glance at the backup list:__ monthly. Sizes that stop growing, or a newest file older than the schedule, are the two cheapest signals of a silent failure.

## See also

- [`README.md`](README.md) — the buttons, endpoints and configuration
- [`backup-model.md`](backup-model.md) — what a backup contains and why
- [`../deployment/README.md`](../deployment/README.md) — encryption, and the trade it forces
