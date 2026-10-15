FROM node:22-alpine AS build-frontend

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ .
RUN npm run build

# Backend stage
FROM node:22-alpine AS runtime

# su-exec drops from root to the `node` user via execve (replacing PID 1, so
# SIGTERM/graceful-shutdown semantics are unchanged) after the entrypoint's
# one-time root setup step below.
RUN apk add --no-cache su-exec

WORKDIR /app

# Copy backend code
COPY backend/package*.json ./
RUN npm install --production

COPY backend/ .

# Copy built frontend
COPY --from=build-frontend /app/frontend/dist ./public

# Create database directory, owned by the unprivileged 'node' user (already
# built into the base image) — matters when nothing is mounted over it
# (e.g. `docker run` without the compose volume). When something IS mounted
# there, this ownership is exactly what the mount shadows, which is what
# docker-entrypoint.sh fixes up at container start.
RUN mkdir -p /app/database && chown -R node:node /app
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Stays root here — the entrypoint needs root to chown a freshly-mounted
# volume, then drops to `node` itself before exec'ing the app.
ENTRYPOINT ["docker-entrypoint.sh"]

# Expose port
EXPOSE 5000

# Health check
# busybox wget, not `node -e`: booting a second Node process per check hit the
# old 3s timeout on a low-power host (ZimaOS). 127.0.0.1 avoids localhost -> ::1.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT:-5000}/health || exit 1

# Start server
CMD ["node", "src/server.js"]
