# syntax=docker/dockerfile:1

# --- deps: install production + build dependencies ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: compile the Next.js standalone output ---
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time and cannot be set at
# container runtime — pass them as --build-arg or wallet sign-in breaks in prod.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_DOMAIN
ARG NEXT_PUBLIC_REOWN_PROJECT_ID
ARG NEXT_PUBLIC_APPS_DOMAIN
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_APP_DOMAIN=$NEXT_PUBLIC_APP_DOMAIN \
    NEXT_PUBLIC_REOWN_PROJECT_ID=$NEXT_PUBLIC_REOWN_PROJECT_ID \
    NEXT_PUBLIC_APPS_DOMAIN=$NEXT_PUBLIC_APPS_DOMAIN \
    NEXT_TELEMETRY_DISABLED=1
# Server-side secrets (DATABASE_URL, STRIPE_*, BETTER_AUTH_*) are read at request time.
RUN npm run build

# --- runner: minimal image serving the standalone server ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
