# E2E smoke tests

End-to-end smoke tests for the rental-management UI using Playwright.

## Prerequisites

- Postgres running locally: `docker compose up -d pg`
- Migrations applied: `pnpm db:migrate`
- Playwright browsers installed: `pnpm exec playwright install chromium`

## Run

```bash
pnpm test:e2e
```

Playwright automatically starts `dev:api` (port 3000) and `dev:web` (port 5173) and shuts them down at the end.
The API readiness probe hits `GET /api/health` which returns `{ ok: true }` — no auth required.

## Tests

- `auth.spec.ts` — register (lands on dashboard), sign-out, sign back in
- `properties.spec.ts` — register fresh user, create org via API, navigate to Properties, create a property

## Why so few?

Smoke tests only. Comprehensive backend coverage is in `tests/`. Per-property domain logic lives in skills, not in this app.
