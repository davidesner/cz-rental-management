# Scripts

This folder holds **all deterministic computation** for the reconciliation workflow. The LLM never does math — it calls these scripts.

## Conventions

- One file per source type (`computeElectricity.ts`, `computeSvj.ts`, `computeBankImport.ts`, …)
- Each function takes parsed-input JSON (from `_extractors/`) and property-specific rules constants, returns the final values for MCP insertion.
- Every function has a `*.test.ts` regression test against a known fixture (see `../fixtures/`).
- The skill runs `vitest run scripts/` (or equivalent) before MCP insertion and aborts on failure.

## Example
See `example-electricity.ts` and `example-electricity.test.ts` for the pattern.
