# Extractor — Bank Statement

## Input
A bank account statement CSV or PDF covering the reconciliation period. Contains individual transactions with date, amount, counterparty name, counterparty account, and description/reference.

## Required output (JSON)
```json
{
  "accountNumber": "string",
  "periodFrom": "YYYY-MM-DD",
  "periodTo": "YYYY-MM-DD",
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "amount_haler": 0,
      "counterparty": "string",
      "counterpartyAccount": "string",
      "reference": "string",
      "description": "string",
      "hash": "string"
    }
  ]
}
```

## Notes
- Convert all amounts to integer haléře (positive = incoming, negative = outgoing).
- The `hash` field should be a stable unique identifier for each transaction (use SHA-256 of date+amount+counterparty+reference, or use the bank's own transaction ID if available). This is used as `externalId` for idempotent import.
- Filter to only include incoming payments (positive amounts) from the tenant's account number when importing rent payments.
- Include the full statement for completeness even if you'll only import a subset.
