FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --include=dev

FROM deps AS build
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system nodejs \
    && useradd --system --gid nodejs --create-home maryme
COPY --from=build --chown=maryme:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=maryme:nodejs /app/dist ./dist
COPY --from=build --chown=maryme:nodejs /app/package.json ./package.json
USER maryme
EXPOSE 4000
CMD ["node", "dist/main.js"]
