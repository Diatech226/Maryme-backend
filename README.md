# Maryme Backend

API officielle indépendante de Maryme, monolithe modulaire NestJS/Prisma/PostgreSQL. Toutes les routes métier sont versionnées sous `/api/v1`; Swagger est servi sous `/api/docs`.

## Architecture et stack

NestJS strict TypeScript → modules Auth, Couples, Guests, Invitations, Check-ins, Audit et Health → Prisma → PostgreSQL. Node.js 22 LTS, JWT, Argon2, cookies HttpOnly, Helmet, validation DTO, throttling, Jest et Docker sont inclus. Voir [l'architecture](docs/ARCHITECTURE.md).

## Installation et PostgreSQL

Prérequis : Node.js 22, npm et Docker Desktop. L'installation génère Prisma
Client automatiquement grâce au script `postinstall`; `prisma:generate` reste
disponible pour forcer manuellement sa régénération après une modification du
schéma.

### Windows PowerShell (nouvelle machine)

```powershell
git clone https://github.com/Diatech226/Maryme-backend.git
cd Maryme-backend
Copy-Item .env.example .env
npm ci
docker compose up -d postgres
npx prisma migrate deploy
npm run start:dev
```

L'API écoute sur `http://localhost:4000`, la santé sur
`http://localhost:4000/api/v1/health` et Swagger sur
`http://localhost:4000/api/docs`.

### Linux et macOS

```bash
cp .env.example .env                 # remplacer chaque secret
npm ci                               # exécute automatiquement prisma generate
docker compose up -d postgres
npm run prisma:migrate
npm run build
npm run admin:bootstrap              # crée/synchronise le SUPER_ADMIN depuis les variables SUPER_ADMIN_*
npm run start:dev
```

`DATABASE_URL` doit pointer vers une base dédiée. Le seed ne crée aucun compte administrateur : le compte principal est géré exclusivement par `admin:bootstrap`.

## Variables d'environnement

Voir `.env.example`. `DATABASE_URL`, les deux secrets JWT (32 caractères minimum), `FRONTEND_URL` et `CORS_ORIGINS` sont obligatoires. En production: HTTPS, `COOKIE_SECURE=true`, origines explicites et secrets aléatoires distincts. Les dates sont UTC/ISO 8601.

## Authentification, rôles et sécurité

`POST auth/login` remet un access JWT court et pose le refresh opaque dans un cookie HttpOnly/SameSite strict. `auth/refresh` effectue une rotation persistée; la réutilisation invalide les sessions utilisateur. `auth/logout` révoque la session. Les claims sont limités à `sub`, `role` et `coupleId`.

`SUPER_ADMIN` administre tous les dossiers. `COUPLE` est isolé par `coupleId`. Un couple `PENDING` ou `SUSPENDED` ne peut ni se connecter ni utiliser une session existante; seul `AUTHORIZED` a accès. Helmet, CORS restrictif, whitelist DTO, filtre d'erreur cohérent et rate limiting global sont activés. Les contrôleurs ne renvoient jamais les hashes.

## API

- Auth: login, refresh, logout, me.
- Couples: liste/création admin, lecture/modification propriétaire, autorisation, suspension, archivage contrôlé.
- Guests: CRUD, pagination/filtres, bulk transactionnel; le quota additionne `coupons`.
- Invitations: génération/listing/révocation. En V1, une rotation révoque transactionnellement toutes les invitations actives de l'invité avant d'en créer une seule nouvelle. Seul le résultat de génération expose le token brut aléatoire 256 bits; la base garde SHA-256.
- Check-ins: validation puis confirmation revalidée. La transaction et l'unicité DB de `guestId` rendent la première entrée atomique; concurrence/doublon retourne 409.
- Health: `GET /api/v1/health` vérifie PostgreSQL sans détail interne.

Le contrat interactif est disponible dans Swagger. `docs/openapi.yaml` décrit le contrat stable; lors d'une évolution, mettre à jour contrôleurs, DTO et contrat dans le même commit.

## Tests et qualité

```bash
npm run lint
npm test
npm run test:cov
npm run build
```

Pour l'E2E, définir une `DATABASE_URL` PostgreSQL **de test**, appliquer `npm run prisma:deploy`, exécuter `npm run test:e2e`, puis supprimer la base/son schéma. Ne jamais utiliser une URL de production.

Exemple sans secret réel : `NODE_ENV=test DATABASE_URL=postgresql://maryme:test_password@localhost:5432/maryme_test?schema=public`. Le nettoyage E2E refuse de s'exécuter si `NODE_ENV` n'est pas `test` ou si le nom de la base ne contient pas `test`.

## Docker et déploiement

`docker compose up --build` lance API et PostgreSQL pour le développement. Le Dockerfile multi-stage produit une image non-root. Le bootstrap Admin est compilé dans `dist/scripts/bootstrap-admin.js` et le `package.json` est présent dans l'image runtime, ce qui permet d'exécuter `npm run admin:bootstrap` dans le conteneur après migration. Voir [DEPLOYMENT.md](docs/DEPLOYMENT.md) pour Render, Railway et VPS.

## Suppression et données

La V1 archive Couple/Guest (`deletedAt`). Archiver un couple désactive ses utilisateurs et conserve invités, invitations, check-ins et audit pour éviter une cascade destructive. Une purge RGPD future doit être une procédure explicite, auditée et assortie de la politique de rétention.

## Intégration frontend et roadmap

Configurer le client avec `VITE_DATA_PROVIDER=api` et `https://api.maryme.com/api/v1`, conserver l'access token en mémoire et envoyer les credentials pour le cookie refresh. Prochaines étapes: tests E2E PostgreSQL exhaustifs, rate limits par route configurables, idempotency key, export/import administrateur, observabilité structurée et procédure de purge RGPD.

## Bootstrap explicite de l'Admin Général

Le compte principal SUPER_ADMIN est géré exclusivement par les variables `SUPER_ADMIN_*` et par une commande explicite. L'API ne synchronise jamais ce compte automatiquement au démarrage.

Après un changement volontaire d'email, de téléphone, de nom ou de mot de passe, reconstruire l'application si nécessaire puis relancer :

```bash
npm run admin:bootstrap
```

En développement sans build préalable, la commande équivalente est :

```bash
npm run admin:bootstrap:dev
```

L'email est mis en minuscules, le téléphone est stocké au format E.164 et seul le hash Argon2 du mot de passe est persisté. Lorsqu'un SUPER_ADMIN existant est synchronisé, toutes ses refresh sessions encore actives sont révoquées dans la même transaction afin de forcer une nouvelle authentification. En production, un mot de passe aléatoire d'au moins 16 caractères est recommandé.

Exemple de configuration de production (valeurs factices à fournir via le gestionnaire de secrets) :

```env
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
CORS_ORIGINS=https://app.example.com
FRONTEND_URL=https://app.example.com
JWT_ACCESS_SECRET=REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS
JWT_REFRESH_SECRET=REPLACE_WITH_ANOTHER_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS
COOKIE_SECURE=true
SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_PHONE=+22670000000
SUPER_ADMIN_PASSWORD=REPLACE_WITH_A_RANDOM_PASSWORD_OF_AT_LEAST_16_CHARACTERS
SUPER_ADMIN_FIRST_NAME=Admin
SUPER_ADMIN_LAST_NAME=Maryme
```

Ordre de déploiement :

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run admin:bootstrap
npm run start:prod
```

Dans l'image Docker déjà construite :

```bash
npx prisma migrate deploy
npm run admin:bootstrap
```

La commande échoue si une variable Admin manque ou est invalide, ou si le téléphone normalisé appartient à un autre utilisateur. Elle n'affiche ni mot de passe, ni hash, ni URL de base de données.
