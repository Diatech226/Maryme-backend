# Wedding tables (MongoDB)

Prisma Migrate does not support MongoDB. Deploy this schema change with `npx prisma db push`.
It creates the `WeddingTable` collection/indexes and adds the nullable `Guest.tableId` relation. Existing `Guest.tableNumber` values remain untouched for backward compatibility and can be linked through the import API once matching numeric tables exist.
