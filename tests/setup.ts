// Disable Ryuk (testcontainers cleanup reaper) — it hangs on macOS Docker Desktop
// when /var/run/docker.sock is absent (Docker Desktop uses a custom socket path).
process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true';

import { writeFileSync } from 'node:fs';
import { ensureContainer } from './helpers/db.js';

// Path used to share the container URL with test worker processes.
const URL_FILE = '/tmp/vitest-postgres-url.txt';

// Pre-warm the shared Postgres container once before any test file runs.
// The URL is written to a temp file so that worker processes (which run each
// test file in their own fork) can connect to the same container instead of
// spinning up new ones.
export async function setup() {
  const url = await ensureContainer();
  writeFileSync(URL_FILE, url, 'utf8');
}

export async function teardown() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { unlinkSync } = await import('node:fs');
    unlinkSync(URL_FILE);
  } catch {
    // ignore
  }
}
