import { createId } from '@paralleldrive/cuid2';
import type { DB } from '../db/client.js';
import { property } from '../db/schema.js';

export async function createPropertyStub(db: DB, orgId: string, name: string) {
  const id = createId();
  await db.insert(property).values({ id, orgId, name });
  return { id, orgId, name };
}
