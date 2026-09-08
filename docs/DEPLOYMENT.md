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

Le disque éphémère Render n'est **pas** un stockage durable. En production,
configurer ensemble `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`,
`STORAGE_ACCESS_KEY_ID` et `STORAGE_SECRET_ACCESS_KEY`. L'implémentation SigV4
utilise un adressage path-style compatible avec MinIO et R2 ; pour AWS, utiliser
un endpoint régional S3 qui accepte cet adressage. Tester PUT/GET/DELETE avec le
fournisseur retenu avant mise en production. Aucun bucket ne doit être public.

Configurer aussi `STORAGE_MAX_UPLOAD_BYTES`, `PUBLIC_API_URL` (préfixe public
complet, par exemple `https://api.example/api/v1`) et `SHARE_LINK_MAX_DAYS`.
Le démarrage en production émet un avertissement si la configuration objet est
absente ou incomplète, sans jamais afficher les identifiants ou secrets.

La détection `stale` compare actuellement les snapshots `updatedAt` de l'invité,
du design et du couple. Elle couvre tous les champs visuels sans migration et
préserve les artifacts existants, au prix d'un possible faux positif lorsqu'un
champ administratif du couple ou de l'invité change. Une empreinte dédiée des
champs visuels nécessiterait une évolution de données et n'est pas introduite
dans cet audit de stabilisation.
