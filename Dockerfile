# eHive Circle — full-stack portal (marketing site + member/admin SPA + tRPC API)
FROM node:20-slim AS base
WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build frontend (dist/public) + backend bundle (dist/boot.js).
# The VITE_* values are inlined into the client bundle at build time (they drive
# the Kimi OAuth redirect in Login.tsx), so they MUST be supplied as build args —
# passing them only at runtime is too late and leaves the sign-in button broken.
ARG VITE_KIMI_AUTH_URL
ARG VITE_APP_ID
ENV VITE_KIMI_AUTH_URL=$VITE_KIMI_AUTH_URL
ENV VITE_APP_ID=$VITE_APP_ID
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Start the Hono server: serves marketing pages at /, SPA at /portal* & /admin*,
# tRPC at /api/trpc/*, OAuth callback and /api/lead.
CMD ["node", "dist/boot.js"]
