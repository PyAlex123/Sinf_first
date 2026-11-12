# Sinf — one container: API + WebSocket + built web client (ADR-004).
# Build from the repository root:  docker build -f deploy/Dockerfile -t sinf .
# Runtime data (SQLite, screenshots) lives in the /data volume.

# ---------- build
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
# Native build tools for better-sqlite3 if no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/checkers/package.json packages/checkers/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# The server package with its production dependencies only (workspace packages included, built).
RUN pnpm --filter @sinf/server deploy --legacy --prod /out/server

# ---------- runtime
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    DATABASE_PATH=/data/sinf.db \
    CONTENT_DIR=/app/content \
    WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /out/server ./server
COPY --from=build /app/apps/web/dist ./web
COPY --from=build /app/content ./content
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
