# Demo seed database

The release image carries a pre-built demo database here, at `/opt/fasten/seed/fasten.seed.db`
([#505](https://github.com/jwilleke/yourphr/issues/505)). A deployment that sets
`YOURPHR_BOOTSTRAP_SEED_RESTORE=true` installs it on first start when its data directory has no
database, so a public demo comes up already populated and a reset is "delete the database, restart".

__This directory is intentionally almost empty in git.__ The `.db` file is a build artifact, produced
by `scripts/build-demo-seed.sh` during the release build and gitignored — a multi-megabyte binary in
version control would be rebuilt-and-committed on every schema change, which is exactly the staleness
the CI build exists to avoid. The directory itself is committed so `COPY seed/` succeeds in a local
image build that has not produced a seed.

The seed contains __synthetic records only__ and __no admin account__. The image is public, so a baked
admin credential would be a published credential, identical on every deployment; the admin is
provisioned at runtime with a per-instance random password instead
([#504](https://github.com/jwilleke/yourphr/issues/504)). `build-demo-seed.sh` verifies both
invariants and fails the build rather than shipping a seed that breaks either.
