# Fixtures

One JSON file per source-period (`2024-svj.json`, `2024-electricity.json`, `2024-bank.json`, …).

Schema:
```json
{
  "input": { "...": "raw extracted JSON" },
  "rules": { "...": "per-property constants" },
  "expected": {
    "totalAmount_haler": 0,
    "adjustmentAmount_haler": 0,
    "adjustmentNote": "..."
  }
}
```

Regression test: load fixture, run script with `input` + `rules`, assert output matches `expected`.
