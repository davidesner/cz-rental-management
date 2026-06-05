# Extractor — SVJ vyúčtování

## Input
A SVJ annual vyúčtování PDF, typically containing total advances paid, actual service costs broken down by category (water, heat, electricity in common areas, fond oprav, etc.), and a calculated difference.

## Required output (JSON)
```json
{
  "periodFrom": "YYYY-MM-DD",
  "periodTo": "YYYY-MM-DD",
  "totalAmount_haler": 0,
  "fondOpravPortion_haler": 0,
  "lineItems": [
    { "category": "string", "amount_haler": 0 }
  ]
}
```

## Notes
- Convert all amounts to integer haléře.
- Locate Fond Oprav specifically (it's the deductible portion not chargeable to tenant).
- Period should match the SVJ accounting year, not the tenant contract period — proration happens in scripts/.
