# eHive Circle — full-stack portal (marketing site + member/admin SPA + tRPC API)
FROM node:20-slim AS base
WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build frontend (dist/public) + backend bundle (dist/boot.js).
# Auth is email/password, so there are no build-time (VITE_*) secrets to inject —
# all configuration is supplied at runtime via environment variables.
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Start the Hono server: serves marketing pages at /, SPA at /portal* & /admin*,
# tRPC at /api/trpc/*, OAuth callback and /api/lead.
CMD ["node", "dist/boot.js"]
