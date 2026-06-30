# @esnerda/cz-rental-management-mcp

MCP (Model Context Protocol) server for the Czech rental-management app. Exposes property, contract, payment, cost-statement, and reconciliation tools over stdio to any MCP-speaking client (Claude Code, Claude Desktop, Cursor, …).

This package is a thin client: it does not host data itself. It talks to a running rental-management REST backend via `RENTAL_API_URL` + a per-user API token.

## Usage

Add to your MCP client config (e.g. `.mcp.json`):

```json
{
  "mcpServers": {
    "rental-management": {
      "command": "npx",
      "args": ["-y", "@esnerda/cz-rental-management-mcp@latest"],
      "env": {
        "RENTAL_API_URL": "http://localhost:3000",
        "RENTAL_API_TOKEN": "<token from /settings/api-tokens>"
      }
    }
  }
}
```

For a hosted backend, swap `RENTAL_API_URL` for its URL.

## Environment

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `RENTAL_API_URL` | no | `http://localhost:3000` | Base URL of the rental-management REST API |
| `RENTAL_API_TOKEN` | yes | — | Bearer token from `/settings/api-tokens` |

## Tools exposed

One file per resource under `dist/tools/`:

- `me`, `organizations`
- `properties`, `tenants`
- `contracts`, `contract_terms`, `contract_utilities`
- `property_tariffs`, `rent_reductions`
- `payments`, `payment_breakdown`
- `cost_statements`, `reconciliations`

Each resource exposes idempotent list/get/create/update/delete tools where applicable.

## Source

Source lives in the [`mcp/`](https://github.com/esnerda/rental_management/tree/main/mcp) directory of the rental-management monorepo.

## License

MIT
