import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testcontainers need extra time on first startup (~5s to pull/start container)
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Global setup to pre-warm the shared Postgres container once before all test files
    globalSetup: ['./tests/setup.ts'],
    // Disable Ryuk (testcontainers cleanup reaper) to avoid hangs on macOS Docker Desktop
    // where /var/run/docker.sock is absent (Docker uses ~/.docker/run/docker.sock)
    env: {
      TESTCONTAINERS_RYUK_DISABLED: 'true',
    },
    // Exclude Playwright E2E specs — those are run via `pnpm test:e2e`
    exclude: ['tests-e2e/**', 'node_modules/**'],
  },
});
