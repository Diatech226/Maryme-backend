# Maryme Backend

## Physical seating

The seating API has one deliberately simple invariant: **40 tables × 10 physical seats**.
`Guest.coupons` is the requested number of seats, while `Guest.assignedSeats` contains the
physical seat numbers mirrored from concurrency-safe seat assignments. `couponNumbers` and
the `Coupon`/`CouponPool` workflow are the legacy business entitlement system; they remain
supported but are never used as table seat identifiers.

API REST Maryme en NestJS, Prisma 6 et MongoDB. Les routes métier restent sous
`/api/v1`, Swagger sous `/api/docs`, et le serveur écoute sur le port `4000`.

## Prérequis Node.js 22

Le projet ne prend pas en charge Node 20. Sous Windows PowerShell :

```powershell
nvm install 22
nvm use 22
node -v
```

La dernière commande doit afficher `v22.x.x`. Les fichiers `.nvmrc` et
`.node-version` fixent également la version majeure attendue.

## MongoDB Atlas

Copier `.env.example` vers `.env`, puis remplacer `DATABASE_URL` par une URI
Atlas fournie via un secret, par exemple
`mongodb+srv://USERNAME:PASSWORD@CLUSTER/maryme?retryWrites=true&w=majority`.
Atlas fournit le replica set nécessaire aux transactions.

```powershell
Copy-Item .env.example .env
nvm use 22
npm ci
npx prisma generate
npx prisma validate
npx prisma db push
npm run admin:bootstrap:dev
npm run start:dev
```

## MongoDB local

Le Compose utilise MongoDB `8.0.12`, démarre `mongod` avec `--replSet rs0`,
initialise le replica set de façon idempotente, puis attend un primary avant
l'API. Cette configuration est obligatoire : Prisma utilise des transactions.

```powershell
Copy-Item .env.example .env
nvm use 22
docker compose up -d
npm ci
npx prisma generate
npx prisma validate
npx prisma db push
npm run admin:bootstrap:dev
npm run start:dev
```

Pour un processus lancé sur l'hôte, l'exemple utilise
`mongodb://localhost:27017/maryme?replicaSet=rs0&directConnection=true`. Dans le
conteneur API, Compose injecte `mongodb://mongodb:27017/maryme?replicaSet=rs0`.
Docker n'est pas requis avec Atlas.

Ne jamais lancer `prisma db push --force-reset` ni supprimer automatiquement
une base existante. Prisma Migrate ne s'applique pas à MongoDB ; le workflow est
`prisma generate`, `prisma validate`, puis `prisma db push`.

## API et sécurité

- Santé : `GET http://localhost:4000/api/v1/health`
- Authentification : `POST http://localhost:4000/api/v1/auth/login`
- Swagger : `http://localhost:4000/api/docs`
- Frontend : `VITE_API_URL=http://localhost:4000/api/v1`

JWT access, refresh cookies HttpOnly, Argon2, RBAC SUPER_ADMIN/COUPLE, quotas,
invitations et check-ins atomiques sont conservés. L'unicité de `guestId` sur
CheckIn protège le double check-in concurrent. Les ObjectId sont exposés comme
chaînes, sans modifier le contrat REST.

## SUPER_ADMIN et seed

Le seed ne crée jamais de SUPER*ADMIN. Celui-ci est créé ou synchronisé
explicitement avec `npm run admin:bootstrap:dev` (sources) ou
`npm run admin:bootstrap` (après build), à partir des cinq variables
`SUPER_ADMIN*\*`. La rotation conserve normalisation email/téléphone E.164,
hash Argon2, transaction atomique et révocation des refresh sessions actives.

## Tests

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

Les E2E exigent `NODE_ENV=test` et une base dont le nom contient `test`, par
exemple `mongodb://localhost:27017/maryme_test?replicaSet=rs0&directConnection=true`.
Le helper refuse sinon toute purge. La CI Linux lance un vrai replica set ; la
CI Windows vérifie Node 22, Prisma generate/validate, lint et build.

Voir [l'architecture](docs/ARCHITECTURE.md) et le
[déploiement](docs/DEPLOYMENT.md).

# Private invitation file storage (MongoDB GridFS)

Invitation backgrounds and generated PNG/PDF artifacts are private GridFS objects in the MongoDB
database selected by `DATABASE_URL`. On Render configure `STORAGE_DRIVER=gridfs`,
`GRIDFS_BUCKET=maryme_storage`, and `STORAGE_MAX_UPLOAD_BYTES=10485760`; no Persistent Disk is
needed. Initialization is fail-fast and never silently falls back locally. `STORAGE_DRIVER=local`
is reserved for development/tests and is rejected in production.

Public invitation share links serve the image when an artifact has both an image and PDF, and fall
back to the PDF otherwise. Only SHA-256 token hashes are stored. Existing share-link listings
therefore expose metadata for active links, not their unrecoverable URL; create a new link when a
new URL is needed.
