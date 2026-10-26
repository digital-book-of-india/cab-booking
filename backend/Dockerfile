# syntax=docker/dockerfile:1
# Multi-stage build: compile TypeScript, then ship only production dependencies.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Folder for STORAGE_DRIVER=local (driver documents). Mount a persistent volume here, or the files
# are lost when the container is replaced. One server instance only while storage is local.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
ENV UPLOAD_DIR=/data/uploads
VOLUME ["/data/uploads"]
# Run as the unprivileged user that ships with the node image.
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4000}/api/v1/health/live" || exit 1
CMD ["node", "dist/server.js"]
