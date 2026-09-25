#!/usr/bin/env bash
#
# The store boundary (yourphr#608, #609): a resource has exactly one door.
#
# From ngdpbase's docs/planning/architecture-principles-typescript.md: "only managers/ may import the store or
# the driver, with everything else importing managers. Then the check earns its place the way every
# other harness here has: delete the rule, prove CI goes red." An invariant enforced only by a
# document decays silently; this one goes red.
#
# What it forbids, outside the allowlist:
#   - importing the SQLite driver or SqliteFhirRepository (the store and its handle)
#   - reaching a records handle's `.db` or calling `.prepare(` on one
#
# The allowlist is TRANSITIONAL and shrinks per #608 child. Every entry names the child that removes it.
set -uo pipefail
cd "$(dirname "$0")/.."

# Where the store and the driver may legitimately live.
ALLOW_DRIVER='^src/framework/|^src/app/providers/|^src/SqliteFhirRepository\.ts'
# Not yet converted to managers over providers — each line is a #608 child:
#   src/migrate       reads the GO database (a different store) and carries rows through the managers
#   src/app.ts        the composition root: builds providers over the engine-owned handle
# Removed: src/config — ConfigurationManager now reaches its files through BaseConfigProvider (#621).
# Removed: src/sync and src/ips (#608) — sync writes only through a RecordsWriter handed in, and the
#   summary reads only through a search port the records manager supplies; harnesses build their
#   writer from SqliteRecordsProvider.writer().
ALLOW_TRANSITIONAL='^src/migrate/|^src/app\.ts'

# A type-only import cannot reach a store; it only names the shape a legacy option accepts.
driver_hits=$(
  grep -rnE "from ['\"]better-sqlite3|from ['\"][./]*SqliteFhirRepository\.js['\"]|from ['\"]\.\./SqliteFhirRepository\.js['\"]" src --include='*.ts' 2>/dev/null |
    grep -vE ":[[:space:]]*import type " |
    grep -vE "$ALLOW_DRIVER" | grep -vE "$ALLOW_TRANSITIONAL" || true
)
# A records handle reached past the manager: `repo.db`, `.db.prepare(`, or a `.prepare(` on anything
# outside the allowlist. The app database (src/app.ts, the stores) is transitional, above.
handle_hits=$(
  grep -rnE "\brepo\.db\b|\.db\.prepare\(|\.prepare\(" src --include='*.ts' 2>/dev/null |
    grep -vE "$ALLOW_DRIVER" | grep -vE "$ALLOW_TRANSITIONAL" || true
)

status=0
if [ -n "$driver_hits" ]; then
  echo "store boundary: the driver or the repository is imported outside a provider:" >&2
  echo "$driver_hits" >&2
  status=1
fi
if [ -n "$handle_hits" ]; then
  echo "store boundary: a store handle is reached past its manager:" >&2
  echo "$handle_hits" >&2
  status=1
fi
if [ $status -eq 0 ]; then
  echo "store boundary: clean — the driver lives in providers; no handle reached past a manager"
fi
exit $status
