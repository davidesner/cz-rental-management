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
3. **Zkontroluj vygenerované SQL** — `drizzle-kit generate` umí vyrobit destruktivní
   krok (`DROP COLUMN`, změna typu). Tohle je to jediné místo, kde to zachytíš.
4. Merge do `main` → production build spustí migrace sám (`PRODUCTION_DB_MIGRATIONS=1`),
   viz níž. Deployment se promotuje teprve po úspěšné migraci.

Ruční varianta (když je flag vypnutý, nebo potřebuješ migrovat mimo deploy):

```bash
DATABASE_URL="<DIRECT-url>" pnpm db:migrate
```

## Preview deployments (Neon branch + auto-migrations)

Preview deployment potřebuje DB s **aktuálním** schématem, jinak PR nejde vyzkoušet.
Zároveň nesmí sahat na production data. Obojí je vyřešené a **funkční** — tady je
popsaný reálný stav, ne obecný postup z dokumentace.

### 1. Vlastní DB branch per preview

Projekt používá **Vercel-Managed** Neon integraci (Neon Postgres z Vercel Marketplace,
resource `neon-citrine-bell`) — ne Neon-Managed variantu. Billing jde přes Vercel.

Nastavení **není** v "Connect a Project" modalu (tam už je projekt jen jako `Connected`).
Je tady:

> Vercel → **Storage** → `neon-citrine-bell` → u řádku projektu **Configure**
> → dialog *Configure cz-rental-management*

Správné hodnoty (a proč):

| Pole | Hodnota | Proč |
|---|---|---|
| Environments | `Production, Preview` | odkud se injectují DB proměnné |
| Require Active Resource Before Deploy | **Required** | Vercel čeká, než je branch ready; bez toho může build startovat dřív |
| Create Database Branch For Deployment | **Preview** ✓, Production ✗ | zapnutá Production by pustila produkci na throwaway branch |
| Custom Environment Variable Prefix | **prázdné** | prefix přejmenuje `DATABASE_URL` → `STORAGE_DATABASE_URL` a rozbije app i migrations |

Pro každý preview deployment pak Neon vyrobí copy-on-write branch `preview/<git-branch>`
a přes webhook do toho jednoho deploymentu injectne:

| Var | Co to je |
|---|---|
| `DATABASE_URL` | pooled (PgBouncer) connection na tu branch |
| `DATABASE_URL_UNPOOLED` | direct connection na tu branch — potřebné pro migrations |

⚠️ Tyhle per-deployment hodnoty **neuvidíš** v Project Settings → Environment Variables
ani v `vercel env ls`. Jsou injectnuté jen do daného deploymentu. To, co v `env ls` vidíš
jako `DATABASE_URL` ve scope Preview, je fallback pro případ, že by branching byl vypnutý.

Protože branch je copy-on-write kopie parenta, **preview má i uživatele z production** —
nemusíš nic seedovat (signup je vypnutý, takže by to ani nešlo). Zároveň to znamená, že
preview URL zobrazuje živá data.

### 2. Migrations při buildu — `pnpm migrate:deploy`

`vercel-build` je `tsc --noEmit && pnpm migrate:deploy && vite build`.
`scripts/migrate-deploy.ts` migruje jen když platí **obojí** pro dané prostředí:

| `VERCEL_ENV` | opt-in flag | scope env var |
|---|---|---|
| `preview` | `PREVIEW_DB_MIGRATIONS=1` | Preview |
| `production` | `PRODUCTION_DB_MIGRATIONS=1` | Production |

Jinak no-op (`skipped — ...`, exit 0) — a ve zprávě je vidět reálná hodnota, takže
překlep nebo špatný scope poznáš na první pohled.

**Proč v buildu, a ne jako samostatný CI job:** Vercel promotuje deployment teprve po
úspěšném buildu. Migrace tady tedy garantuje pořadí — schéma je aktuální dřív, než nový
kód obslouží první request, a když migrace spadne, spadne build a běží dál ta předchozí
verze. Job běžící paralelně s deployem tuhle garanci nemá.

