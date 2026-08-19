# Deploy on Vercel

Tahle apka je monorepo:
- **Web (frontend + API)** → Vercel
- **MCP server** → samostatný npm balíček `@esnerda/cz-rental-management-mcp` spouštěný přes `npx` u uživatele. MCP nikdy nejde na Vercel.

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
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (min 32 chars — app fails to boot otherwise) | Production, Preview |
   | `BETTER_AUTH_URL` | `https://<your-app>.vercel.app` (nebo custom doména) | Production |
   | `BETTER_AUTH_TRUSTED_ORIGINS` | comma-separated list of allowed origins, e.g. `https://<your-app>.vercel.app,https://custom-domain.cz` — required for non-localhost `BETTER_AUTH_URL`, app fails to boot otherwise | Production, Preview |

4. Deploy: `vercel --prod` nebo push to `main`

### 4. Manually provision users

Public signup is disabled — there's no `/register` UI and `/api/auth/sign-up/email` returns disabled in production. Create users from the CLI against the production DB:

```bash
DATABASE_URL="<pooled-url>" BETTER_AUTH_SECRET="<prod-secret>" BETTER_AUTH_URL="https://<your-app>.vercel.app" \
  pnpm user:create user@example.com 'min-10-char-password' "Full Name"
```

The script writes the user, auto-creates their personal organization, **and sets `mustChangePassword: true`**. On first login the user is redirected to `/change-password` and the API blocks every other request (`403 must_change_password`) until they pick a new password. The flag is cleared automatically by a Better Auth `account.update.after` hook the moment `/api/auth/change-password` succeeds.

Hand the user their temporary password through a secure channel (Signal, password manager invite, etc.) — they'll only use it once. To re-enable public signup later, edit `core/auth/better-auth.ts` (`allowSignup` const).

## Co se hostuje kde

| Komponenta | Kde | Build script |
|---|---|---|
| Frontend (Vite SPA) | Vercel CDN | `vite build` → `dist/` |
| Backend (Hono) | Vercel Functions | `api/index.ts` adapter |
| DB | Neon | — |
| MCP server | Lokálně u uživatele | `npx -y @esnerda/cz-rental-management-mcp@latest` |

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
4. Deploy (production build neudělá migrations automaticky — to je záměr, předejde nečekaným změnám schémat při rebuild)

**Production zůstává manual.** Preview deployments se ale migrují samy — viz níž.

## Preview deployments (Neon branch + auto-migrations)

Preview deployment potřebuje DB se **aktuálním** schématem, jinak PR nejde vyzkoušet.
Zároveň nesmí sahat na production data.

Řešení má dvě poloviny:

**1. Vlastní DB branch per preview — Neon Vercel integration**

