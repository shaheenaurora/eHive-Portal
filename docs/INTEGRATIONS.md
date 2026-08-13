# eHive Integration API (v1)

A **read-only**, versioned REST API for syncing eHive's financial and membership
data into an external ERP or accounting system. It is server-to-server (API key,
not the portal's session cookies) and returns JSON with the platform's stable
reference codes as external IDs.

> **Disabled by default.** Every endpoint returns `503` until at least one API
> key is configured, so nothing is exposed until you turn it on.

## Enabling it

Set `INTEGRATION_API_KEYS` to one or more secrets (comma-separated). Generate
high-entropy keys (e.g. `openssl rand -hex 32`). List multiple during a rotation
so the old and new keys both work through the cutover.

```
INTEGRATION_API_KEYS=6f1c…a9,ab12…7d
```

## Authentication

Send the key on every request as either:

- `Authorization: Bearer <key>`, or
- `X-API-Key: <key>`

Missing/invalid key → `401`. Keys are compared in constant time and never logged.
Requests are rate-limited per IP.

Base URL: `https://<your-domain>/api/integrations/v1`

## Conventions

- **Money** is in the major unit (AED) with an explicit `currency`.
- **IDs** are stable reference codes: payments `EH-INV-…`, members `EH-M-…`,
  users/customers `EH-U-…`, chapters `EH-CH-…`.
- **Timestamps** are ISO-8601 (UTC).
- **Pagination** is keyset by ascending id:
  - `?limit=` — page size (default `100`, max `500`).
  - `?cursor=<id>` — pass the previous response's `nextCursor` to get the next
    page. `nextCursor` is `null` on the last page.
- **Incremental sync**: `?updatedSince=<ISO-8601>` returns only records changed
  at/after that instant. Payments and members track a real `updatedAt` (bumped on
  status changes and refunds); expenses are append-oriented and filter on
  `createdAt`. Store the max `updatedAt` you observe and pass it as
  `updatedSince` next run.

List responses look like:

```json
{ "object": "list", "data": [ … ], "nextCursor": 340, "count": 100 }
```

## Endpoints

### `GET /payments`

Membership payments / receipts, including refunds.

```json
{
  "ref": "EH-INV-00019",
  "object": "payment",
  "status": "partially_refunded",
  "purpose": "membership",
  "tier": "ascent",
  "currency": "AED",
  "amount": 5999,
  "refundedAmount": 1000,
  "netAmount": 4999,
  "provider": "stripe",
  "providerRef": "cs_123",
  "customer": {
    "ref": "EH-U-00007",
    "name": "Sam Trader",
    "email": "sam@example.com"
  },
  "createdAt": "2026-05-31T00:00:00.000Z",
  "paidAt": "2026-06-01T00:00:00.000Z",
  "refundedAt": "2026-06-10T00:00:00.000Z",
  "updatedAt": "2026-06-10T00:00:00.000Z"
}
```

`status` is one of `pending`, `paid`, `failed`, `refunded`, `partially_refunded`.

### `GET /expenses`

Chapter spend lines (the `spend` budget records).

```json
{
  "id": 4,
  "object": "expense",
  "chapter": { "ref": "EH-CH-0003" },
  "label": "Venue hire",
  "category": "venue",
  "currency": "AED",
  "amount": 1500,
  "status": "approved",
  "note": null,
  "createdAt": "2026-06-01T00:00:00.000Z"
}
```

`status` is one of `proposed`, `approved`, `spent`, `rejected` (spend at/above the
approval threshold starts as `proposed`).

### `GET /members`

Member / customer records, for correlating payments to a customer.

```json
{
  "ref": "EH-M-00019",
  "object": "member",
  "customerRef": "EH-U-00007",
  "name": "Sam Trader",
  "email": "sam@example.com",
  "tier": "ascent",
  "status": "active",
  "lifecycleState": "active",
  "homeChapter": { "ref": "EH-CH-0003" },
  "joinedAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-06-01T00:00:00.000Z"
}
```

## Example: incremental sync

```bash
# First full pull
curl -s -H "Authorization: Bearer $KEY" \
  "https://your-domain/api/integrations/v1/payments?limit=500"

# Next page
curl -s -H "Authorization: Bearer $KEY" \
  "https://your-domain/api/integrations/v1/payments?limit=500&cursor=500"

# Later: only what changed since the last sync
curl -s -H "Authorization: Bearer $KEY" \
  "https://your-domain/api/integrations/v1/payments?updatedSince=2026-06-10T00:00:00Z"
```

## Notes

- The API is intentionally read-only. eHive is not the system of record for
  statutory books; tax treatment (VAT etc.), invoice/credit-note documents and
  ledgers live in your accounting system, which consumes these records.
- New resources/fields are added in a backwards-compatible way under `v1`;
  breaking changes would ship as `v2`.
