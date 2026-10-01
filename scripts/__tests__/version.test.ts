/**
 * Unit tests for scripts/version.ts — ngdpbase's version.test.ts, ported, plus the parts that are
 * YourPHR's own: the CHANGELOG heading shape, the compare link, and the release-notes extraction.
 */
import { describe, expect, test } from 'vitest';
import {
  applyReleaseToChangelog,
  applyVersionToLock,
  extractChangelogNotes,
  formatVersion,
  incrementVersion,
  parseVersion,
  releaseHeading,
  repositoryUrl,
  type PackageLock,
  type VersionIncrementType,
} from '../version.js';

describe('parseVersion()', () => {
  test('parses valid semver string', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('3.7.2')).toEqual({ major: 3, minor: 7, patch: 2 });
  });

  test('throws on invalid format', () => {
    expect(() => parseVersion('1.2')).toThrow();
    expect(() => parseVersion('a.b.c')).toThrow();
    expect(() => parseVersion('v1.2.3')).toThrow();
    expect(() => parseVersion('')).toThrow();
  });
});

describe('formatVersion()', () => {
  test('formats components into semver string', () => {
    expect(formatVersion(1, 2, 3)).toBe('1.2.3');
    expect(formatVersion(0, 0, 0)).toBe('0.0.0');
  });
});

describe('incrementVersion()', () => {
  test('increments patch', () => {
    expect(incrementVersion('3.7.2', 'patch')).toBe('3.7.3');
  });

  test('increments minor and resets patch', () => {
    expect(incrementVersion('3.7.2', 'minor')).toBe('3.8.0');
  });

  test('increments major and resets minor+patch', () => {
    expect(incrementVersion('3.7.2', 'major')).toBe('4.0.0');
  });

  test('throws on unknown type', () => {
    expect(() => incrementVersion('1.0.0', 'hotfix' as VersionIncrementType)).toThrow();
  });
});

describe('applyVersionToLock()', () => {
  function v3Lock(version: string): PackageLock {
    return {
      name: 'yourphr',
      version,
      lockfileVersion: 3,
      packages: {
        '': { name: 'yourphr', version, license: 'ISC' },
        'node_modules/zod': { version: '3.23.8', resolved: 'https://example.invalid/zod' },
      },
    };
  }

  test('updates the top-level version and the root package entry', () => {
    const lock = applyVersionToLock(v3Lock('3.7.1'), '3.7.2');
    expect(lock.version).toBe('3.7.2');
    expect(lock.packages?.['']?.version).toBe('3.7.2');
  });

  test('never touches a dependency entry', () => {
    expect(applyVersionToLock(v3Lock('3.7.1'), '3.7.2').packages?.['node_modules/zod']?.version).toBe('3.23.8');
  });

  test('a lockfileVersion 1 file (no packages map) gets its top-level version only', () => {
    const lock = applyVersionToLock({ name: 'yourphr', version: '1.0.0', lockfileVersion: 1 }, '1.0.1');
    expect(lock.version).toBe('1.0.1');
    expect(lock.packages).toBeUndefined();
  });
});

describe('repositoryUrl()', () => {
  test('reads package.json repository, string or object', () => {
    expect(repositoryUrl({ repository: 'https://github.com/jwilleke/yourphr' })).toBe('https://github.com/jwilleke/yourphr');
    expect(repositoryUrl({ repository: { url: 'git+https://github.com/jwilleke/yourphr.git' } })).toBe('https://github.com/jwilleke/yourphr');
  });

  test('falls back to the git remote, https or ssh', () => {
    expect(repositoryUrl({}, 'https://github.com/jwilleke/yourphr.git')).toBe('https://github.com/jwilleke/yourphr');
    expect(repositoryUrl({}, 'git@github.com:jwilleke/yourphr.git')).toBe('https://github.com/jwilleke/yourphr');
  });

  test('nothing to go on gives no link, not a wrong one', () => {
    expect(repositoryUrl({}, '')).toBe('');
    expect(repositoryUrl({}, 'https://gitlab.example/x/y.git')).toBe('');
  });
});

