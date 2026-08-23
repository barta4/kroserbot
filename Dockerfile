# ==========================================================
# KroserBot - Production Multi-Stage Dockerfile
# Repository: alfredobartaburu/kroserbot
# ==========================================================

# --- Stage 1: Dependencies Builder ---
FROM node:20-alpine AS dependencies
WORKDIR /app

# Install build dependencies if needed
RUN apk add --no-cache libc6-compat

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# --- Stage 2: Production Runner ---
FROM node:20-alpine AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="KroserBot" \
      org.opencontainers.image.description="Asistente de IA, RAG y Gestión de Pedidos para Kroser Uruguay" \
      org.opencontainers.image.authors="alfredobartaburu" \
      org.opencontainers.image.source="https://github.com/barta4/kroserbot" \
      org.opencontainers.image.version="1.0.0"

ENV NODE_ENV=production \
    PORT=3000

# Create application directories and set ownership for security
RUN mkdir -p /app/logs && chown -R node:node /app

# Copy production node_modules from builder
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node backend ./backend
COPY --chown=node:node admin ./admin
COPY --chown=node:node db ./db

# Switch to non-root user for container security
USER node

EXPOSE 3000

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Auto-apply database migrations on startup and start backend server
CMD ["sh", "-c", "node db/migrate.js up && node backend/index.js"]
