# Extractor — Electricity Invoice

## Input
An electricity invoice PDF or statement from the utility provider, covering a billing period. May include base charges, energy consumption, distribution fees, taxes, and credits (e.g. solar feed-in).

## Required output (JSON)
```json
{
  "periodFrom": "YYYY-MM-DD",
  "periodTo": "YYYY-MM-DD",
  "totalCost_haler": 0,
  "invoiceNumber": "string",
  "lineItems": [
    { "category": "string", "amount_haler": 0 }
  ]
}
```

## Notes
- Convert all amounts to integer haléře (multiply CZK by 100, round to nearest integer).
- Include all line items (energy, distribution, taxes, credits).
- If there are solar credits or feed-in credits, include them as negative line items.
- The `totalCost_haler` should be the final invoice total (all items summed).
- Extract the invoice number for use as `externalId` in cost statement creation.
