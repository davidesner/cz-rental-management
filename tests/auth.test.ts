import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('email + password sign up / sign in', () => {
  it('registers and signs in a user', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { userId, cookie } = await registerUser(app, 'a@b.cz', 'password123', 'Alice');
    expect(userId).toBeTruthy();
    expect(cookie).toContain('better-auth');

    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.cz', password: 'password123' }),
    });
    expect(signIn.status).toBe(200);
    await client.close();
  });
});
