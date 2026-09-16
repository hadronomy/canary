# syntax=docker/dockerfile:1.20
# check=error=true

FROM oven/bun:1.4.2 AS bun

FROM node:26 AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY . .
RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile

ENV DO_NOT_TRACK=1 \
  NODE_ENV=production

# Build-only secrets exist in this process. They never enter a file or image setting.
RUN auth="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")" \
  && db="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")" \
  && cd apps/web \
  && APP_ENV=build BETTER_AUTH_SECRET="$auth" DB_PASSWORD="$db" ../../node_modules/.bin/varlock load --agent \
  && APP_ENV=build BETTER_AUTH_SECRET="$auth" DB_PASSWORD="$db" bun run build \
  && ../../node_modules/.bin/varlock flatten

FROM node:26-bookworm-slim AS runtime
ENV APP_ENV=production \
  DO_NOT_TRACK=1 \
  HOST=0.0.0.0 \
  NODE_ENV=production \
  PORT=3001
WORKDIR /app/apps/web

COPY --from=build --chown=node:node /app/apps/web/.output ./.output
COPY --from=build --chown=node:node /app/apps/web/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/web/.env-flat/ ./

EXPOSE 3001
USER node
ENTRYPOINT ["./node_modules/.bin/varlock", "run", "--"]
CMD ["node", ".output/server/index.mjs"]
