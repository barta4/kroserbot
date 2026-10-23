# ==========================================================
# KroserBot - Backend Dockerfile
# Repository: alfredobartaburu/kroserbot
# ==========================================================

# --- Stage 1: Dependencies Builder ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# --- Stage 2: Production Runner ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

RUN mkdir -p /app/logs && chown -R node:node /app

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node backend ./backend
COPY --chown=node:node admin ./admin
COPY --chown=node:node public ./public
COPY --chown=node:node db ./db

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["sh", "-c", "node db/migrate.js up && node backend/index.js"]
