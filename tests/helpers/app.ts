import type { DB } from './db.js';
import { buildApp } from '../../server/app.js';

export function makeApp(db: DB) {
  return buildApp({ db });
}
