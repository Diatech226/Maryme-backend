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
