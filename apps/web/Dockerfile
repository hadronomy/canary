FROM node:24-slim AS base
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

ENV SKIP_ENV_VALIDATION=1
ENV BETTER_AUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime
ENV BETTER_AUTH_URL=http://localhost:3001
ENV CORS_ORIGIN=http://localhost:3001
ENV DATABASE_URL=postgresql://postgres:password@postgres:5432/canary
ENV ELECTRIC_URL=http://electric:3000
ENV VITE_SERVER_URL=http://localhost:3001

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install

ENV NODE_ENV=production
RUN cd apps/web && bun run build

ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

WORKDIR /app/apps/web
CMD ["bun", ".output/server/index.mjs"]
