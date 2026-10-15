# /semver — YourPHR additions

`semver.md` is written for ngdpbase. In this repo the release procedure is [`docs/development/releasing.md`](../../docs/development/releasing.md): follow it, and read the kit's steps through this mapping.

- __Step 1:__ the branch is `main`, not `master`.
- __Step 4 (tests):__ `npm run build`, `npm run typecheck`, `npm test`, `make test-e2e`. There is no `./server.sh`; the E2E harness boots its own server.
- __Step 5 (bump):__ `npm run bump -- <level>` (`scripts/version.ts`). YourPHR has no version key in `config/app-default-config.json`; `package.json` is the only source. After the bump, write the CHANGELOG entry under the new heading before committing.
- __Step 5a/5b (baseline):__ `npm run test:baseline:compare` (`scripts/baseline-profile.ts`), same thresholds and exit code as ngdpbase. Stage `docs/performance/baseline-v<VERSION>-*.md`.
- __Step 8 (jimstest, `/othersites`):__ does not apply; YourPHR has no satellite installs. Instead confirm the live deploy: the `Docker (release)` run for the tag succeeded, Flux's `yourphr` ImagePolicy resolved to the new tag, and the `yourphr-ts` pod in namespace `yourphr` runs it and answers `/healthz` (cluster access: `ssh 192.168.68.71`, `sudo kubectl`).
