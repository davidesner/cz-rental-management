import type { Hono } from 'hono';
import type { Auth } from '../../core/auth/better-auth.js';
import type { DB } from '../../core/db/client.js';

type AppHono = Hono<{
  Variables: {
    auth: Auth;
    db: DB;
  };
}>;

export async function registerUser(app: AppHono, email: string, password: string, name: string) {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie') ?? '';
  const body = await res.json() as { user: { id: string } };
  return { userId: body.user.id, cookie };
}
