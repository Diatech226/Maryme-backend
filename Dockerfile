FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S nodejs && adduser -S maryme -G nodejs
COPY --from=build --chown=maryme:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=maryme:nodejs /app/dist ./dist
COPY --from=build --chown=maryme:nodejs /app/prisma ./prisma
COPY --from=build --chown=maryme:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=maryme:nodejs /app/package.json ./package.json
USER maryme
EXPOSE 4000
CMD ["sh","-c","npx prisma db push && node dist/main.js"]
