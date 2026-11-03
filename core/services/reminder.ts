import { createId } from '@paralleldrive/cuid2';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { contract, property, reminder } from '../db/schema.js';
import { AppError } from '../errors.js';

export interface ReminderInput {
  title: string;
  dueDate: string; // YYYY-MM-DD
  note?: string | null;
  contractId?: string | null;
  propertyId?: string | null;
}

export interface ReminderRow {
  id: string;
  orgId: string;
  title: string;
  dueDate: string;
  note: string | null;
  contractId: string | null;
  propertyId: string | null;
  doneAt: Date | null;
  createdAt: Date;
}

/**
 * Resolves the property a reminder is about (its own, or its contract's) and
 * checks the caller may see it. A reminder tied to nothing is org-wide.
 */
async function resolveProperty(db: DB, orgId: string, input: { contractId?: string | null; propertyId?: string | null }, allowedPropertyIds: string[] | null): Promise<string | null> {
  let propertyId = input.propertyId ?? null;
  if (input.contractId) {
    const [c] = await db.select({ propertyId: contract.propertyId }).from(contract).where(and(eq(contract.id, input.contractId), eq(contract.orgId, orgId)));
    if (!c) throw new AppError('not_found', 'contract not in org');
    if (propertyId && propertyId !== c.propertyId) throw new AppError('validation', 'contract belongs to a different property');
    propertyId = c.propertyId;
  } else if (propertyId) {
    const [p] = await db.select({ id: property.id }).from(property).where(and(eq(property.id, propertyId), eq(property.orgId, orgId)));
    if (!p) throw new AppError('not_found', 'property not in org');
  }
  if (propertyId && allowedPropertyIds !== null && !allowedPropertyIds.includes(propertyId)) {
    throw new AppError('forbidden', 'no access to property');
  }
  return propertyId;
}

function visible(r: ReminderRow, allowedPropertyIds: string[] | null): boolean {
  if (allowedPropertyIds === null || r.propertyId === null) return true;
  return allowedPropertyIds.includes(r.propertyId);
}

export async function createReminder(db: DB, orgId: string, allowedPropertyIds: string[] | null, input: ReminderInput): Promise<ReminderRow> {
  const title = input.title.trim();
  if (title === '') throw new AppError('validation', 'title is required');
  const propertyId = await resolveProperty(db, orgId, input, allowedPropertyIds);
  const [row] = await db.insert(reminder).values({
    id: createId(), orgId, title, dueDate: input.dueDate, note: input.note ?? null,
    contractId: input.contractId ?? null, propertyId,
  }).returning();
  return row! as ReminderRow;
}

/** Open reminders by due date; `includeDone` adds the finished ones after them. */
export async function listReminders(db: DB, orgId: string, allowedPropertyIds: string[] | null, opts: { includeDone?: boolean } = {}): Promise<ReminderRow[]> {
  const where = opts.includeDone ? eq(reminder.orgId, orgId) : and(eq(reminder.orgId, orgId), isNull(reminder.doneAt));
  const rows = await db.select().from(reminder).where(where).orderBy(asc(reminder.dueDate), asc(reminder.createdAt)) as ReminderRow[];
  return rows.filter(r => visible(r, allowedPropertyIds));
}

async function getOwned(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<ReminderRow> {
  const [row] = await db.select().from(reminder).where(and(eq(reminder.id, id), eq(reminder.orgId, orgId))) as ReminderRow[];
  if (!row) throw new AppError('not_found', 'reminder not found');
  if (!visible(row, allowedPropertyIds)) throw new AppError('forbidden', 'no access');
  return row;
}

export async function setReminderDone(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null, done: boolean): Promise<ReminderRow> {
  await getOwned(db, orgId, id, allowedPropertyIds);
  const [row] = await db.update(reminder).set({ doneAt: done ? new Date() : null }).where(eq(reminder.id, id)).returning();
  return row! as ReminderRow;
}

export async function deleteReminder(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<void> {
  await getOwned(db, orgId, id, allowedPropertyIds);
  await db.delete(reminder).where(eq(reminder.id, id));
}
