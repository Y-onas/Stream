FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY services/api/package.json services/api/package.json
RUN npm ci
COPY apps/web apps/web
COPY apps/admin apps/admin
RUN ADMIN_BASE=/admin/ npm run build
FROM caddy:2-alpine
COPY --from=build /src/apps/web/dist /srv/web
COPY --from=build /src/apps/admin/dist /srv/admin
COPY infrastructure/docker/static.Caddyfile /etc/caddy/Caddyfile
