#!/bin/sh
set -e

# `docker-compose.yml` bind-mounts a host directory over /app/database so the
# sqlite file is visible/backupable on the host. On a fresh deploy target
# that host path doesn't exist yet, Docker creates it owned by root:root —
# which the unprivileged `node` user (set at image build time, but that
# ownership is exactly what a bind mount shadows) can't write into. That
# makes sqlite3 fail with SQLITE_CANTOPEN, the app exits, and
# `restart: unless-stopped` crash-loops it forever — which from the outside
# just looks like the container is stuck starting.
#
# Fix it here, once, at container start, after the volume is mounted and
# before the app runs — regardless of what owns it on the host.
if [ "$(id -u)" = '0' ]; then
  chown -R node:node /app/database
  exec su-exec node "$@"
fi

exec "$@"
