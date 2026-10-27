// Lists and revokes AI agents connected to the remote MCP endpoint.
//
// Every connection (Claude, ChatGPT, Claude Code, ...) is one OAuth client
// registered through dynamic client registration. Revoking disables the client
// and deletes its tokens and consents: the agent's still-valid access token is
// refused on its next call (server/mcp/auth.ts checks the client on every
// request), and its refresh token is gone. The user can connect again, which
// registers a new client.
//
// Usage (against the target DB, DATABASE_URL in env or .env):
//   pnpm mcp:clients list
//   pnpm mcp:clients revoke <clientId>

import 'dotenv/config';
import { desc, eq, max } from 'drizzle-orm';
import { agentDisplayName } from '../core/auth/mcp-oauth.js';
import { createDb } from '../core/db/client.js';
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken, user } from '../core/db/schema.js';

async function main() {
  const [command, clientId] = process.argv.slice(2);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL must be set');
    process.exit(1);
  }
  if (command !== 'list' && !(command === 'revoke' && clientId)) {
    console.error('Usage: pnpm mcp:clients list | pnpm mcp:clients revoke <clientId>');
    process.exit(1);
  }

  const { db, close } = createDb(databaseUrl);
  try {
    if (command === 'list') {
      const clients = await db
        .select({
          clientId: oauthClient.clientId,
          name: oauthClient.name,
          redirectUris: oauthClient.redirectUris,
          disabled: oauthClient.disabled,
          createdAt: oauthClient.createdAt,
        })
        .from(oauthClient)
        .orderBy(desc(oauthClient.createdAt));
      // Who uses each client and when they last got a token (refresh tokens are
      // stored; JWT access tokens are not).
      const usage = await db
        .select({ clientId: oauthRefreshToken.clientId, email: user.email, lastToken: max(oauthRefreshToken.createdAt) })
        .from(oauthRefreshToken)
        .innerJoin(user, eq(user.id, oauthRefreshToken.userId))
        .groupBy(oauthRefreshToken.clientId, user.email);
      for (const c of clients) {
        const users = usage.filter((u) => u.clientId === c.clientId)
          .map((u) => `${u.email} (last token ${u.lastToken?.toISOString() ?? '-'})`);
        console.log([
          c.clientId,
          agentDisplayName(c),
          c.disabled ? 'DISABLED' : 'active',
          `registered ${c.createdAt?.toISOString() ?? '-'}`,
          users.length ? users.join(', ') : 'no users',
        ].join('  |  '));
      }
      if (clients.length === 0) console.log('no MCP clients registered');
      return;
    }

    const id = clientId as string;
    const revoked = await db.transaction(async (tx) => {
      const rows = await tx.update(oauthClient).set({ disabled: true, updatedAt: new Date() })
        .where(eq(oauthClient.clientId, id)).returning({ clientId: oauthClient.clientId });
      if (rows.length === 0) return false;
      await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.clientId, id));
      await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, id));
      await tx.delete(oauthConsent).where(eq(oauthConsent.clientId, id));
      return true;
    });
    if (!revoked) {
      console.error(`no MCP client ${id}`);
      process.exitCode = 1;
      return;
    }
    console.log(`revoked ${id}: client disabled, tokens and consents deleted`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
