import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';
import { user } from '../core/db/schema.js';

// End-to-end of the manual-provisioning flow:
// 1. Admin "creates" a user (via CLI in real life — we simulate by registering
//    and then flipping the flag, which is what scripts/create-user.ts does)
// 2. User logs in but is blocked from every route except /me + /api/auth/*
// 3. User hits /api/auth/change-password — flag clears via the after-hook
// 4. User can now access regular routes

describe('mustChangePassword gate', () => {
  it('blocks API access until the user changes their password', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { userId, cookie } = await registerUser(app, 'forced@b.cz', 'temp-password-1', 'Forced');

    // Admin sets the flag (the CLI script does this)
    await db.update(user).set({ mustChangePassword: true }).where(eq(user.id, userId));

    // /me must remain reachable so the frontend can detect the state
    const meRes = await app.request('/api/me', { headers: { cookie } });
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json() as { user: { mustChangePassword: boolean } };
    expect(meBody.user.mustChangePassword).toBe(true);

    // Everything else is blocked
    const propRes = await app.request('/api/properties', { headers: { cookie } });
    expect(propRes.status).toBe(403);
    const propErr = await propRes.json() as { error: { kind: string } };
    expect(propErr.error.kind).toBe('must_change_password');

    // Change-password call clears the flag via the after-hook
    const changeRes = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        currentPassword: 'temp-password-1',
        newPassword: 'new-strong-password-1',
      }),
    });
    expect(changeRes.status).toBe(200);

    // Flag is cleared in the DB
    const [row] = await db.select({ flag: user.mustChangePassword }).from(user).where(eq(user.id, userId));
    expect(row?.flag).toBe(false);

    // /me confirms the new state (re-fetch with the same session cookie)
    const meRes2 = await app.request('/api/me', { headers: { cookie } });
    const meBody2 = await meRes2.json() as { user: { mustChangePassword: boolean } };
    expect(meBody2.user.mustChangePassword).toBe(false);

    // Regular routes are now reachable
    const propRes2 = await app.request('/api/properties', { headers: { cookie } });
    expect(propRes2.status).toBe(200);

    await client.close();
  });
});
