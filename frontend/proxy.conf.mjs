/**
 * The `ng serve` dev proxy (yourphr#1017): /api goes to the TypeScript server on localhost.
 *
 * The port is not written here. It is the server's own: `YOURPHR_WEB_LISTEN_PORT`, found the way
 * src/bootstrap-env.ts finds it, falling back to `yourphr.web.listen.port` in
 * config/app-default-config.json. Highest first:
 *
 *   1. the environment `ng serve` runs in
 *   2. `<YOURPHR_FAST_STORAGE>/.env` (default ./data), the per-instance file
 *   3. the repo-root `.env` (cp .env.dev.example .env)
 *   4. config/app-default-config.json
 *
 * Dev only: production, Docker and Kubernetes serve the app and the API from one process and never
 * read this file.
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The last non-blank `NAME=` value in a dotenv file, unquoted; undefined when absent or unreadable. */
function fromEnvFile(file, name) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  let found;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`));
    if (!match) continue;
    let value = match[1].trim();
    const quoted = value.match(/^(['"])(.*)\1$/);
    value = quoted ? quoted[2] : value.replace(/\s+#.*$/, '').trim();
    if (value !== '') found = value;
  }
  return found;
}

function setting(name) {
  if (process.env[name]) return process.env[name];
  const rootEnv = join(repoRoot, '.env');
  const fast = process.env['YOURPHR_FAST_STORAGE'] || process.env['YOURPHR_STORAGE_DATA_DIR']
    || fromEnvFile(rootEnv, 'YOURPHR_FAST_STORAGE') || fromEnvFile(rootEnv, 'YOURPHR_STORAGE_DATA_DIR') || './data';
  const instanceEnv = join(isAbsolute(fast) ? fast : join(repoRoot, fast), '.env');
  return fromEnvFile(instanceEnv, name) ?? fromEnvFile(rootEnv, name);
}

function listenPort() {
  const fromEnv = setting('YOURPHR_WEB_LISTEN_PORT');
  if (fromEnv) return Number(fromEnv);
  const defaults = JSON.parse(readFileSync(join(repoRoot, 'config', 'app-default-config.json'), 'utf8'));
  return Number(defaults['yourphr.web.listen.port']);
}

const port = listenPort();
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`proxy.conf.mjs: YOURPHR_WEB_LISTEN_PORT / yourphr.web.listen.port is not a port: ${port}`);
}

export default {
  '/api': {
    target: `http://localhost:${port}`,
    secure: false,
    changeOrigin: true,
    logLevel: 'debug',
  },
};
