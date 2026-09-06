# Déploiement

## Pré-requis communs

Provisionner PostgreSQL sauvegardé, fournir les variables de `.env.example`, des secrets JWT aléatoires distincts, `NODE_ENV=production`, `COOKIE_SECURE=true`, `CORS_ORIGINS=https://maryme.com`, puis exposer le service uniquement via HTTPS. Le démarrage de release exécute `npx prisma migrate deploy`; il ne doit jamais utiliser `migrate dev` ni le seed.

Construire avec `docker build -t maryme-backend .`, déployer l'image, puis configurer le health check sur `/api/v1/health`. Le processus écoute `PORT` et ne requiert aucun stockage local persistant.

## Render / Railway

Créer un service web depuis le Dockerfile, attacher PostgreSQL, injecter `DATABASE_URL` et toutes les variables. Ajouter une commande de pre-deploy `npx prisma migrate deploy`, le domaine `api.maryme.com`, TLS géré et le health check. Ne pas exposer directement le port PostgreSQL.

## VPS Docker

Utiliser un registre, un reverse proxy TLS (Caddy/Nginx) et un réseau Docker privé. Conserver les secrets dans le gestionnaire de secrets/hôte, pas dans Compose ou Git. Exécuter migrations avant bascule, vérifier health, puis effectuer un rolling restart. Sauvegarder PostgreSQL chiffré et tester régulièrement la restauration.

## Checklist

- HTTPS forcé et proxy transmettant correctement l'IP;
- CORS limité aux domaines attendus, cookie Secure;
- migration de production sauvegardée et réversible;
- logs sans tokens/PII superflue;
- alertes sur health, erreurs 5xx, saturation DB;
- sauvegardes, rotation des secrets et politique de rétention/RGPD.
