# Déployer Maryme Backend sur Render

Cette procédure sépare volontairement **build**, **initialisation de la base** et
**démarrage**. Un redémarrage ordinaire ne lance ni Prisma CLI ni `prisma db push`.

## 1. Créer le Web Service

1. Connecter le dépôt GitHub `Diatech226/Maryme-backend` à Render.
2. Créer un **Web Service**, sélectionner la branche `main` et le runtime **Node**.
   Le Blueprint `render.yaml` à la racine fournit aussi ces réglages sans secret.
3. Utiliser Node 22 (les fichiers `.nvmrc` et `.node-version` le fixent ; Node 24
   est également accepté par `engines.node >=22`).
4. Configurer **Build Command** :

   ```bash
   npm ci --include=dev && npm run build
   ```

5. Configurer **Start Command** :

   ```bash
   npm run start:prod
   ```

6. Configurer **Health Check Path** : `/api/v1/health`.

Render fournit `PORT` au processus. Ne définir ni ne figer `PORT=4000` dans le
service : l'application lit ce port et écoute sur `0.0.0.0`.

## 2. Variables d'environnement

Enregistrer les secrets dans le tableau de bord Render, jamais dans Git :

```dotenv
NODE_ENV=production
DATABASE_URL=mongodb+srv://USERNAME:PASSWORD@CLUSTER/maryme?retryWrites=true&w=majority
FRONTEND_URL=https://frontend.example.com
CORS_ORIGINS=https://frontend.example.com,https://www.frontend.example.com
JWT_ACCESS_SECRET=<secret-aleatoire-d-au-moins-32-caracteres>
JWT_REFRESH_SECRET=<autre-secret-aleatoire-d-au-moins-32-caracteres>
COOKIE_SECURE=true
STORAGE_DRIVER=gridfs
GRIDFS_BUCKET=maryme_storage
STORAGE_MAX_UPLOAD_BYTES=10485760
WEDDING_MEDIA_MAX_UPLOAD_BYTES=5242880
PUBLIC_API_URL=https://backend.example.com/api/v1
```

`JWT_ACCESS_EXPIRES_IN` (`15m`), `JWT_REFRESH_EXPIRES_IN` (`30d`) et
`SHARE_LINK_MAX_DAYS` (`30`) sont facultatifs. `CORS_ORIGINS` accepte une ou
plusieurs URL séparées par des virgules ; ne pas ajouter de chemin d'API.

## 3. Préparer MongoDB Atlas

Prisma et GridFS ouvrent deux clients vers la même `DATABASE_URL`. Atlas accepte
ce fonctionnement ; aucun stockage S3 ni Render Persistent Disk n'est requis.

Avant le premier déploiement :

- créer un utilisateur Atlas autorisé sur la base ;
- encoder le nom d'utilisateur et le mot de passe comme composants d'URL (par
  exemple `@` devient `%40`) ;
- inclure un **nom de base explicite** (`/maryme`) dans l'URI ;
- dans **Network Access**, autoriser les connexions sortantes de Render (ou
  temporairement `0.0.0.0/0` avec identifiants robustes si le plan ne fournit
  pas d'IP fixe) ;
- conserver les options Atlas recommandées `retryWrites=true&w=majority` ;
- ne jamais copier l'URI complète dans les logs ou dans un ticket public.

Atlas fournit le replica set nécessaire aux transactions utilisées par le
seating, les invités, les coupons et les invitations.

## 4. Initialiser le schéma et les index Prisma

`npm run build` génère le client Prisma et compile NestJS, mais ne touche pas la
base. Exécuter une fois, puis après toute modification de `schema.prisma` :

```bash
npm run prisma:push
```

Utiliser la **Pre-Deploy Command** Render si elle est disponible sur le plan.
Sinon lancer cette commande dans un job ponctuel ou depuis une machine de
confiance avec la même `DATABASE_URL`, avant de démarrer la nouvelle version.
Ne jamais utiliser `--force-reset` en production. Prisma Migrate ne prend pas en
charge MongoDB ; `db push` crée notamment les index d'unicité des sièges.

## 5. Vérifier le déploiement

Après le démarrage, appeler :

```bash
curl --fail https://backend.example.com/api/v1/health
```

La réponse HTTP 200 doit indiquer `status: "ok"`, `database: "connected"` et
`storage.connected: true`. Une panne Prisma ou GridFS produit HTTP 503 ; elle ne
doit pas être masquée. Les logs de démarrage distinguent
`DATABASE_CONNECTION_FAILED` et `STORAGE_CONNECTION_FAILED` sans afficher l'URI.

## Déploiement Docker (alternative)

Le `Dockerfile` utilise Debian Bookworm slim, plus prévisible qu'Alpine/musl pour
Argon2 et les moteurs Prisma. Il installe de façon reproductible avec
`package-lock.json`, compile, retire les dépendances de développement et lance
uniquement `node dist/main.js`. L'initialisation `prisma:push` reste une étape
séparée.

## Diagnostic d'un déploiement qui échoue

| Symptôme | Diagnostic et correction |
| --- | --- |
| `npm ci failed` | Lire le statut HTTP et le paquet exact. Un 403/timeout du registry est un problème réseau/registry ; une erreur `EUSAGE` signalant un décalage entre `package.json` et `package-lock.json` est un problème du dépôt. Ne pas supprimer le lockfile. |
| `prisma generate failed` | Vérifier Node >=22, la présence des devDependencies pendant le build, `prisma` et `@prisma/client` à la même version, puis lancer `npm run prisma:generate`. Cette étape ne nécessite pas de connexion Atlas. |
| `nest build failed` | Consulter l'erreur TypeScript, confirmer que `npm ci --include=dev` a installé `@nestjs/cli` et lancer `npm run lint` localement. |
| `DATABASE_URL invalid` | Utiliser `mongodb://` ou `mongodb+srv://`, ajouter le nom de base et URL-encoder les identifiants. La validation d'environnement arrête volontairement le processus. |
| MongoDB timeout | Vérifier Atlas Network Access, l'état du cluster, DNS SRV et les sorties réseau Render. Aucun secret ne doit apparaître dans les logs. |
| `STORAGE_CONNECTION_FAILED` | Vérifier `STORAGE_DRIVER=gridfs`, l'accès Atlas, les droits de création des collections/index GridFS et `GRIDFS_BUCKET`. |
| `no open ports detected` | Ne pas définir un port statique ; vérifier que Render fournit `PORT`, que la Start Command est `npm run start:prod` et que la connexion MongoDB/GridFS n'a pas échoué avant `listen`. |
| Erreur CORS | Mettre les origines frontend exactes (schéma + hôte + port éventuel), séparées par virgules dans `CORS_ORIGINS`, sans slash/chemin superflu. |
| Secret JWT absent | Fournir deux secrets distincts d'au moins 32 caractères : `JWT_ACCESS_SECRET` et `JWT_REFRESH_SECRET`. |
| GridFS indisponible | `/health` renvoie 503. Vérifier la connexion Atlas commune, les permissions et l'index unique `metadata.key`; ne pas contourner avec `STORAGE_DRIVER=local` en production. |

