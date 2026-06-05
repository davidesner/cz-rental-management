import type { Hono } from 'hono';

export async function registerUser(app: Hono, email: string, password: string, name: string) {
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
