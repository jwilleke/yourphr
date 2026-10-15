# Dependency scanning

How this repository finds vulnerable dependencies, and the gap that made a second scanner necessary.

## Dependabot cannot see everything

__A clean Dependabot alerts page is not evidence that the tree is clean.__

Dependabot matches advisories by registry coordinates — package name and version on npm or in the Go module proxy. A dependency resolved from a __git URL__ has no such coordinates, so no advisory can ever be matched to it, and it will never raise an alert.

That is not hypothetical. From [#530](https://github.com/jwilleke/yourphr/issues/530):

- `webcrypto-liner`, a runtime dependency in every shipped bundle, pinned `elliptic` to `https://github.com/mahrud/elliptic` — a fork of 6.5.0
- three advisories applied to that version, the worst rated __critical__
- `gh api "…/dependabot/alerts?per_page=100"` returned `[]` for `elliptic` in __every__ alert state — it had never been reported
- `yarn audit` found it immediately

It was caught by chance, from a version number pasted into a conversation.

A second thing Dependabot does not show by default on this repo: __development-scope alerts are auto-dismissed__. That is a reasonable policy — build tooling does not reach a browser — but it means the alerts page is a view of production dependencies only, not of everything the scanner found.

## What runs

| Scanner | Scope | Where | Gate |
|---|---|---|---|
| Dependabot alerts | npm + Go, registry-resolved only | GitHub Security tab | none — advisory |
| Dependabot version PRs | npm + Go | pull requests | none — triaged by hand |
| CodeQL | Go and TypeScript source | GitHub Security tab | none — advisory |
| `yarn audit` | the whole frontend lockfile, git URLs included | `Audit Frontend Dependencies` job in `development.yaml` | __fails on critical production advisories__ |

## Why the CI gate is narrow

It fails only on __critical__ findings in __production__ dependencies (`--groups dependencies`).

The frontend build chain carries roughly 23 high-severity advisories — eslint, storybook, karma, the Angular devkit — none of which reach a user's browser. A job that is permanently red is a job everybody learns to ignore, which is worse than not having one. The full report is printed on every run regardless of severity, so high and moderate findings stay visible without blocking a merge.

### The exit code is a bitmask

Yarn Classic's `audit` does not return pass/fail. It returns the bitwise OR of the severities it reported:

```text
1  INFO      2  LOW      4  MODERATE      8  HIGH      16  CRITICAL
```

Verified on this tree: one low-severity advisory exits `2`, not `1`. The CI step therefore tests bit 16 rather than checking for a non-zero exit, which would fail every run on that single low finding.

__`--level` does not filter on Yarn Classic.__ Passing `--level critical` still reports lows and still sets their bits, so it is deliberately not used — it would imply a filter that is not happening.

## Running it locally

```bash
cd frontend
yarn audit --groups dependencies     # production only, what CI gates on
yarn audit                           # everything, including build tooling
```

No `yarn install` is needed; `audit` reads `yarn.lock` directly.

## When a finding cannot be fixed by a bump

Two cases have come up:

- __The vulnerable version is pinned inside an upstream package by git URL.__ There is no version to bump to. `elliptic` was fixed with a `resolutions` entry in `frontend/package.json` redirecting the git URL to the patched registry release. Confirm the fork was not chosen for a reason before overriding it.
- __No fixed version exists at any release__ (`patched: <0.0.0`). One `elliptic` advisory is in this state. Nothing to do but record it.

## Related

- [#530](https://github.com/jwilleke/yourphr/issues/530) — the critical that Dependabot could not see
- [#533](https://github.com/jwilleke/yourphr/issues/533) — adding this gate
- [#532](https://github.com/jwilleke/yourphr/issues/532) — loading the polyfill only when it is needed, which would remove the dependency from most sessions entirely
