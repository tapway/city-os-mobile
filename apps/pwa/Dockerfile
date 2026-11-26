# City OS Mobile PWA: build with Node 22 + pnpm, serve with nginx.
#
# BUILD CONTEXT IS THE MONOREPO ROOT:
#   docker build -f apps/pwa/Dockerfile -t tapway/city-os-mobile-pwa:dev .
# (deploy/build-mobile.sh does this from a clean `git archive` of a ref.)

# ---- build ------------------------------------------------------------------
# Pin by digest with --build-arg NODE_IMAGE=node:22-alpine@sha256:... (and NGINX_IMAGE).
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
WORKDIR /repo
# pnpm version comes from "packageManager" in the root package.json.
RUN corepack enable

# Manifests first so the dependency layer is cached until a lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/pwa/package.json apps/pwa/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile --filter "@city-os/pwa..."

COPY apps/pwa apps/pwa
COPY packages packages
RUN pnpm --filter @city-os/pwa build \
 # We never publish source maps (vite emits "hidden" ones).
 && find apps/pwa/dist -name '*.map' -type f -delete \
 && ! find apps/pwa/dist -name '*.map' | grep -q .

# ---- serve ------------------------------------------------------------------
# nginx-unprivileged runs as uid 101 and listens on 8080.
FROM ${NGINX_IMAGE}
# Nothing references the stock error page; ship only the app.
USER root
RUN rm -rf /usr/share/nginx/html/*
USER 101
COPY apps/pwa/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/pwa/docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/pwa/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/nginx-health || exit 1
