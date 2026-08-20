import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // DB-backed tests each provision a disposable database and replay every
    // migration — slow on a cold CI runner.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Global setup to pre-warm the shared Postgres container once before all test files
    globalSetup: ['./tests/setup.ts'],
    // Disable Ryuk (testcontainers cleanup reaper) to avoid hangs on macOS Docker Desktop
    // where /var/run/docker.sock is absent (Docker uses ~/.docker/run/docker.sock)
    env: {
      TESTCONTAINERS_RYUK_DISABLED: 'true',
    },
    // Setting `exclude` replaces vitest's defaults instead of extending them, so the
    // node_modules/dist patterns have to be restated here. They must be `**/`-prefixed:
    // a root-relative `node_modules/**` does not match nested ones, which made vitest
    // collect zod's own test suite out of `mcp/node_modules` (208 stray files, 3 failing).
    // `.claude/worktrees/**` holds full checkouts of other branches. vitest globs
    // the filesystem, not git, so gitignoring them is not enough — without this it
    // collects their tests/ too and runs every spec twice, once against this branch
    // and once against unrelated code at a different commit.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
