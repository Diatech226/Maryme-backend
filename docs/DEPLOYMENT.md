# Déploiement MongoDB

Utiliser MongoDB Atlas (replica set géré) ou un replica set MongoDB administré.
Injecter une URI `mongodb+srv://…` comme secret, ainsi que les variables de
`.env.example`. Ne jamais enregistrer l'URI réelle dans Git.

Le déploiement exécute `npm ci`, `npx prisma generate`, `npx prisma validate`,
`npx prisma db push`, puis `npm run build`. `db push` synchronise le schéma et les
index MongoDB ; Prisma Migrate ne s'applique pas au connecteur MongoDB. Ne jamais
utiliser `--force-reset` sur une base contenant des données.

Le bootstrap SUPER_ADMIN est une opération explicite après déploiement :
`npm run admin:bootstrap`. Le seed ne crée aucun administrateur.

## Render et frontend Vercel

Configurer au minimum les variables suivantes dans l'environnement Render (les
valeurs sensibles doivent rester des secrets Render, jamais des fichiers Git) :

```text
NODE_ENV=production
DATABASE_URL=mongodb+srv://...
STORAGE_DRIVER=gridfs
GRIDFS_BUCKET=maryme_storage
STORAGE_MAX_UPLOAD_BYTES=10485760
FRONTEND_URL=https://...
CORS_ORIGINS=https://...
PUBLIC_API_URL=https://<render>.onrender.com/api/v1
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
COOKIE_SECURE=true
```

`STORAGE_LOCAL_DIR` n'est pas nécessaire en production : le stockage local y est
interdit et GridFS est obligatoire.

En production, définir `FRONTEND_URL=https://maryme.vercel.app` et inclure cette
origine exacte dans la liste séparée par des virgules `CORS_ORIGINS` (ainsi que
chaque éventuel domaine Vercel personnalisé autorisé). Les cookies refresh sont
alors automatiquement `HttpOnly`, `Secure`, `SameSite=None` et limités au chemin
`/api/v1/auth`; en local ils utilisent `Secure=false` et `SameSite=Lax`.

Il est préférable d'exécuter `npx prisma db push` dans une étape de pré-déploiement
Render unique plutôt que dans chaque réplique au démarrage : cela évite les
modifications d'index concurrentes et sépare clairement l'évolution du schéma du
démarrage applicatif. Le `CMD` actuel est conservé pour compatibilité. Avant de
déployer le champ `User.phone` obligatoire, renseigner et dédupliquer tous les
numéros des utilisateurs existants, puis lancer `db push` sans `--force-reset`.

## Stockage privé des faire-part

Le stockage officiel est MongoDB GridFS, dans la même base Atlas que Prisma. Sur Render configurer
`DATABASE_URL=<MongoDB Atlas URI>`, `STORAGE_DRIVER=gridfs`,
`GRIDFS_BUCKET=maryme_storage` et `STORAGE_MAX_UPLOAD_BYTES=10485760`. Les objets utilisent
`maryme_storage.files` et `maryme_storage.chunks`; aucun Persistent Disk Render ni seconde base
n'est nécessaire. Une connexion/ping impossible fait échouer le démarrage plutôt que de basculer
silencieusement sur le filesystem local.

Configurer aussi `STORAGE_MAX_UPLOAD_BYTES`, `PUBLIC_API_URL` (préfixe public
complet, par exemple `https://api.example/api/v1`) et `SHARE_LINK_MAX_DAYS`.
Le healthcheck ping MongoDB sans écrire d'objet et expose l'état du bucket sans afficher de secret.

La détection `stale` compare actuellement les snapshots `updatedAt` de l'invité,
du design et du couple. Elle couvre tous les champs visuels sans migration et
préserve les artifacts existants, au prix d'un possible faux positif lorsqu'un
champ administratif du couple ou de l'invité change. Une empreinte dédiée des
champs visuels nécessiterait une évolution de données et n'est pas introduite
dans cet audit de stabilisation.
