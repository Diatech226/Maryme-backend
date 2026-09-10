# MARYME BACKEND — DOMAIN FREEZE REPORT

## Frozen invariants

```text
Guest.coupons = nombre de personnes
Coupon.number = numéro individuel d’accès
Guest.tableNumber = table
TableSeatAssignment.seatNumber = siège physique
```

**DO NOT BREAK WITHOUT EXPLICIT PRODUCT MIGRATION**

The modern `Guest.coupons` range is `1..10`. A modern guest owns exactly that
many real, unique coupons. API `couponNumbers` values are sorted in ascending
order. Coupon numbers are access identifiers and are never physical seats.

```text
Wedding card:
dynamic Guest value = tableNumber only

Coupon card:
dynamic value = Coupon.number only

QR:
separate opaque access token
```

## Operational contracts

- A new couple transaction creates the Couple, User, CouponPool and the missing
  standard WeddingTables `1..40`, each with capacity `10`.
- Seating initialization is an idempotent repair operation. It only adds missing
  standard tables. It does not delete tables, move guests, or infer seat rows.
- `TableSeatAssignment` is the source of truth for physical seating. The legacy
  guest table and seat fields remain API compatibility mirrors only.
- Generic Guest create and patch payloads reject `tableId`, `tableNumber`, and
  `assignedSeats`; modern placement uses Seating endpoints.
- No legacy backfill is permitted. In particular, legacy guest mirrors are never
  transformed automatically into `TableSeatAssignment` rows.
- Once any coupon in an allocation is `USED`, the complete allocation is frozen:
  an unchanged desired count is a no-op and a changed count is rejected.
- Guest deletion transactionally removes seat assignments, releases only
  `ASSIGNED` coupons, preserves `USED` coupons and check-in history, revokes active
  invitations, and soft-deletes the guest.
- Coupon reconcile may fix shortages and excess `ASSIGNED` coupons. It never
  changes `USED` coupons, Seating, Invitations, QR tokens, or check-ins.

## Legacy occurrence audit

- `Guest.tableNumber` and `Guest.assignedSeats` remain schema fields and response
  mirrors for frontend compatibility, imports, check-in display, and seating
  responses. Their presence is intentional and is not a second seating source.
- `couponNumbers` is the API projection of real `Coupon.number` rows and is used
  by guest/check-in responses. It is not derived from seats.
- `WeddingTable` remains the existing table model and route contract.
- No `M-01` or `F-01` contract identifiers remain in tracked files.

## Freeze result

| Contrat           | Résultat |
| ----------------- | -------- |
| Coupon allocation | PASS     |
| USED immutability | PASS     |
| 40×10 tables      | PASS     |
| Seating           | PASS     |
| Guest delete      | PASS     |
| QR isolation      | PASS     |
| No backfill       | PASS     |
| Reconcile         | PASS     |
| Unit tests        | PASS     |
| E2E               | FAIL     |
| Build             | PASS     |

`BACKEND DOMAIN CONTRACT FROZEN = NO`

The E2E status reflects the required validation run in the delivery environment:
it could not start because the required application secrets and test MongoDB
configuration were not supplied. All executable unit contract checks and the
production build pass; the freeze can be declared complete after E2E succeeds in
the configured test environment.

## Future considerations

None. This freeze intentionally introduces no feature work.
