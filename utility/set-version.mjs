#!/usr/bin/env node
// set-version.mjs — write the project version into package.json and package-lock.json.
//
// Why this exists, rather than editing package.json by hand:
//
//   package-lock.json carries the project version in TWO places — the top-level
//   `version` and `packages[""].version` — and npm rewrites both on the next
//   `npm install`. A release that bumps only package.json leaves the lockfile one
//   version behind, so every checkout shows a two-line lockfile diff after any
//   build. Those get discarded by hand at each release, which trains a reflexive
//   `git checkout -- package-lock.json` that will eventually throw away a real
//   lockfile change.
//
// Why not `npm install --package-lock-only`:
//
//   That re-resolves the dependency tree against the registry and may bump
//   transitive resolutions that happen to satisfy existing ranges. During a
//   release that is badly timed — the test gate already passed against the old
//   resolution, so the lockfile that ships is not the one that was tested. This
//   script writes the version fields and nothing else.
//
// Usage:
//   node utility/set-version.mjs 1.2.3            # write both files
//   node utility/set-version.mjs 1.2.3 --check    # report what would change, write nothing
//
// npm serializes its lockfile as 2-space JSON with a trailing newline, so a
// parse -> JSON.stringify(value, null, 2) round-trip is byte-identical to npm's
// own output and the diff stays two lines instead of thousands. Pinned by a test.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** npm's on-disk shape: 2-space JSON, trailing newline. */
export function serialize(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Semver, with the prerelease and build parts each allowed at most once.
 *
 * The previous pattern was `(?:[-+][0-9A-Za-z.-]+)*` — a starred group whose
 * separator `-` also appears inside its own character class, so a run of dashes
 * could be partitioned between the separator and the body in exponentially many
 * ways. `1.0.0` + 40 dashes + `!` took 2.6s; 50 took 70s (CodeQL js/redos).
 *
 * Splitting prerelease from build removes the ambiguity: `+` is not in the
 * class, so the build separator can only be the separator, and neither group is
 * quantified from outside.
 */
export function isValidVersion(version) {
  return (
    typeof version === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?(?:\+[0-9A-Z.-]+)?$/i.test(version)
  );
}

/** Return a copy of a parsed package.json with `version` set. Input is not mutated. */
export function setPackageVersion(pkg, version) {
  return { ...pkg, version };
}

/**
 * Return a copy of a parsed package-lock.json with the project's own version set
 * in both places it appears. Dependency entries are never touched — rewriting one
 * would corrupt resolution. `packages[""]` is absent in lockfileVersion 1, which
 * is handled by leaving the map alone.
 */
export function setLockfileVersion(lock, version) {
  const next = { ...lock, version };

  const root = lock.packages?.[''];
  if (root) {
    next.packages = { ...lock.packages, '': { ...root, version } };
  }

  return next;
}

function countChangedLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let changed = Math.abs(a.length - b.length);

  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) changed++;
  }

  return changed;
}

function main(argv) {
  const version = argv[0];
  const check = argv.includes('--check');

  if (!isValidVersion(version)) {
    console.error('usage: node utility/set-version.mjs <x.y.z> [--check]');
    return 1;
  }

  for (const [file, transform] of [
    ['package.json', setPackageVersion],
    ['package-lock.json', setLockfileVersion]
  ]) {
    const before = readFileSync(file, 'utf8');
    const after = serialize(transform(JSON.parse(before), version));
    const changed = countChangedLines(before, after);

    if (before === after) {
      console.log(`${file}: already ${version}`);
      continue;
    }

    if (check) {
      console.log(`${file}: would change ${changed} line(s)`);
      continue;
    }

    writeFileSync(file, after);
    console.log(`${file}: set to ${version} (${changed} line(s) changed)`);
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
