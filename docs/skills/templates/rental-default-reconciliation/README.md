# Default Reconciliation Skill Template

Copy this folder to `~/.claude/skills/<your-property>-reconciliation/` (e.g. `reference-reconciliation`), then customize:

1. `_extractors/*.md` — adapt prompts to the PDF/CSV formats you receive
2. `scripts/*.ts` — write deterministic compute functions for your property's quirks (solar credit, FO composition, etc.)
3. `scripts/*.test.ts` — write golden-data regression tests
4. `fixtures/*.json` — store known sample inputs + expected outputs

Set `Property.reconciliationSkill` (via REST or MCP) to the skill's directory name so Claude knows which skill applies.
