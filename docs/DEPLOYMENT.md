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
