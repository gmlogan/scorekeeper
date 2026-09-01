FROM node:18-alpine AS build-frontend

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ .
RUN npm run build

# Backend stage
FROM node:18-alpine AS runtime

WORKDIR /app

# Copy backend code
COPY backend/package*.json ./
RUN npm install --production

COPY backend/ .

# Copy built frontend
COPY --from=build-frontend /app/frontend/dist ./public

# Create database directory
RUN mkdir -p /app/database

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start server
CMD ["node", "src/server.js"]