describe('releaseHeading()', () => {
  test('matches the shape every existing entry uses', () => {
    expect(releaseHeading('3.7.2', '3.7.1', '2026-09-26', 'https://github.com/jwilleke/yourphr'))
      .toBe('## [3.7.2](https://github.com/jwilleke/yourphr/compare/v3.7.1...v3.7.2) (2026-09-26)');
  });

  test('without a repository it is still a valid heading', () => {
    expect(releaseHeading('3.7.2', '3.7.1', '2026-09-26', '')).toBe('## [3.7.2] (2026-09-26)');
  });
});

describe('applyReleaseToChangelog()', () => {
  const H = '## [3.7.2](https://github.com/jwilleke/yourphr/compare/v3.7.1...v3.7.2) (2026-09-26)';
  const existing = '# Changelog\n\n## [3.7.1](x) (2026-09-24)\n\n### Bug Fixes\n\n- a fix\n';

  test('goes above the newest entry', () => {
    expect(applyReleaseToChangelog(existing, H, '3.7.2')).toBe(`# Changelog\n\n${H}\n\n## [3.7.1](x) (2026-09-24)\n\n### Bug Fixes\n\n- a fix\n`);
  });

  test('an [Unreleased] section becomes the release, with no placeholder written back', () => {
    const withUnreleased = '# Changelog\n\n## [Unreleased]\n\n### Bug Fixes\n\n- new fix\n\n## [3.7.1](x) (2026-09-24)\n';
    const out = applyReleaseToChangelog(withUnreleased, H, '3.7.2');
    expect(out).toBe(`# Changelog\n\n${H}\n\n### Bug Fixes\n\n- new fix\n\n## [3.7.1](x) (2026-09-24)\n`);
    expect(out).not.toMatch(/Unreleased|Future enhancements/);
  });

  test('running it twice does not add a second heading', () => {
    const once = applyReleaseToChangelog(existing, H, '3.7.2');
    expect(applyReleaseToChangelog(once, H, '3.7.2')).toBe(once);
  });

  test('a changelog with no entries yet gets the heading at the end', () => {
    expect(applyReleaseToChangelog('# Changelog\n', H, '3.7.2')).toBe(`# Changelog\n\n${H}\n`);
  });
});

describe('extractChangelogNotes()', () => {
  const log = '# Changelog\n\n## [3.7.2](l) (2026-09-26)\n\nIntro.\n\n### Bug Fixes\n\n- one\n\n## [3.7.1](l) (2026-09-24)\n\n- older\n';

  test('returns one entry, heading excluded, stopping at the next version', () => {
    expect(extractChangelogNotes(log, '3.7.2')).toBe('Intro.\n\n### Bug Fixes\n\n- one');
  });

  test('the last entry runs to the end of the file', () => {
    expect(extractChangelogNotes(log, '3.7.1')).toBe('- older');
  });

  test('a version with no entry gives empty notes', () => {
    expect(extractChangelogNotes(log, '9.9.9')).toBe('');
  });

  test('dots are literal, so 3.7.2 never matches 3x7x2', () => {
    expect(extractChangelogNotes('## [3x7x2](l) (d)\n\n- wrong\n', '3.7.2')).toBe('');
  });

  test('treats every character of the version literally — no regex is built from it (yourphr#826)', () => {
    const log = '## [3.7.2+build.1](l) (d)\n\n- with metadata\n\n## [3.7.2](l) (d)\n\n- plain\n';
    expect(extractChangelogNotes(log, '3.7.2+build.1')).toBe('- with metadata');
    expect(extractChangelogNotes(log, '3.7.2')).toBe('- plain');
    expect(extractChangelogNotes('## [13.7.2](l)\n\n- other\n', '3.7.2')).toBe(''); // a heading starts a line
    expect(extractChangelogNotes('## [(a](l)\n\n- odd\n', '(a')).toBe('- odd'); // would throw as a regex
  });
});
