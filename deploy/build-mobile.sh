#!/usr/bin/env bash
# Build the City OS Mobile images (PWA + BFF) from a git ref.
#
#   deploy/build-mobile.sh [--ref <git-ref>] [--tag <tag>] [--no-latest] [--repo <path>]
#
# Optional base-image pins (digests), passed through as build args:
#   NODE_IMAGE=node:22-alpine@sha256:...  NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine@sha256:...
#   PYTHON_IMAGE=python:3.11-slim@sha256:...
#
# What it does
#   1. `git archive <ref>` into a scratch folder (so only COMMITTED files are built).
#   2. PWA: build context = the archived monorepo root (apps/pwa/Dockerfile).
#      BFF: build context = the archived apps/bff.
#   3. Tags tapway/city-os-mobile-{pwa,bff}:<tag> and :latest. Before :latest moves,
#      the previous :latest is kept as :pre-<tag> so a rollback is one `docker tag`.
#   4. Prints the digests of the base images that were used (keep them in the build log).
#
# Nothing here reads or prints secrets: no env file is used, no secret build args.
set -euo pipefail

usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="HEAD"
TAG=""
MOVE_LATEST=1

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)        REF="${2:?--ref needs a value}"; shift 2 ;;
    --tag)        TAG="${2:?--tag needs a value}"; shift 2 ;;
    --repo)       REPO="${2:?--repo needs a path}"; shift 2 ;;
    --no-latest)  MOVE_LATEST=0; shift ;;
    -h|--help)    usage 0 ;;
    *) echo "unknown argument: $1" >&2; usage 2 ;;
  esac
done

git -C "$REPO" rev-parse --verify --quiet "$REF^{commit}" >/dev/null || { echo "error: ref '$REF' not found in $REPO" >&2; exit 2; }

SHA="$(git -C "$REPO" rev-parse --short=10 "$REF^{commit}")"
TAG="${TAG:-$SHA}"
case "$TAG" in *[!A-Za-z0-9._-]*|"") echo "error: tag '$TAG' has characters docker does not allow" >&2; exit 2 ;; esac

PWA_IMG="tapway/city-os-mobile-pwa"
BFF_IMG="tapway/city-os-mobile-bff"

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/city-os-mobile-build.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

echo "==> archiving $REF ($SHA) from $REPO"
mkdir "$SCRATCH/repo"
git -C "$REPO" archive --format=tar "$REF" | tar -x -C "$SCRATCH/repo"

# Belt and braces: refuse to build if a secret-looking file is in the archive.
leaked="$(find "$SCRATCH/repo" \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' \) ! -name '.env.example' ! -name '.env.mobile.example' -print || true)"
if [ -n "$leaked" ]; then
  echo "error: secret-looking files in the build context (names only):" >&2
  echo "$leaked" | sed "s#^$SCRATCH/##" >&2
  exit 1
fi

# Optional digest pins from the environment.
PWA_ARGS=(); BFF_ARGS=()
[ -z "${NODE_IMAGE:-}" ]   || PWA_ARGS+=(--build-arg "NODE_IMAGE=$NODE_IMAGE")
[ -z "${NGINX_IMAGE:-}" ]  || PWA_ARGS+=(--build-arg "NGINX_IMAGE=$NGINX_IMAGE")
[ -z "${PYTHON_IMAGE:-}" ] || BFF_ARGS+=(--build-arg "PYTHON_IMAGE=$PYTHON_IMAGE")

# Keep the previous :latest as :pre-<tag> before anything moves.
if [ "$MOVE_LATEST" = 1 ]; then
  for img in "$PWA_IMG" "$BFF_IMG"; do
    if docker image inspect "$img:latest" >/dev/null 2>&1; then
      docker tag "$img:latest" "$img:pre-$TAG"
      echo "==> rollback tag: $img:pre-$TAG (was :latest)"
    fi
  done
fi

LATEST_PWA=(); LATEST_BFF=()
if [ "$MOVE_LATEST" = 1 ]; then LATEST_PWA=(-t "$PWA_IMG:latest"); LATEST_BFF=(-t "$BFF_IMG:latest"); fi

echo "==> building $PWA_IMG:$TAG"
docker build -f "$SCRATCH/repo/apps/pwa/Dockerfile" \
  --label "org.opencontainers.image.revision=$SHA" \
  ${PWA_ARGS[@]+"${PWA_ARGS[@]}"} \
  -t "$PWA_IMG:$TAG" ${LATEST_PWA[@]+"${LATEST_PWA[@]}"} "$SCRATCH/repo"

echo "==> building $BFF_IMG:$TAG"
docker build \
  --label "org.opencontainers.image.revision=$SHA" \
  ${BFF_ARGS[@]+"${BFF_ARGS[@]}"} \
  -t "$BFF_IMG:$TAG" ${LATEST_BFF[@]+"${LATEST_BFF[@]}"} "$SCRATCH/repo/apps/bff"

echo "==> base images used (record these; pin with the env vars above):"
for base in "${NODE_IMAGE:-node:22-alpine}" "${NGINX_IMAGE:-nginxinc/nginx-unprivileged:1.27-alpine}" "${PYTHON_IMAGE:-python:3.11-slim}"; do
  digest="$(docker image inspect "$base" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
  echo "   $base -> ${digest:-unknown}"
done

echo "==> done: $SHA"
docker images --format '   {{.Repository}}:{{.Tag}}  {{.Size}}' | grep -E "^   tapway/city-os-mobile-(pwa|bff):($TAG|latest|pre-$TAG) " || true
