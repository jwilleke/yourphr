# The backup model

The rule, decided 2026-08-03 ([#466](https://github.com/jwilleke/yourphr/issues/466)):

> __`<data root>/` is exactly what a backup contains. Everything in that path is backed up; nothing outside it is.__

One sentence, no exclusion list. An exclusion list would weaken it to "everything except the bits we remembered", and the bit nobody remembers is the one that matters at restore time.

## Why it needed deciding

The data root and the backup contents were different things, and nobody had noticed.

`<data root>` holds:

```text
fasten.db  fasten.db-wal  fasten.db-shm   the records
.jwt_issuer_key                           session signing key
config/app-custom-config.json             operator contact, theme, overrides
```

A backup held __the database only__ — `VACUUM INTO`, gzipped.

So restoring onto a fresh instance returned the records and lost the operator contact, the theme, the backup schedule, and any legal-document override. The instance came back as *records without identity*.

## What follows from the rule

__The cache lives outside the data root.__ Disposable, regenerable, potentially large. Under the rule it would otherwise be backed up. This settles an open question: `cache.location` does __not__ derive under the data root.

__Backups live outside the data root__, at an admin-chosen path. Otherwise each backup contains every previous backup.

__A destination must be provable before a schedule uses it__ ([#468](https://github.com/jwilleke/yourphr/issues/468)). A schedule pointing at a directory that does not exist fails silently at 02:00 every night, and is discovered when a backup is needed and absent.

## `AllowedBackupRoots` was removed

It was an allowlist of directories a backup destination could sit under. On a single-operator instance it constrained nobody: the endpoints are admin-only, and the same admin could widen the list from `/admin/config`.

The separation it implied — deployment operator versus app admin — does not exist here. YourPHR's own Privacy Policy says the operator holds the records: one household, one server, one person. A control that only stops someone who can also rewrite the control is not a control.

Its fourth rule made this plain: *whatever destination was saved previously is allowed*. An allowlist that grows by use is not an allowlist.

__Retained:__ path hygiene — absolute, `filepath.Clean`ed, directory exists and is writable, failing with the real OS error. That is input validation, not authorization, and it is worth keeping.

### CodeQL flags this, and the alerts are dismissed

Removing the allowlist left 14 high `go/path-injection` alerts across `TestBackupDestination` and `WriteBackupArchive`: an admin-supplied string reaches `os.OpenFile`. The finding is __accurate__. It was dismissed as *won't fix* against this page ([#488](https://github.com/jwilleke/yourphr/issues/488)), because the exposure is an admin writing where they already could.

That dismissal is the first thing to revisit if the threat model changes — more than one admin, an admin who is not the operator, a hosted or multi-tenant deployment, or a destination settable by anyone but an admin. Dismissed alerts are not re-raised by a scan, so nothing will remind you.

Replacing it with a __test__ asks a better question. The allowlist asked *"are you permitted here?"* — one obvious answer on a family instance. A test asks *"does this actually work?"* — which nobody knows until it is tried.

## A backup contains live credentials

This was already true before the scope expanded, and is the most important thing on this page.

The database holds `source_credentials`: OAuth access tokens, refresh tokens and `client_secret` for every connected provider. __A refresh token grants ongoing access to that patient's records at Epic or CMS until it is revoked__ — it is not a stale artifact of a past session.

Expanding to the whole data root adds the JWT signing key and anything an operator keeps in the config store. Meaningful, but the crown jewels were already in there.

Note the interaction with at-rest encryption: while `database.encryption.enabled` is on, backup and restore are refused ([#367](https://github.com/jwilleke/yourphr/issues/367)) — so in practice __every backup that exists is plaintext__. Encrypting the artifact itself ([#461](https://github.com/jwilleke/yourphr/issues/461)) is what resolves this, and the rule on this page makes it load-bearing rather than optional.

## Threat model, stated plainly

Nobody is targeting one family's records. The realistic exposures are undramatic:

- a NAS share readable by the whole household
- a disk sold, returned under warranty, or binned
- ransomware sweeping every writable path it can reach
- a backup copied somewhere convenient and forgotten

None of these are addressed by an allowlist. All of them are addressed by encrypting the artifact.

## Related

- [#467](https://github.com/jwilleke/yourphr/issues/467) — back up the whole data root
- [#468](https://github.com/jwilleke/yourphr/issues/468) — test a destination before a schedule uses it
- [#469](https://github.com/jwilleke/yourphr/issues/469) — remove `AllowedBackupRoots`, keep path hygiene
- [#461](https://github.com/jwilleke/yourphr/issues/461) — encrypted backups
- [#367](https://github.com/jwilleke/yourphr/issues/367) — the encryption/backup exclusion this eventually lifts
- [`README.md`](README.md) — how to actually run a backup or restore
- [`data-recovery.md`](data-recovery.md) — the restore drill: test recovery, not backup
