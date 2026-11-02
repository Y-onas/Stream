FROM node:22-alpine AS dependencies
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY services/api/package.json services/api/package.json
RUN npm ci
COPY services/api services/api
RUN npx prisma generate --config services/api/prisma.config.ts && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache ffmpeg openssl
WORKDIR /app
COPY --chown=node:node --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node services/api services/api
COPY --chown=node:node scripts/db-migrate.mjs scripts/start-production.mjs scripts/
RUN mkdir -p /app/.local && chown node:node /app/.local
USER node
ENV NODE_ENV=production API_HOST=0.0.0.0
CMD ["node","scripts/start-production.mjs"]
