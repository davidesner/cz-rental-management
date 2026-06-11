// Manual user provisioning.
//
// Public signup is disabled (see core/auth/better-auth.ts -> disableSignUp).
// Run this script to create a user from the CLI; it uses Better Auth's internal
// API so the password hash, account row, and the `user.create.after` hook
// (auto-org creation) all behave exactly as they would for a real signup.
//
// Usage:
//   BETTER_AUTH_SECRET=... BETTER_AUTH_URL=https://... DATABASE_URL=postgres://... \
//     pnpm tsx scripts/create-user.ts <email> <password> "<full name>"
//
// In production, run against the prod DB by exporting the prod env vars in your
// shell first. The script writes one user + one org and prints the user id.

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from '../core/db/client.js';
import { createAuth } from '../core/auth/better-auth.js';
import { user } from '../core/db/schema.js';

async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password || !name) {
    console.error('Usage: pnpm tsx scripts/create-user.ts <email> <password> "<full name>"');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL must be set');
    process.exit(1);
  }

  // Force-enable signup for this one-shot CLI invocation. The better-auth config
  // gates signup on VITEST; we use the same escape hatch here. Production runs of
  // this script set VITEST=true only for the lifetime of this Node process — it
  // never reaches the deployed server.
  process.env.VITEST = 'true';

  const { db, close } = createDb(databaseUrl);
  const auth = createAuth(db);
  try {
    const result = await auth.api.signUpEmail({ body: { email, password, name } });
    // Force password change on first login. The flag is cleared automatically by
    // the account.update.after hook in core/auth/better-auth.ts when Better Auth's
    // change-password endpoint fires.
    await db.update(user).set({ mustChangePassword: true }).where(eq(user.id, result.user.id));
    console.log(JSON.stringify({
      userId: result.user.id,
      email: result.user.email,
      mustChangePassword: true,
      note: 'User will be forced to change password on first login.',
    }, null, 2));
  } catch (err) {
    console.error('user creation failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

main();
