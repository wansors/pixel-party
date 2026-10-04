# syntax=docker/dockerfile:1
# Pixel Party — one image with the whole game: the Bun game server, bundled into a single server.js,
# serving the production web client, the /api and the /ws WebSocket on one port (party mode).
# Run it: docker run -d --name pixel-party -p 3000:3000 <user>/pixel-party   (docs/docker.md)

ARG BUN_VERSION=1.4.2

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS bun

# ── 1. Build: client + server bundle ────────────────────────────────────────────────────────────
# Runs on the builder's own platform: its output (JS, HTML, assets) is the same for every target.
# Node is there for the Angular CLI; Bun installs, bundles and runs the scripts.
FROM --platform=$BUILDPLATFORM node:24-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

# Manifests first, so the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build:client
# The whole server (and @pp/shared) in one file. NODE_ENV is baked in at bundle time: the image is
# always production (it serves the client; only the origins this server served may open a socket).
RUN bun build apps/server/src/index.ts --target=bun \
      --define 'process.env.NODE_ENV="production"' --outfile dist/server.js

# ── 2. Runtime: Bun + two folders, nothing else ─────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-slim
ARG VERSION=dev
LABEL org.opencontainers.image.title="Pixel Party" \
      org.opencontainers.image.description="LAN party mini-games in the browser: one server, every player on their own device." \
      org.opencontainers.image.source="https://github.com/wansors/pixel-party" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

WORKDIR /app
COPY --from=build /app/dist/server.js ./server.js
COPY --from=build /app/apps/client/dist/client/browser ./client
# The licenses that travel with the code: the project's own, and the notices of every third-party
# package bundled into the client (collected by the Angular build). The font's OFL is in client/fonts.
COPY --from=build /app/LICENSE ./licenses/LICENSE
COPY --from=build /app/apps/client/dist/client/3rdpartylicenses.txt ./licenses/THIRD-PARTY-NOTICES.txt

# NODE_ENV=production: Bun answers errors with a bare 500 instead of its debug page. No transpiler
# cache on disk: the bundle is plain JS, and the container can run --read-only.
ENV NODE_ENV=production \
    PORT=3000 \
    CLIENT_DIR=/app/client \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
# Nothing is written to disk: the game keeps everything in memory, so the image runs unprivileged.
USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/health`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["bun", "server.js"]
