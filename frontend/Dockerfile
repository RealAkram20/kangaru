# syntax=docker/dockerfile:1.7
# =============================================================================
# KangaruRide web app — the SPA, built once and served static (W1-a)
# =============================================================================
#
# The console and the public order site are one Vite build. It talks to the
# API at VITE_API_BASE_URL, which Vite inlines at BUILD time — so the API
# origin is a build argument here, not a runtime variable, and changing it
# means rebuilding this image (Coolify does that on redeploy).
#
# Stage 1 builds with the same Node the CI job uses (22). Stage 2 is nginx
# serving `dist/` with the SPA fallback and cache headers in docker/nginx.conf.
# -----------------------------------------------------------------------------

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Required. There is no sensible default: the API is on another origin.
ARG VITE_API_BASE_URL
# Optional — frontend/.env.example explains each. Without them the map falls
# back to keyless engines and the Google prefill button explains itself.
ARG VITE_GOOGLE_MAPS_API_KEY=
ARG VITE_MAPBOX_TOKEN=
ARG VITE_GOOGLE_CLIENT_ID=

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_GOOGLE_MAPS_API_KEY=${VITE_GOOGLE_MAPS_API_KEY} \
    VITE_MAPBOX_TOKEN=${VITE_MAPBOX_TOKEN} \
    VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

# Refuse to build a web app that points at nowhere. A blank value would
# produce a bundle whose every request goes to the page's own origin and 404s.
RUN test -n "$VITE_API_BASE_URL" || { echo "VITE_API_BASE_URL build-arg is required" >&2; exit 1; }

# `tsc -b && vite build` — the same command CI runs.
RUN npm run build


FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/kangaruride/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
