# Multi-stage Dockerfile for Backend API
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY backend ./backend
COPY admin ./admin
COPY db ./db

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/api/health || exit 1

# Correr migraciones automáticamente antes de iniciar el servidor
CMD sh -c "node db/migrate.js up && node backend/index.js"
