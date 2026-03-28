# =============================================================================
# Knowledge Harvester Desktop Agent -- Production Dockerfile
# Multi-stage build: compile TS, rebuild native modules, slim runtime image
# =============================================================================
#
# NOTE: The desktop agent's screenshot capture (PowerShell) and idle-time
# detection (user32.dll via PowerShell) are Windows-only features. This
# container runs the dashboard and pipeline sender functionality only.
# For full capture capability, run the agent natively on Windows.
#
# The listen host defaults to 0.0.0.0 inside the container so the dashboard
# is reachable. Set DASHBOARD_HOST=0.0.0.0 in your environment or override
# the host binding in config if needed.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build (TypeScript -> JS)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
# TypeScript won't copy non-TS assets; bring the dashboard HTML into dist/
RUN cp src/dashboard.html dist/dashboard.html

# ---------------------------------------------------------------------------
# Stage 2: Production-only dependencies
#   better-sqlite3 has native bindings -- rebuild against the runtime OS
#   active-win is excluded at runtime (Windows-only, will fail to import)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Stage 3: Runtime image
# ---------------------------------------------------------------------------
FROM node:22-alpine

# curl for health checks, tini for proper PID 1 signal handling
RUN apk add --no-cache curl tini

# Non-root user
RUN addgroup -S agent && adduser -S agent -G agent

WORKDIR /app

# Production node_modules (no devDependencies)
COPY --from=prod-deps /app/node_modules ./node_modules

# Compiled JS + dashboard HTML
COPY --from=build /app/dist ./dist

# Runtime assets
COPY package.json ./

# Data directory for SQLite database
RUN mkdir -p /app/data && chown -R agent:agent /app

ENV NODE_ENV=production
EXPOSE 3333

ENTRYPOINT ["/sbin/tini", "--"]
USER agent

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3333/api/state || exit 1

CMD ["node", "dist/main.js"]
