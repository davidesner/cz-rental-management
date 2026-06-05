// Disable Ryuk (testcontainers cleanup reaper) — it hangs on macOS Docker Desktop
// when /var/run/docker.sock is absent (Docker Desktop uses a custom socket path).
process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true';

import { ensureContainer } from './helpers/db.js';

// Pre-warm the shared Postgres container once before any test file runs.
// This avoids the first test timing out while the container starts (~3-5s).
export async function setup() {
  await ensureContainer();
}
