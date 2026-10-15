# Upgrading YourPHR v2 (Go) to v3 (TypeScript)

For anyone self-hosting YourPHR who is not running Kubernetes. If you are, the operator runbook is [`cutover-runbook.md`](../archive/cutover-runbook.md) — this page is the general path.

> __Requires 3.2.0 or newer__, which is released. The migration has been rehearsed against a real 20,068-record instance and verified record for record, and since [#654](https://github.com/jwilleke/yourphr/issues/654) it ships inside the image — so nothing on this page needs a source checkout. It is `3.2.0` that carries it: `3.0.x` and `3.1.0` have no `migrate` command, and asking one of them for it fails rather than doing something surprising. Check with `docker run --rm ghcr.io/jwilleke/yourphr:<tag> version`. The one thing still missing is a ready-made compose file ([#641](https://github.com/jwilleke/yourphr/issues/641)); until it lands, step 4 below is the `docker run` that replaces it.

## What is changing, and what is not

__The backend is a rewrite.__ v2 is Go; v3 is TypeScript. Same records, same address, same passwords.

__Your data is not rewritten in place.__ The migration __reads__ your v2 database and __writes__ a new one alongside it. Your v2 data is untouched, which is what makes rolling back possible: if v3 does not suit you, start v2 again and it is exactly as you left it.

__What carries:__ every record, your accounts and their roles, connected sources with their tokens, the provider catalog, legal consent, the access log, and the settings that still mean the same thing.

__What does not:__

- __Sources with no refresh token__ will ask to be reconnected when their current token expires. Not a failure — v2 never stored one for them. Expect it, and tell the household.
- __Three backup-schedule settings__ (`backup.auto-backup`, `-days`, `-time`) do not carry, because v3 schedules differently. Set them again in Admin → Configuration.
- The migration report names anything it did not carry. __Read it__ rather than assuming silence means completeness.

## Before you start

__Back up, and check the backup opens.__ This is the one step that is not optional. An untested backup is a hope.

__Know your encryption keys, if you set any.__ If your v2 instance encrypts its database, you need that key for the migration and v3 needs it every time it starts. Write it somewhere that is not the machine YourPHR runs on: if the disk is lost and the key with it, the records are unreadable. Permanently.

__Decide about encryption before you migrate, not after.__ v3 reads its keys from a `.env` file on its own data volume. If you want the new database encrypted, put that file in place __before__ step 2 — the migration writes the database it is given, and a database that was written unencrypted cannot be encrypted by restarting with a key set. Create `./data/.env` now:

```bash
mkdir -p ./data
cat > ./data/.env <<'ENV'
YOURPHR_DATABASE_ENCRYPTION_KEY=<a long random string you have recorded elsewhere>
YOURPHR_BACKUP_ENCRYPTION_KEY=<a different one>
ENV
chmod 600 ./data/.env
```

If you do not want encryption, skip this — v3 starts either way and says plainly, on every start, that the database is stored in the clear.

__Stop v2 first.__ SQLite has one writer. Copying a database from a running instance can produce a file that looks fine and is not.

## The upgrade

```bash
# 1. stop v2 and take a copy of the data directory
docker compose down
cp -r ./db ./db-v2-backup

# 2. migrate the copy into a new data directory
docker run --rm \
  -v "$PWD/db-v2-backup:/old:ro" \
  -v "$PWD/data:/opt/yourphr/data" \
  ghcr.io/jwilleke/yourphr:3.2.0 \
  migrate --go /old/fasten.db --go-data /old --data /opt/yourphr/data

# 3. read the report. It ends with either
#      MIGRATION VERIFIED — ...        (every record accounted for)
#    or a named disagreement. Do not continue on a red report.

# 4. start v3 on the new data directory
docker run -d --name yourphr --restart unless-stopped \
  -p 8080:8080 \
  -v "$PWD/data:/opt/yourphr/data" \
  ghcr.io/jwilleke/yourphr:3.2.0
```

The v2 database is mounted __read-only__ (`:ro`) on purpose. The migration cannot damage what it is reading, however badly it goes.

The migration is __one-way and safe to re-run__. Anything already carried across is skipped and reported rather than duplicated, so if step 2 fails partway, fix the cause and run it again.

If you would rather keep using compose, point it at `ghcr.io/jwilleke/yourphr:3.2.0`, mount your data directory at `/opt/yourphr/data`, and publish port 8080. A worked compose file ships with [#641](https://github.com/jwilleke/yourphr/issues/641).

### What else the image can do

The migration is one of several commands the image accepts. An argument-less run starts the server, which is what step 4 does:

```bash
docker run --rm ghcr.io/jwilleke/yourphr:3.2.0 help       # every command, with its flags
docker run --rm ghcr.io/jwilleke/yourphr:3.2.0 version    # which build this image actually is
```

An unrecognised command exits non-zero and never starts a server, so a typo in step 2 cannot quietly bring an instance up against the wrong data directory.

## After

__Sign in as yourself and as one other household member.__ Passwords are unchanged — v2's hashes carry across and re-hash on first sign-in.

Then check, in this order, because each answers a different question:

1. __Your records are there.__ Open Explore and a couple of individual records.
2. __Sources are listed__, and any needing reconnection say so.
3. __Account → access log shows today.__ On v3 a read that cannot be logged fails rather than completing silently, so an empty log after signing in is a stop signal, not a cosmetic gap.

__If nobody can sign in at all__ — the account you expected was not in the migration, or a password was already forgotten before you started — the image can let you back in without touching the database by hand:

```bash
docker run --rm -v "$PWD/data:/opt/yourphr/data" \
  ghcr.io/jwilleke/yourphr:3.2.0 \
  reset-password --user <account> --data /opt/yourphr/data
```

It writes a generated password to `./data/.recovery_password` (readable only by its owner) and ends every existing session of that account. It never prints the password, because a container's output goes to the log. Sign in once and change it.

## If it goes wrong

Start v2 again. Your v2 data directory was never written to — that is the whole reason the
migration reads a copy and writes beside it.

Two things worth knowing before you rely on that:

- __The v2 image is still published.__ `ghcr.io/jwilleke/yourphr-go:2.10.3` is the Go stack,
  preserved by digest and unchanged. `ghcr.io/jwilleke/yourphr:2.10.3` also still pulls; nothing
  new will ever appear under 2.x.
- __Rolling back gets more expensive every day.__ Your v2 database is frozen at the moment you
  copied it, so going back loses every record imported or created on v3 since. That is a revert
  with a cost, not a return to a good state — which is an argument for deciding quickly, in either
  direction, rather than running both.

```bash
docker rm -f yourphr
# point compose back at the v2 image and ./db-v2-backup
docker compose up -d
```

Records you created __on v3__ after the switch stay on v3 — export them first if they matter.

## How long it takes

A rehearsal against a real instance — 20,068 records, a 111 MB database — took __87 seconds__ to migrate and verify. Budget a few minutes including stopping and starting. A much larger instance scales roughly with record count.

## Still to come

- __A ready-made compose file.__ [#641](https://github.com/jwilleke/yourphr/issues/641) covers shipping one, along with example Kubernetes manifests and a bare-metal path. Step 4 above is the `docker run` equivalent in the meantime.
