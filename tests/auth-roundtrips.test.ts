import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';
import { createOrganization } from '../core/services/organization.js';
import { membership } from '../core/db/schema.js';

/**
 * Guards the per-request DB round-trip budget.
 *
 * Every authenticated request pays the auth middleware before the handler runs,
 * and in production each round-trip is a network hop to Neon. The auth cost is
 * multiplied across every request the UI makes, so it is worth pinning down
 * rather than letting it drift upward.
 *
 * Budgets are asserted exactly, not as an upper bound: two of the four trips are
 * better-auth internals, so a `<=` assertion would let the middleware regress by
 * a full query the moment a better-auth upgrade dropped one of its own.
 */
const OWNER_GET_BUDGET = 4;  // session, user (both better-auth), user⋈membership, handler
const MEMBER_GET_BUDGET = 5; // …plus property_access, which owners skip entirely

describe('auth middleware round-trip budget', () => {
  it(`spends exactly ${OWNER_GET_BUDGET} DB round-trips for an owner`, async () => {
    const { db, client, recorder } = await freshDb({ recordQueries: true });
    try {
      const app = makeApp(db);
      const { userId, cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
      await createOrganization(db, { userId, name: 'O' });

      recorder.start();
      const res = await app.request('/api/contracts', { headers: { cookie } });
      recorder.stop();

      expect(res.status).toBe(200);
      expect(recorder.count(), `queries:\n${recorder.queries().join('\n')}`).toBe(OWNER_GET_BUDGET);
    } finally {
      // finally, not trailing: this test exists to fail, and a failure that
      // skipped cleanup would leak a database on every regression.
      await client.close();
    }
  });

  it(`spends exactly ${MEMBER_GET_BUDGET} DB round-trips for a member (property_access lookup)`, async () => {
    const { db, client, recorder } = await freshDb({ recordQueries: true });
    try {
      const app = makeApp(db);
      const { userId, cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
      await createOrganization(db, { userId, name: 'O' });
      // Owners short-circuit loadAllowedProperties; members pay for it.
      // Demote by userId, not by the membership createOrganization returned:
      // signing up already auto-creates a personal org (databaseHooks in
      // core/auth/better-auth.ts), and the middleware picks the OLDEST
      // membership — so demoting only the newer one leaves an owner in play.
      await db.update(membership).set({ role: 'member' }).where(eq(membership.userId, userId));

      recorder.start();
      const res = await app.request('/api/contracts', { headers: { cookie } });
      recorder.stop();

      expect(res.status).toBe(200);
      expect(recorder.count(), `queries:\n${recorder.queries().join('\n')}`).toBe(MEMBER_GET_BUDGET);
    } finally {
      await client.close();
    }
  });

  it('does not spend a standalone query just to read must_change_password', async () => {
    const { db, client, recorder } = await freshDb({ recordQueries: true });
    try {
      const app = makeApp(db);
      const { userId, cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
      await createOrganization(db, { userId, name: 'O' });

      recorder.start();
      await app.request('/api/contracts', { headers: { cookie } });
      recorder.stop();

      // better-auth reads the user row once while resolving the session. The
      // middleware may read `user` again only as part of a join that earns its
      // round-trip by fetching membership too — never as a standalone select
      // just to check one column, which is what this used to do.
      const soloUserReads = recorder.queries()
        .filter((q) => /from "user"/.test(q) && !/join/i.test(q));
      expect(soloUserReads, `standalone user reads:\n${soloUserReads.join('\n')}`).toHaveLength(1);
    } finally {
      await client.close();
    }
  });
});
