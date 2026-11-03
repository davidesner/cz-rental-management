import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { createReminder, deleteReminder, listReminders, setReminderDone } from '../../core/services/reminder.js';
import type { AppEnv } from '../app.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateReminder = z.object({
  title: z.string().min(1).max(200),
  dueDate: DateStr,
  note: z.string().max(2000).nullable().optional(),
  contractId: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
});

const PatchReminder = z.object({ done: z.boolean() });

export function reminderRoutes() {
  const r = new Hono<AppEnv>();

  r.get('/reminders', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    const includeDone = c.req.query('includeDone') === '1' || c.req.query('includeDone') === 'true';
    return c.json({ reminders: await listReminders(db, ctx.orgId, ctx.allowedPropertyIds, { includeDone }) });
  });

  r.post('/reminders', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = CreateReminder.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ reminder: await createReminder(db, ctx.orgId, ctx.allowedPropertyIds, body) }, 201);
  });

  r.patch('/reminders/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = PatchReminder.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ reminder: await setReminderDone(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body.done) });
  });

  r.delete('/reminders/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    await deleteReminder(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds);
    return c.body(null, 204);
  });

  return r;
}
