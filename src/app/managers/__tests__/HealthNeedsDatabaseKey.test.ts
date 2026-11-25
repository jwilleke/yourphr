/**
 * No unlocked fallback for health data (yourphr#991). Wearable readings are written while the
 * patient is signed out, under the database key, so health turns on only when that key is set:
 * with it empty the switch is refused at boot, every health route stays absent, and no samples
 * file is created. Synthetic values only.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthAllowed, openStores } from '../../../app.js';
import { appLog } from '../../../log/index.js';

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'health-key-'));
  dirs.push(dir);
  return dir;
}

describe('healthAllowed', () => {
  it('is off when health is not wanted, whatever the key', () => {
    const log = vi.fn();
    expect(healthAllowed(false, '', log)).toBe(false);
    expect(healthAllowed(false, 'k', log)).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it('is on when health is wanted and the database key is set', () => {
    const log = vi.fn();
    expect(healthAllowed(true, 'k', log)).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it('refuses when the key is empty, saying why and naming the variable, never a value', () => {
    const log = vi.fn();
    expect(healthAllowed(true, '', log)).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatch(/YOURPHR_DATABASE_ENCRYPTION_KEY is not set — health stays off/);
  });
});

describe('openStores with health on', () => {
  it('without a database key: no health manager, no samples file, one boot error', async () => {
    const dir = tempDir();
    const errors = vi.spyOn(appLog, 'error').mockImplementation(() => {});
    const s = await openStores(dir, { YOURPHR_HEALTH_ENABLED: 'true', YOURPHR_HEALTH_DEVICE_INTAKE_ENABLED: 'true' });
    try {
      expect(s.engine.has('health')).toBe(false);
      expect(existsSync(join(dir, 'phd-samples.db'))).toBe(false);
      expect(errors.mock.calls.filter(([line]) => /health stays off/.test(String(line)))).toHaveLength(1);
    } finally {
      await s.close();
    }
  });

  it('with a database key: health and device intake turn on as configured', async () => {
    const dir = tempDir();
    const s = await openStores(dir, {
      YOURPHR_DATABASE_ENCRYPTION_KEY: 'unit-key',
      YOURPHR_HEALTH_ENABLED: 'true',
      YOURPHR_HEALTH_DEVICE_INTAKE_ENABLED: 'true',
    });
    try {
      expect(s.engine.has('health')).toBe(true);
      expect(s.engine.managers.health.enabled).toBe(true);
      expect(s.engine.managers.health.deviceIntake).toBe(true);
      expect(existsSync(join(dir, 'phd-samples.db'))).toBe(true); // the path the refusal test checks is the real one
    } finally {
      await s.close();
    }
  });
});
