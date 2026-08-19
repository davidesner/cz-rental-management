import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';
import { createOrganization } from '../core/services/organization.js';

/**
 * Guards the per-request DB round-trip budget.
 *
 * Every authenticated request pays the auth middleware before the handler runs,
 * and each round-trip is a full network hop to Neon in production. The auth cost
 * is therefore multiplied across every request the UI makes, so it is worth
 * pinning down rather than letting it drift upward.
 *
 * Budget for a session-authenticated GET:
 *   1. better-auth — session lookup
 *   2. better-auth — user lookup
 *   3. membership JOIN user (membership + a fresh must_change_password)
 *   4. the handler's own query
 */
const SESSION_GET_BUDGET = 4;

describe('auth middleware round-trip budget', () => {
  it(`spends at most ${SESSION_GET_BUDGET} DB round-trips on a session-authenticated GET`, async () => {
    const { db, client, recorder } = await freshDb();
    const app = makeApp(db);
    const { userId, cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    await createOrganization(db, { userId, name: 'O' });

    recorder.start();
    const res = await app.request('/api/contracts', { headers: { cookie } });
    recorder.stop();

    expect(res.status).toBe(200);
    expect(recorder.count(), `queries:\n${recorder.queries().join('\n')}`)
      .toBeLessThanOrEqual(SESSION_GET_BUDGET);
    await client.close();
  });

  it('does not spend a standalone query just to read must_change_password', async () => {
    const { db, client, recorder } = await freshDb();
    const app = makeApp(db);
    const { userId, cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    await createOrganization(db, { userId, name: 'O' });

    recorder.start();
    await app.request('/api/contracts', { headers: { cookie } });
    recorder.stop();

    // better-auth reads the user row once while resolving the session. The
    // middleware may read `user` again only as part of a join that earns its
    // round-trip by fetching membership too — never as a standalone select just
    // to check one column, which is what this used to do.
    const soloUserReads = recorder.queries()
      .filter((q) => /from "user"/.test(q) && !/join/i.test(q));
    expect(soloUserReads, `standalone user reads:\n${soloUserReads.join('\n')}`)
      .toHaveLength(1);
    await client.close();
  });
});
