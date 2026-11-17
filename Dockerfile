# One image for the migrator, the API (with its job workers) and the web app; docker-compose.yml picks the command.
FROM node:26-slim
RUN corepack enable
WORKDIR /app

# Dependencies first, so a code-only change reuses this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/compliance/package.json packages/compliance/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/spike/package.json packages/spike/
RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages

# The web app's /v1 rewrite is fixed at build time (next.config.ts): the API container on the compose network.
ENV API_URL=http://api:4000 NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @nmp/web build

# A fresh named volume copies this directory's owner, so uploads and the mail drop are writable by node.
RUN mkdir -p /data && chown node:node /data apps/web/.next
ENV NODE_ENV=production
USER node
