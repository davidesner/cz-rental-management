# Deploy on Vercel

Tahle apka je monorepo:
- **Web (frontend + API)** → Vercel
- **MCP server** → samostatný balíček (`pnpm mcp` lokálně, eventuálně `npx @esnerda/rental-management-mcp`). MCP nikdy nejde na Vercel — runs u uživatele.

## First deploy

### 1. Managed Postgres — Neon

1. Sign up na [neon.tech](https://neon.tech), vytvoř nový project (regionálně blízko, např. `eu-central-1`)
2. V Dashboard → **Connection string** vyber **Pooled connection** (PgBouncer transaction mode)
3. URL bude vypadat:
   `postgres://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`
4. Ulož si i **Direct connection** (bez `-pooler`) — potřebné pro migrations (`drizzle-kit` neumí PgBouncer transaction mode)

### 2. Run migrations against Neon

Z lokálu (jednorázově při schema změnách):

```bash
DATABASE_URL="<DIRECT-connection-string-bez-pooler>" pnpm db:migrate
```

Pozn.: drizzle-kit potřebuje **direct** connection (ne pooled) — PgBouncer transaction mode neumí session-level příkazy migrations.

### 3. Vercel project

1. `vercel link` nebo `vercel.com → Import Git Repository`
2. Framework preset: **Vite** (auto-detected díky `vercel.json#framework`)
3. Set env vars (Project Settings → Environment Variables):

   | Key | Value | Where |
   |---|---|---|
   | `DATABASE_URL` | `<POOLED-connection-string>` (s `-pooler`) | Production, Preview |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | Production, Preview |
   | `BETTER_AUTH_URL` | `https://<your-app>.vercel.app` (nebo custom doména) | Production |

4. Deploy: `vercel --prod` nebo push to `main`

## Co se hostuje kde

| Komponenta | Kde | Build script |
|---|---|---|
| Frontend (Vite SPA) | Vercel CDN | `vite build` → `dist/` |
| Backend (Hono) | Vercel Functions | `api/index.ts` adapter |
| DB | Neon | — |
| MCP server | Lokálně u uživatele | `pnpm mcp` (později `npx`) |

## Local dev vs prod

| | Local | Prod |
|---|---|---|
| API entry | `server/node.ts` (long-running) | `api/index.ts` (Vercel function) |
| DB pool | `max: 10`, normal prepared | `max: 1`, `prepare: false` (PgBouncer compat) |
| DB | Local Docker `rental-pg` | Neon pooled |
| Cookies | `secure: false`, HTTP | `secure: true`, HTTPS auto |

Auto-switch je v `core/db/client.ts` přes `process.env.VERCEL` (Vercel runtime to nastaví).

## Migrations workflow

Po každé schema změně:

1. `pnpm db:generate` (vyrobí SQL diff v `drizzle/`)
2. Commit + push (nový migrations file půjde do gitu)
3. Před deployem: `DATABASE_URL="<direct-url>" pnpm db:migrate` proti production DB
4. Deploy (Vercel build neudělá migrations automaticky — to je záměr, předejde nečekaným změnám schémat při rebuild)

Pokud někdy chceš auto-migrations při deployu, můžeš přidat krok do `vercel-build` script. Ale doporučuju manual control.

## Custom doména

Vercel Project Settings → Domains → Add. Po nastavení změň `BETTER_AUTH_URL` env var na custom doménu a redeploy (better-auth potřebuje match domain pro cookies).

## MCP server (samostatně)

`mcp/` má vlastní deployment story — runs u uživatele:

```json
// ~/.claude/mcp.json
{
  "mcpServers": {
    "rental-management": {
      "command": "pnpm",
      "args": ["mcp"],
      "cwd": "/path/to/rental-management",
      "env": {
        "RENTAL_API_URL": "https://<your-app>.vercel.app",
        "RENTAL_API_TOKEN": "<token z UI /settings/api-tokens>"
      }
    }
  }
}
```

Eventuálně publish jako npm balíček — viz `claude-plugin/CHANGELOG.md` roadmap.

## Troubleshooting

- **`prepared statement "xxx" does not exist`** — `prepare: false` v serverless modu chybí, nebo používáš PgBouncer ale `postgres-js` nemá `prepare: false`. Check `core/db/client.ts`.
- **`Connection terminated`** — Neon project sleeps po inaktivitě (free tier). První request po sleep trvá 2-3s.
- **Cookie not set / login redirect loop** — `BETTER_AUTH_URL` nesedí s aktuální doménou. Cookie domain musí matchnout.
- **Migrations fail s `cannot execute outside of a transaction block`** — používáš pooled URL místo direct. drizzle-kit potřebuje direct.
