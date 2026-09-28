# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Plain `npm ci`/`npm install` here try to node-gyp-rebuild better-sqlite3
# even though its package.json sets "gypfile": false and already ships a
# prebuilt native binding for linux-x64 (an npm defect: installing from an
# existing package-lock.json ignores gypfile:false, unlike a lockfile-free
# resolution). There is no C++ toolchain in this slim image and no such
# build is needed, so `--ignore-scripts` skips the broken auto-rebuild and
# the package loads its bundled prebuilds/linux-x64.node directly.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080
CMD ["node", "dist/server/main.js"]