Opt-in flagy jsou kill switch: odnastavíš a deploye přestanou na schéma sahat, bez změny
kódu. U preview navíc chrání proti tomu, že by bez branchingu preview zdědil production
`DATABASE_URL` a migrace šly na produkci.

Migrations jdou přes `DATABASE_URL_UNPOOLED` (fallback: `DATABASE_URL` s odstraněným
`-pooler` z hostname). Drizzle migrator dělá DDL v transakci, což PgBouncer transaction
mode odmítne — proto direct connection, ne pooled.

⚠️ **Migrace jsou forward-only.** Rollback deploymentu **neudělá** rollback schématu —
skončíš s novým schématem a starým kódem. Když potřebuješ schéma zpátky, je to manuální
operace proti direct connection (nebo Neon PITR / restore z branche).

⚠️ **Env var nastavuj bez trailing newline.** `echo 1 | vercel env add ...` uloží
doslova `"1\n"`. Script si hodnoty trimuje, takže to projde, ale jiné nástroje ne —
použij `printf '1' | vercel env add PRODUCTION_DB_MIGRATIONS production` nebo dashboard.

### Setup checklist

```
Vercel → Storage → neon-citrine-bell → Configure
  Create Database Branch For Deployment = Preview   (Production vypnuté)
  Require Active Resource Before Deploy  = Required
  Custom Environment Variable Prefix     = prázdné

Vercel → Project Settings → Environment Variables
  PREVIEW_DB_MIGRATIONS    = 1       scope: Preview only
  PRODUCTION_DB_MIGRATIONS = 1       scope: Production only
  BETTER_AUTH_SECRET                 scope: Production + Preview
  BETTER_AUTH_TRUSTED_ORIGINS        scope: Production + Preview
  DATABASE_URL / DATABASE_URL_UNPOOLED / PG* / POSTGRES_*   spravuje integrace, needituj
```

`BETTER_AUTH_URL` v Preview nenastavuj — kód spadne zpátky na `VERCEL_URL`
(`core/auth/better-auth.ts`), což je pro per-deploy domény to jediné, co funguje.

### Jak zkontrolovat, že to jede

V build logu preview deploymentu:

```
[migrate-deploy] applying migrations to preview at postgresql://<redacted>@[REDACTED]/neondb?...
[migrate-deploy] preview schema is up to date
```

Hostname je `[REDACTED]` — to škrtá Vercel (matchuje sensitive env var), ne náš kód.
Z logu se tedy **nedá** poznat, jestli šlo o branch nebo produkci. Ověř to v Neonu:
musí existovat branch `preview/<git-branch>`.

Když log říká `skipped — ... is ...`, vypíše i reálnou hodnotu — podle toho poznáš
překlep nebo špatný scope.

### Cleanup preview branchí

⚠️ **Smazání git branche Neon branch neuklidí.** U Vercel-Managed integrace Neon maže
preview branch teprve když zmizí *poslední Vercel deployment* té git branche — a Vercel
drží pre-production deploymenty **180 dní** (default od 10/2025). Zavřený PR na to nemá
vliv. (Branch cleanup podle git branche má jen Neon-Managed varianta, kterou nepoužíváme.)

Snížit retention v **Settings → Security → Deployment Retention Policy** moc nepomůže:
Vercel si drží minimální počet posledních deploymentů bez ohledu na retention, takže u
projektu s málo deploymenty se automaticky nemusí uklidit vůbec.

Proto je tu `.github/workflows/neon-cleanup.yml` — na `pull_request: [closed]` smaže
`preview/<head_ref>` přes [`neondatabase/delete-branch-action`](https://github.com/neondatabase/delete-branch-action).
Vyžaduje:

| Co | Kde |
|---|---|
| `NEON_API_KEY` — repository **secret** | Neon Console → Account Settings → API Keys |
| `NEON_PROJECT_ID` — repository **variable** | Neon Console → Project Settings (nebo env var ve Vercelu) |

Dokud `NEON_API_KEY` nenastavíš, workflow se přeskočí (nespadne). Alternativně jde
deployment smazat ručně — `vercel remove <deployment>` smaže i Neon branch okamžitě.

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
