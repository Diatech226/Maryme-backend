# Architecture

```mermaid
flowchart TD
  F[React + Vite] -->|HTTPS /api/v1| A[NestJS REST API]
  A --> M[Modules Auth / Couples / Guests / Invitations / Check-ins]
  M --> P[Prisma ORM]
  P --> D[(PostgreSQL)]
  M -. best effort .-> L[AuditLog]
```

## Flux

```mermaid
sequenceDiagram
  participant F as Frontend
  participant A as Auth API
  participant DB as PostgreSQL
  F->>A: email + password
  A->>DB: user + couple status
  A->>DB: hashed refresh session
  A-->>F: access JWT + HttpOnly cookie
  F->>A: expired access + refresh cookie
  A->>DB: revoke old / create new session
  A-->>F: new access + rotated cookie
```

```mermaid
sequenceDiagram
  participant C as Couple
  participant API
  participant DB
  C->>API: generate invitation for owned guest
  API->>API: randomBytes(32), SHA-256
  API->>DB: tokenHash only
  API-->>C: raw token once / QR payload
  C->>API: validate token
  API->>DB: resolve hash + status + expiry
  C->>API: confirm check-in (token revalidated)
  API->>DB: transaction + unique guestId
  DB-->>API: first entry or unique conflict (409)
```

Modules remain directly composed in one process. Tenant authorization occurs in services, not only routes. Audit writes are secondary/best-effort. Couple and Guest use controlled soft deletion; CheckIn and AuditLog are immutable operational records.
