#!/usr/bin/env node
/**
 * Version management for YourPHR — ngdpbase's `src/utils/version.ts`, ported (2026-09-26).
 *
 * Keeps `package.json`, `package-lock.json` and `CHANGELOG.md` in lockstep, so a release never
 * edits them by hand. `/semver` runs this in its bump step.
 *
 * Usage:
 *   npm run bump                        - Show current version
 *   npm run bump -- patch               - Increment patch version (bug fixes)
 *   npm run bump -- minor               - Increment minor version (new features)
 *   npm run bump -- major               - Increment major version (breaking changes)
 *   npm run bump -- set <version>       - Set specific version
 *   npm run bump -- patch --tag-only    - Bump + create/push an annotated git tag (no GH release)
 *   npm run bump -- minor --release     - Bump + tag + GitHub release from the CHANGELOG entry
 *
 * Where this diverges from ngdpbase, and why:
 *
 * - No `<app>.version` key in `config/app-default-config.json`. YourPHR reads its version from
 *   package.json alone (`src/cli/version.ts`); a copy in config would be a second home for the
 *   same fact.
 * - The CHANGELOG heading is YourPHR's existing shape, `## [x.y.z](compare-link) (date)`, which
 *   every entry since v1 uses, not ngdpbase's `## [x.y.z] - date`.
 * - When an `## [Unreleased]` section exists it becomes the release heading, and no placeholder
 *   ("### Planned / - Future enhancements") is written back: an entry that says nothing is noise
 *   in a file people read, and markdownlint judges it like any other.
 * - The tag is annotated (`git tag -a`), which the `/semver` rules require; ngdpbase's tool made a
 *   lightweight one.
 * - It lives in `scripts/` and runs under tsx, like every other YourPHR tool, rather than being
 *   compiled into `dist/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

/** Walk up from this file until a package.json is found — the project root. */
function findProjectRoot(): string {
  let dir = path.dirname(__filename);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Could not find project root (no package.json found)');
}

export interface VersionComponents {
  major: number;
  minor: number;
  patch: number;
}

export type VersionIncrementType = 'major' | 'minor' | 'patch';

interface PackageJson {
  name: string;
  version: string;
  description?: string;
  repository?: string | { url?: string };
  [key: string]: unknown;
}

