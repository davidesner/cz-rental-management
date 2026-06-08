// Vitest global setup — no Docker container management needed.
// Tests use the shared local Postgres (rental-pg) and each test gets its own
// CREATE/DROP database. This file is kept as a no-op for backwards compat.

export async function setup() {
  // intentionally empty
}

export async function teardown() {
  // intentionally empty
}
