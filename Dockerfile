# syntax=docker/dockerfile:1

# ---- base: shared toolchain ----
FROM node:22-alpine AS base
RUN npm install -g pnpm@10.18.3
WORKDIR /app

# ---- deps: warm the pnpm store ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY scripts ./scripts
COPY packages/shared/package.json packages/shared/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile

# ---- build: shared -> backend -> frontend ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm build

# ---- runtime ----
FROM base AS runtime
RUN apk add --no-cache postgresql-client
COPY --from=build /app /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
CMD ["/usr/local/bin/docker-entrypoint.sh"]