/** The parts of package-lock.json this tool touches. */
export interface PackageLock {
  version?: string;
  lockfileVersion?: number;
  packages?: Record<string, { version?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export function parseVersion(version: string): VersionComponents {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid version format: ${version}`);
  return { major: parseInt(match[1]!, 10), minor: parseInt(match[2]!, 10), patch: parseInt(match[3]!, 10) };
}

export function formatVersion(major: number, minor: number, patch: number): string {
  return `${major}.${minor}.${patch}`;
}

export function incrementVersion(currentVersion: string, type: VersionIncrementType): string {
  const { major, minor, patch } = parseVersion(currentVersion);
  switch (type) {
  case 'patch':
    return formatVersion(major, minor, patch + 1);
  case 'minor':
    return formatVersion(major, minor + 1, 0);
  case 'major':
    return formatVersion(major + 1, 0, 0);
  default:
    throw new Error(`Invalid increment type: ${String(type)}`);
  }
}

/**
 * Set the project's own version in a parsed lockfile: the top-level `version` and the root entry
 * `packages[""].version`, and nothing else. Dependency entries belong to npm; rewriting one here
 * would corrupt resolution.
 */
export function applyVersionToLock(lock: PackageLock, newVersion: string): PackageLock {
  lock.version = newVersion;
  // lockfileVersion 1 has no `packages` map — guard rather than assume v2/v3.
  const rootEntry = lock.packages?.[''];
  if (rootEntry) rootEntry.version = newVersion;
  return lock;
}

/**
 * `https://github.com/owner/repo` from package.json's repository field, else from the git remote
 * (YourPHR's package.json has no repository field), else '' — the heading then carries no link.
 */
export function repositoryUrl(pkg: Pick<PackageJson, 'repository'>, gitRemote = ''): string {
  const raw = (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) || gitRemote;
  const m = raw.match(/github\.com[/:]([^/]+\/[^/.\s]+?)(?:\.git)?\s*$/);
  return m ? `https://github.com/${m[1]}` : '';
}

function originUrl(root: string): string {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** The release heading in YourPHR's CHANGELOG shape. */
export function releaseHeading(newVersion: string, previousVersion: string, date: string, repoUrl: string): string {
  const link = repoUrl ? `(${repoUrl}/compare/v${previousVersion}...v${newVersion})` : '';
  return `## [${newVersion}]${link} (${date})`;
}

/**
 * The CHANGELOG with a heading for `newVersion`. An `## [Unreleased]` section — prose written
 * between releases — becomes the release; otherwise the heading goes above the newest entry, and
 * the person releasing writes the entry beneath it before committing. A version already headed is
 * left alone, so running the tool twice cannot double the entry.
 */
export function applyReleaseToChangelog(changelog: string, heading: string, newVersion: string): string {
  if (changelog.includes(`## [${newVersion}]`)) return changelog;
  if (/^## \[Unreleased\][^\n]*$/m.test(changelog)) {
    return changelog.replace(/^## \[Unreleased\][^\n]*$/m, heading);
  }
  if (/^## /m.test(changelog)) return changelog.replace(/^## /m, `${heading}\n\n## `);
  return `${changelog.replace(/\s*$/, '')}\n\n${heading}\n`;
}

/** The body of one version's CHANGELOG entry: from its heading to the next `## [`. */
export function extractChangelogNotes(changelog: string, version: string): string {
  // Plain string search, not a regex built from the version (yourphr#826, CodeQL js/regex-injection):
  // escaping only '.' let any other metacharacter — '+' in build metadata, '(' or '[' — change the
  // pattern. The heading must start a line, so `## [3.7.2]` never matches inside `## [13.7.2]`.
  const heading = `## [${version}]`;
  let at = changelog.startsWith(heading) ? 0 : changelog.indexOf(`\n${heading}`);
  if (at < 0) return '';
  if (at > 0) at += 1; // past the newline
  const lineEnd = changelog.indexOf('\n', at);
  if (lineEnd < 0) return '';
  const next = changelog.indexOf('\n## [', lineEnd);
  return changelog.slice(lineEnd + 1, next < 0 ? changelog.length : next).trim();
}

function today(): string {
  return new Date().toISOString().split('T')[0]!;
}

function showHelp(): void {
  console.log(`
YourPHR Version Management

Usage:
  npm run bump                          - Show current version and info
  npm run bump -- patch                 - Increment patch (bug fixes: 1.2.0 → 1.2.1)
  npm run bump -- minor                 - Increment minor (new features: 1.2.0 → 1.3.0)
  npm run bump -- major                 - Increment major (breaking changes: 1.2.0 → 2.0.0)
  npm run bump -- set <version>         - Set specific version (e.g., 1.2.3)
  npm run bump -- patch --tag-only      - Bump + create/push annotated git tag (no GH release)
  npm run bump -- minor --release       - Bump + tag + GitHub release from the CHANGELOG entry
  npm run bump -- help                  - Show this help

Semantic Versioning:
  MAJOR.MINOR.PATCH
  - MAJOR: Incompatible API changes
  - MINOR: Backward-compatible functionality additions
  - PATCH: Backward-compatible bug fixes
`);
}

function main(): void {
  const root = findProjectRoot();
  const pkgPath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const changelogPath = path.join(root, 'CHANGELOG.md');

  const args = process.argv.slice(2);
  const command = args[0];
  const doRelease = args.includes('--release');
  const doTagOnly = args.includes('--tag-only');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as PackageJson;
  const currentVersion = pkg.version;

  if (!command || command === 'help') {
    if (!command) {
      console.log(`Current version: ${currentVersion}`);
      console.log(`Project: ${pkg.name}`);
      console.log(`Description: ${pkg.description || 'No description'}`);
      console.log('\nRun "npm run bump -- help" for usage information.');
    } else {
      showHelp();
    }
    return;
  }

  let newVersion: string;
  switch (command) {
  case 'patch':
  case 'minor':
  case 'major':
    newVersion = incrementVersion(currentVersion, command);
    break;
  case 'set':
    newVersion = args[1] ?? '';
    if (!newVersion) throw new Error('Please specify a version to set');
    parseVersion(newVersion);
    break;
  default:
    throw new Error(`Unknown command "${command}" — run "npm run bump -- help"`);
  }

  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  if (fs.existsSync(lockPath)) {
    const lock = applyVersionToLock(JSON.parse(fs.readFileSync(lockPath, 'utf8')) as PackageLock, newVersion);
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    console.log(`Updated package-lock.json with version ${newVersion}`);
  } else {
    console.warn('Warning: package-lock.json not found, skipping');
  }

  if (['patch', 'minor', 'major'].includes(command)) {
    try {
      const heading = releaseHeading(newVersion, currentVersion, today(), repositoryUrl(pkg, originUrl(root)));
      fs.writeFileSync(changelogPath, applyReleaseToChangelog(fs.readFileSync(changelogPath, 'utf8'), heading, newVersion));
      console.log(`Updated CHANGELOG.md with version ${newVersion} — write the entry under its heading before committing`);
    } catch (error) {
      console.warn('Warning: Could not update CHANGELOG.md:', (error as Error).message);
    }
  }

  console.log(`Version updated: ${currentVersion} → ${newVersion}`);
  console.log(`Type: ${command.toUpperCase()}`);

  const tag = `v${newVersion}`;
  if (doRelease || doTagOnly) {
    execFileSync('git', ['tag', '-a', tag, '-m', tag], { stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', tag], { stdio: 'inherit' });
    console.log(`Git tag ${tag} created and pushed`);
  }
  if (doRelease) {
    const notes = extractChangelogNotes(fs.readFileSync(changelogPath, 'utf8'), newVersion);
    const tmp = path.join(root, '.release-notes.tmp');
    try {
      fs.writeFileSync(tmp, notes || `Release ${tag}`);
      execFileSync('gh', ['release', 'create', tag, '--title', tag, '--notes-file', tmp], { stdio: 'inherit' });
      console.log(`GitHub release ${tag} created`);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
}

// Run main only when executed directly (ESM-safe), so the tests can import the pure functions.
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (argvPath === __filename) {
  try {
    main();
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}
