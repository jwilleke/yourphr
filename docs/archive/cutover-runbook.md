# Cut-over runbook: Go → TypeScript stack

The ordered steps for [#588](https://github.com/jwilleke/yourphr/issues/588): freeze the Go instance, migrate, verify, swap ingress, keep Go warm as the rollback — and rehearse the rollback once for real before the runbook counts as done. The decision it executes is recorded on [#543](https://github.com/jwilleke/yourphr/issues/543) (2026-08-21: the TypeScript stack replaces yourPHR once the two are at equal compatibility); the gate is the parity epic [#591](https://github.com/jwilleke/yourphr/issues/591) — every parity child closed or explicitly retired. Do not start at step 1 before that gate is met.

Everything here is about the maintainer's production instance (`mj-infra-flux`, namespace `yourphr`, host `yourphr.nerdsbythehour.com`). Another deployment follows the same order with its own names.

## The shape in one paragraph

Both stacks already run side by side: `yourphr` (Go, `ghcr.io/jwilleke/yourphr`, PVC `yourphr-data` mounted at `/opt/fasten/db`) and `yourphr-ts` (TypeScript, `ghcr.io/jwilleke/yourphr-ts-spike`, PVC `yourphr-ts-data` mounted at `/opt/yourphr/data`), one pod each, `Recreate` strategy (one SQLite writer, never two pods on one data directory). Only the Go Service is behind the Ingress. The cut-over is: stop Go writing, copy its database, run the migration tool into the TypeScript PVC, prove the two agree, then change __one line__ in `ingress.yaml` so the Ingress backend is `yourphr-ts`. Rollback is the same line changed back. Records never leave the LAN: the copy and the migration happen on the node that holds both PVCs.

## Preconditions (checked, not assumed)

- [ ] [#591](https://github.com/jwilleke/yourphr/issues/591): no open parity child — each is closed or carries a written "retired" note on the epic.
- [ ] The spike release that will serve is a __tagged__ image (`vX.Y.Z` on `main` in `jwilleke/yourphr-ts-spike`) and `yourphr-ts` is already running it (Flux's `ImagePolicy` `flux-system:yourphr-ts` follows semver tags only). Confirm: `kubectl -n yourphr get deploy yourphr-ts -o jsonpath='{.spec.template.spec.containers[0].image}'`.
- [ ] `yourphr-ts-keys` holds `SPIKE_DATABASE_ENCRYPTION_KEY` and `SPIKE_BACKUP_ENCRYPTION_KEY`, and __both values are also in the password manager__. An encrypted instance nobody can reopen is worse than none ([architecture principles, backup section](https://github.com/jwilleke/ngdpbase/blob/master/docs/planning/architecture-principles-typescript.md)).
- [ ] A Go backup from the last 24 h exists on the NAS archive (`/nas-backup`, the same share the backup CronJob writes) — this is the independent fallback if both the migration and the rollback go wrong.
- [ ] `deby` (192.168.68.71) has: `sudo kubectl` (k3s), Node 24, and a checkout of `jwilleke/yourphr` with Go, for `TestShadowExport`. The migration tool __ships in the image__ since [#654](https://github.com/jwilleke/yourphr/issues/654) — `<image> migrate --go … --data …`, the same flags the steps below pass to `npm run migrate:go`, so the node no longer needs a TypeScript checkout to run step 3.
- [ ] A maintenance window agreed with the household: from the freeze to the swap nobody can sign in to either stack. Budget 60 minutes; the rehearsal below tells you the real number.
- [ ] This runbook has been rehearsed against a __copy__ first (section "Rehearsal"), including the rollback.

## Step 1 — Freeze the Go instance

Go has no read-only mode, so the freeze is stopping the only writer:

```bash
sudo kubectl -n yourphr scale deploy/yourphr --replicas=0
sudo kubectl -n yourphr wait --for=delete pod -l app=yourphr --timeout=120s
```

From here the Ingress answers 503 (the Service has no endpoints). That is the intended signal — a half-frozen instance that still accepts a sync is the failure this step prevents. Note the time: the freeze clock starts now and the stop rule below is measured from it.

## Step 2 — Copy the Go database (a copy, never the live file)

The PVCs are `local-path` volumes on the node. Find the directories once and write them down:

```bash
sudo kubectl -n yourphr get pvc yourphr-data yourphr-ts-data -o custom-columns=NAME:.metadata.name,VOLUME:.spec.volumeName
# local-path keeps each PV under /var/lib/rancher/k3s/storage/<volume>_yourphr_<pvc>
GO_DIR=/var/lib/rancher/k3s/storage/<volume>_yourphr_yourphr-data
TS_DIR=/var/lib/rancher/k3s/storage/<volume>_yourphr_yourphr-ts-data
```

Copy the frozen Go data directory whole (database plus `config/app-custom-config.json`, which carries the operator's overlay the tool reads):

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
sudo mkdir -p /mnt/tank/jims/data/archive/yourphr-cutover/$STAMP
sudo cp -a "$GO_DIR"/. /mnt/tank/jims/data/archive/yourphr-cutover/$STAMP/go/
sudo sha256sum /mnt/tank/jims/data/archive/yourphr-cutover/$STAMP/go/fasten.db
```

The Go database is plaintext on this instance (`YOURPHR_DATABASE_ENCRYPTION_ENABLED=false`); if it were encrypted the tool takes `--go-key`. The copy lives on the NAS archive that already holds PHI backups — not on a laptop.

## Step 3 — Migrate into the TypeScript PVC

One SQLite writer: the TypeScript pod must not be running while the tool writes its files.

```bash
sudo kubectl -n yourphr scale deploy/yourphr-ts --replicas=0
sudo kubectl -n yourphr wait --for=delete pod -l app=yourphr-ts --timeout=120s
```

Run the tool on the node as the user that owns the PVC directory (the image runs as `node`, uid 1000), with the __same environment the pod has__ — the stores are opened through the same function the server uses, so the keys must match the Secret exactly:

```bash
cd ~/yourphr-ts-spike
export SPIKE_STORAGE_DATA_DIR="$TS_DIR"
export SPIKE_DATABASE_ENCRYPTION_KEY='<from yourphr-ts-keys>'
export SPIKE_BACKUP_ENCRYPTION_KEY='<from yourphr-ts-keys>'
npm run migrate:go -- \
  --go /mnt/tank/jims/data/archive/yourphr-cutover/$STAMP/go/fasten.db \
  --go-data /mnt/tank/jims/data/archive/yourphr-cutover/$STAMP/go \
  --data "$TS_DIR" 2>&1 | tee /mnt/tank/jims/data/archive/yourphr-cutover/$STAMP/migrate.log
```

What it does, and why re-running is safe: every step is one-way — an account, source, catalog entry, consent, access bucket or record already present is kept and reported, never overwritten ([#586](https://github.com/jwilleke/yourphr/issues/586)). Passwords carry as Go's bcrypt hashes and re-hash on first sign-in; nobody resets a password ([#583](https://github.com/jwilleke/yourphr/issues/583)). Sources carry with their tokens; a source with no refresh token is listed under "reconnect at first expiry" — read that list now, it is the household's to-do after the swap ([#584](https://github.com/jwilleke/yourphr/issues/584)).

__Exit code 0 means the tool's own verification agreed for every account and every resource type.__ Exit 1 means stop: the report names the disagreement. Do not swap on a red report.

```bash
sudo chown -R 1000:1000 "$TS_DIR"
sudo kubectl -n yourphr scale deploy/yourphr-ts --replicas=1
sudo kubectl -n yourphr rollout status deploy/yourphr-ts --timeout=180s
```

## Step 4 — Verify against the frozen instance

Two checks, from the copy, before anyone is pointed at the new stack.

__4a — the shadow harness__, the stronger one: Go's own read path answers from the copy, the TypeScript stack answers from its PVC, the harness diffs them per account and resource type.

```bash
cd ~/yourphr
for USER in <each account>; do
  SHADOW_DB=/mnt/tank/jims/data/archive/yourphr-cutover/$STAMP/go/fasten.db SHADOW_USER=$USER \
    SHADOW_OUT=/mnt/tank/jims/data/archive/yourphr-cutover/$STAMP/go-ids-$USER.json \
    go test ./backend/pkg/database/ -run TestShadowExport
done
```

Then, per account, the migration tool's `--go-answers` mode verifies through those answers rather than through Go's tables:

```bash
cd ~/yourphr-ts-spike
npm run migrate:go -- --go …/fasten.db --data "$TS_DIR" --user <account> --go-answers …/go-ids-<account>.json
```

Every run exits 0, or the swap does not happen.

__4b — the parity audit__, through the real UI against the running `yourphr-ts` pod (port-forward; the operator's account):

```bash
sudo kubectl -n yourphr port-forward svc/yourphr-ts 18090:8080 &
node frontend/scripts/parity-audit.mjs --base http://127.0.0.1:18090 --user <operator> --password-file <file>
```

Expected: `missing 404: 0` on every route. The report is kept beside the migration log.

## Step 5 — Swap the Ingress

One line, in `mj-infra-flux/apps/production/yourphr/ingress.yaml`: the backend service `name: yourphr` becomes `name: yourphr-ts` (the port stays 8080; the Authentik forward-auth middleware and the TLS secret are unchanged — they belong to the Ingress, not to either backend). Commit with the stamp in the message, push, let Flux reconcile, and confirm:

```bash
sudo kubectl -n yourphr get ingress yourphr-ingress -o jsonpath='{.spec.rules[0].http.paths[0].backend.service.name}'   # yourphr-ts
curl -sI https://yourphr.nerdsbythehour.com/api/version | head -1
```

Then sign in as the operator and as one household member, open Sources, Explore, Medical History, Account → access log. The access log __must__ show today's reads: on the new stack an unaudited read fails rather than completes, so an empty log after a sign-in is a stop signal, not a cosmetic gap.

Tell the household: the address is unchanged; passwords are unchanged; sources listed under "reconnect at first expiry" will ask to be reconnected when their token runs out.

## Step 6 — Keep Go warm as the rollback

Scale Go back to one replica. It is unreachable from outside (nothing routes to it) and it serves the frozen data unchanged; its worker will try to refresh tokens on its own schedule — that is acceptable for the rollback window because the TypeScript stack holds its own copies of the tokens, and some providers rotate refresh tokens on use, so __a rollback after a Go-side refresh may require reconnecting those sources__. Record that caveat in the rollback note.

```bash
sudo kubectl -n yourphr scale deploy/yourphr --replicas=1
```

__Rollback = point the Ingress back__: revert the one-line commit. Nothing else. Records written on the TypeScript side after the swap stay there (export them with the per-source download before rolling back if they matter).

## The stop rule

From the swap, the strategy doc's rule applies ([strategy, "Stop rules"](./strategy-typescript-transition.md)): __two stacks serving production for more than one release cycle means pick one.__ Concretely: on the first release of `jwilleke/yourphr-ts-spike` after the swap, either delete the Go Deployment from Flux (keeping the NAS archive copy) or roll back for good and record why on [#543](https://github.com/jwilleke/yourphr/issues/543). Not both, not later.

## Rehearsal (required before the real run)

The runbook is not done until the rollback has been rehearsed once for real. The cheap rehearsal that proves the same steps:

1. Take the Go data copy __without__ freezing (step 2 against the live directory is a consistent SQLite copy only if the pod is stopped — so for the rehearsal use the most recent NAS backup instead, restored to a scratch directory).
2. Run steps 3–4 into a __scratch__ directory (`--data /tmp/cutover-rehearsal`), not the PVC. Time it. That number, plus the freeze/scale time, is the maintenance window to announce.
3. Rehearse the swap and the rollback on the Ingress itself at a quiet hour: change the backend to `yourphr-ts` (already running, with whatever data it has), confirm `/api/version` answers the TypeScript version through the real host, change it back, confirm Go answers again. Two commits, ten minutes, and the one thing the real run must not discover for the first time.
4. Write the observed times and any surprise into this document before the real run.

### Rehearsal 1 — steps 1–2, run 2026-08-24

Against `2026-08-24T02-00-41Z-yourphr-prod-2.10.3-backup.tar.gz` (111 MB `fasten.db`), extracted to scratch on the node. The live PVC, the running pods and the Ingress were not touched; nothing left the LAN.

__Result: exit 0 — `MIGRATION VERIFIED — the spike answers what the Go stack holds`.__

| | |
|---|---|
| __Migration time__ | __87 seconds__ (18:17:25 → 18:18:52) for 20,068 records |
| Accounts | 3 of 3; `jwilleke` carried as admin |
| Sources | 8 of 8 |
| Catalog | 6 imported, 0 rejected |
| Records | 20,068 imported, 0 rejected — 15,228 DocumentReference, 3,469 Condition, 373 Encounter, 307 Observation, 130 AllergyIntolerance, … |
| Consent / access log | 1 account's consent, 5 access buckets |
| __Verification__ | __53/53 (user, resource type) id lists agree across 3 accounts__ |
| Output | `records.db` 257 MB, `spike.db` 96 KB |

__The maintenance window to announce__ is 87 seconds of migration plus the freeze and scale time — minutes, not an outage. Budget generously; the number above is the copy, and the real run adds `kubectl scale`, the database copy and the rollout wait.

__Two things to expect, neither a failure:__

- __Six sources have no refresh token__ and will ask to be reconnected at first expiry — `jwilleke:`, `mwilleke:`, `jdoe:` ×3, `jwilleke:Epic (Sandbox)`. This is the household's to-do after the swap ([#584](https://github.com/jwilleke/yourphr/issues/584)); tell them before, not after.
- __Three settings do not carry__ — `backup.auto-backup`, `backup.auto-backup-days`, `backup.auto-backup-time` — because the TypeScript stack schedules differently. Set them again in Admin → Configuration. The tool names them rather than dropping them silently.

__One surprise, and it cost ten minutes:__ the migration tool is __not in the image__ and the spike was not checked out on the node, so the rehearsal needed `git clone` + `npm ci` first. Node 24, npm and git were already present. That was the follow-up named below, and it has since landed ([#654](https://github.com/jwilleke/yourphr/issues/654)): the image has a `migrate` command, so a real run needs no checkout for step 3 at all.

__Still unrehearsed: step 3, the Ingress swap and swap-back.__ That is the half that touches production and the one the real run must not meet for the first time.

## Follow-ups this runbook depends on

- ~~The migration tool should ship in the image so step 3 does not need a Node checkout on the node.~~ __Done__ ([#654](https://github.com/jwilleke/yourphr/issues/654)): the image's entrypoint takes a subcommand, so step 3 is `migrate --go … --data …` passed to the image — via `kubectl exec` on the running pod, or a one-shot `docker run` with the Go copy mounted read-only.
- A Go read-only switch would make step 6 safer than "unreachable but still syncing"; absent that, the reconnect caveat stands.
