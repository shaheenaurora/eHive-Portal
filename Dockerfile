# eHive Circle — full-stack portal (marketing site + member/admin SPA + tRPC API)
# Multi-stage build: compile in the builder stage, then copy only the runtime
# artifacts into a slim production image.
FROM node:22-slim AS builder
WORKDIR /app

# Install dependencies (dev deps required for the Vite/esbuild/TypeScript build).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source and build frontend (dist/public) + backend bundle (dist/boot.js).
# Auth is email/password, so there are no build-time (VITE_*) secrets to inject —
# all configuration is supplied at runtime via environment variables.
COPY . .
RUN npm run build

# ------------------------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 3000

# Apply available Debian security updates so the production image doesn't ship
# with known HIGH/CRITICAL CVEs in base OS packages.
RUN apt-get update && apt-get upgrade -y && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy only the compiled output and the production dependency manifest.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/public ./public
# Drizzle config + schema/migrations are required for the Railway pre-deploy
# migration command (`npm run db:migrate`). They stay out of the runtime bundle.
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/db ./db
COPY --from=builder /app/scripts/pre-deploy.ts ./scripts/pre-deploy.ts

# Install only production dependencies. Skip optional native modules where
# possible to keep the image small and reduce attack surface.
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Drop root: run as the unprivileged `node` user that the base image ships with,
# so a process compromise doesn't grant root inside the container. Ownership of
# the app dir is handed to that user for any runtime writes (e.g. temp files).
RUN chown -R node:node /app
USER node

# Start the Hono server: serves marketing pages at /, SPA at /portal* & /admin*,
# tRPC at /api/trpc/*, lead capture, and payment webhooks.
CMD ["node", "dist/boot.js"]
