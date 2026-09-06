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
