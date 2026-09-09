# Architecture

Maryme est un monolithe modulaire NestJS. Les modules Auth, Couples, Guests,
Invitations et Check-ins accèdent exclusivement à MongoDB via Prisma ORM.
L'API REST et ses DTO restent indépendants du stockage.

MongoDB doit être un replica set (Atlas en fournit un, le développement local
utilise `rs0`) car les créations multi-documents, quotas, rotations de sessions,
invitations et check-ins utilisent des transactions Prisma.

Les identifiants persistés sont des ObjectId MongoDB exposés comme chaînes par
l'API. `AuditLog.entityId` reste volontairement une chaîne : cette référence est
polymorphe et peut désigner une valeur qui n'est pas un ObjectId.

Les relations utilisent `NoAction`, requis par le connecteur MongoDB pour éviter
l'émulation d'actions référentielles cycliques. Les suppressions restent donc
contrôlées explicitement par les services et les soft deletes existants.

## Numbered coupon pool and repeatable guest imports

`Couple.guestQuota` defines the numbered pool `1..guestQuota`; it is independent from a guest's table number and `assignedSeats`. `CouponPoolService.ensurePool` is idempotent and is also the backfill entry point: `POST /couples/{coupleId}/coupons/reconcile` creates missing numbers, compares active guests' legacy `Guest.coupons` counts with assignments, and can allocate shortages with `autoAssignMissing=true`. It never changes seats, invitations, QR tokens, or check-ins.

The normalized spreadsheet endpoint is `POST /couples/{coupleId}/guests/import`. Use `mode=merge` (the default), `dryRun=true` for preview, then repeat with `dryRun=false`. Matching order is Maryme guest ID, external reference, unique normalized email, unique normalized phone, then the normalized name/side/family tuple. Ambiguous imports are rejected atomically. Empty/absent merge fields preserve server data; the documented `__CLEAR__` value explicitly clears nullable strings. Spreadsheet presence/check-in and invitation-download columns are deliberately not accepted: those values are server-authoritative.

`append` always creates, while destructive `replace` retains its check-in safety restriction. Merge updates the existing guest document, preserving its ID, invitations, QR validity, and check-in. Explicit `couponNumbers` are validated and never steal assigned or used numbers.

## Physical seating and legacy placement

`TableSeatAssignment` is the sole source of truth for physical availability created by the Seating endpoints. `initialize` only creates missing tables numbered 1 through 40 at capacity 10; it is idempotent and deliberately never reads guests, deletes guests, or reconstructs assignments from legacy `Guest.tableId`, `Guest.tableNumber`, or `Guest.assignedSeats`. Availability is sorted and counts only `TableSeatAssignment` rows. Legacy spreadsheet imports may retain those guest columns, but generic guest create/update endpoints cannot change them. `Guest.coupons` remains a business coupon count and also determines how many physical seats a new Seating operation requests; coupons and seat assignments remain distinct records.

Assign, move, bulk assignment, unassignment, and seated-guest deletion update assignment rows and the guest compatibility mirror in one database transaction. A seated guest's requested count must be unassigned before it can change.

## Wedding media API projection

Wedding media responses intentionally expose neither `coupleId` nor the storage-only `objectKey`. Frontends must retain `coupleId` from their route context rather than expecting it in a `WeddingMedia` response.
