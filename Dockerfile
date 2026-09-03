FROM node:22-alpine AS build-frontend

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ .
RUN npm run build

# Backend stage
FROM node:22-alpine AS runtime

WORKDIR /app

# Copy backend code
COPY backend/package*.json ./
RUN npm install --production

COPY backend/ .

# Copy built frontend
COPY --from=build-frontend /app/frontend/dist ./public

# Create database directory, owned by the unprivileged 'node' user (already
# built into the base image) so the app doesn't run as root.
RUN mkdir -p /app/database && chown -R node:node /app
USER node

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start server
CMD ["node", "src/server.js"]
