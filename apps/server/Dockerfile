# Build the game server (bundled with esbuild) and run a slim image that only
# carries the bundle + ws. Build context is the repo root (see railway.json).
FROM node:22-slim AS builder
WORKDIR /app
COPY . .
# Installs all workspaces (esbuild + the engine/ai/room sources the bundle inlines).
RUN npm ci && npm run build -w @tarneeb/server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/server/dist/server.js ./server.js
# The bundle imports `ws` at runtime (kept external); install just that.
RUN printf '{"type":"module","dependencies":{"ws":"^8.18.0"}}' > package.json \
  && npm install --omit=dev --no-audit --no-fund
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