Nainstaluj [Neon Vercel integration](https://neon.com/docs/guides/vercel-native-integration)
do Vercel projektu. Pro každý preview deployment vyrobí copy-on-write branch
`preview/<git-branch>` a nastaví do toho deploymentu:

| Var | Co to je |
|---|---|
| `DATABASE_URL` | pooled (PgBouncer) connection na tu branch |
| `DATABASE_URL_UNPOOLED` | direct connection na tu branch — potřebné pro migrations |

Protože branch je copy-on-write kopie parenta, **preview má i uživatele z production** —
nemusíš nic seedovat (signup je vypnutý, takže by ani nešlo).

⚠️ **Než integraci nainstaluješ**, smaž (nebo přejmenuj) ve Vercel Project Settings →
Environment Variables ruční `DATABASE_URL` a případné `PGHOST` / `PGUSER` / `PGDATABASE` /
`PGPASSWORD`. Integrace si tyhle názvy nastavuje sama a při kolizi spadne na
`Failed to set environment variables`. Od té chvíle `DATABASE_URL` spravuje integrace —
i pro production (míří na default branch zvoleného Neon projektu).

`BETTER_AUTH_*` proměnné se toho netýkají, ty si nastavuješ dál sám.

Postup instalace (Neon-managed varianta — tu potřebuješ, když už Neon projekt máš;
marketplace varianta zakládá nový Neon účet):

1. [console.neon.tech](https://console.neon.tech) → **Integrations** → u Vercelu **Add**
2. **Install from Vercel Marketplace** → **Install**
3. V modalu vyber **Link Existing Neon Account** → Continue
4. Vyber Vercel account + projekty, které mají integraci vidět
   (jeden Neon projekt = jeden Vercel projekt)
5. Vyber Vercel projekt, pak Neon projekt, database a role
6. Zapni **Automatically delete obsolete Neon branches** — jinak ti branche zůstávají
   po každém zavřeném PR
7. Connect → Done

**2. Migrations při buildu — `pnpm migrate:preview`**

`vercel-build` je `tsc --noEmit && pnpm migrate:preview && vite build`.
`scripts/migrate-preview.ts` se spustí jen když platí **obojí**:

- `VERCEL_ENV === 'preview'` — nastavuje Vercel runtime
- `PREVIEW_DB_MIGRATIONS === '1'` — nastav ručně, **jen ve scope Preview**

Jinak no-op (vypíše `skipped — ...` a skončí s exit 0). Ta druhá podmínka je bezpečnostní
pojistka: bez Neon integrace by preview zdědil production `DATABASE_URL` a migrations by
šly na produkci. Dokud `PREVIEW_DB_MIGRATIONS` nenastavíš, nemůže se to stát.

Migrations jdou přes `DATABASE_URL_UNPOOLED` (fallback: `DATABASE_URL` s odstraněným
`-pooler` z hostname). Drizzle migrator dělá DDL v transakci, což PgBouncer transaction
mode odmítne — proto direct connection, ne pooled.

Setup checklist:

```
Vercel → Project Settings → Environment Variables
  PREVIEW_DB_MIGRATIONS = 1          scope: Preview only
  DATABASE_URL                       scope: Production only  (odstranit z Preview!)
  BETTER_AUTH_SECRET                 scope: Production + Preview
  BETTER_AUTH_TRUSTED_ORIGINS        scope: Production + Preview
```

`BETTER_AUTH_URL` v Preview nenastavuj — kód spadne zpátky na `VERCEL_URL`
(`core/auth/better-auth.ts`), což je pro per-deploy domény to jediné, co funguje.

## Custom doména

Vercel Project Settings → Domains → Add. Po nastavení změň `BETTER_AUTH_URL` env var na custom doménu a redeploy (better-auth potřebuje match domain pro cookies).

## MCP server (samostatně)

MCP server je publikován jako samostatný npm balíček `@esnerda/cz-rental-management-mcp` a spouští se přes `npx` u uživatele (nepotřebuje clone repa):

```json
// .mcp.json
{
  "mcpServers": {
    "rental-management": {
      "command": "npx",
      "args": ["-y", "@esnerda/cz-rental-management-mcp@latest"],
      "env": {
        "RENTAL_API_URL": "https://<your-app>.vercel.app",
        "RENTAL_API_TOKEN": "<token z UI /settings/api-tokens>"
      }
    }
  }
}
```

Pro lokální vývoj backendu je `pnpm mcp` (z root) pořád k dispozici — pouští stejný server z monorepa přes `tsx`.

Publish workflow: `cd mcp && pnpm build && npm publish --access public`. Source/dist je v `mcp/`, dist je gitignorovaný.

## Troubleshooting

- **`prepared statement "xxx" does not exist`** — `prepare: false` v serverless modu chybí, nebo používáš PgBouncer ale `postgres-js` nemá `prepare: false`. Check `core/db/client.ts`.
- **`Connection terminated`** — Neon project sleeps po inaktivitě (free tier). První request po sleep trvá 2-3s.
- **Cookie not set / login redirect loop** — `BETTER_AUTH_URL` nesedí s aktuální doménou. Cookie domain musí matchnout.
- **Migrations fail s `cannot execute outside of a transaction block`** — používáš pooled URL místo direct. drizzle-kit potřebuje direct.
- **App refuses to boot with `BETTER_AUTH_SECRET must be set...`** — env var missing or shorter than 32 chars. Generate with `openssl rand -base64 32`.
- **App refuses to boot with `BETTER_AUTH_TRUSTED_ORIGINS must be set...`** — set the env var to your prod origin(s), comma-separated.
- **CORS / origin rejected when calling auth API** — origin not in `BETTER_AUTH_TRUSTED_ORIGINS`. Add it and redeploy.
