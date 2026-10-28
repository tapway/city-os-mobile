#!/usr/bin/env bash
# Build the City OS Mobile images (PWA + BFF) from a git ref.
#
#   deploy/build-mobile.sh --city-guard /path/to/city-guard [--ref <git-ref>] [--tag <tag>] [--no-latest]
#
# What it does
#   1. `git archive <ref>` into a scratch folder (so only COMMITTED files are built).
#   2. PWA: build context = the archived monorepo root, Dockerfile apps/pwa/Dockerfile.
#   3. BFF: build context = the archived apps/bff + a copy of the private
#      city-guard package at ./city-guard (what apps/bff/Dockerfile COPYs).
#      .git, .env*, virtualenvs and caches are stripped from that copy.
#   4. Tags tapway/city-os-mobile-{pwa,bff}:<tag> and :latest. Before :latest moves,
#      the previous :latest is kept as :pre-<tag> so a rollback is one `docker tag`.
#
# Nothing here reads or prints secrets: no env file is used, no build args are set.
set -euo pipefail

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="HEAD"
TAG=""
CITY_GUARD="${CITY_GUARD_DIR:-}"
MOVE_LATEST=1

while [ $# -gt 0 ]; do
  case "$1" in
    --city-guard) CITY_GUARD="${2:?--city-guard needs a path}"; shift 2 ;;
    --ref)        REF="${2:?--ref needs a value}"; shift 2 ;;
    --tag)        TAG="${2:?--tag needs a value}"; shift 2 ;;
    --repo)       REPO="${2:?--repo needs a path}"; shift 2 ;;
    --no-latest)  MOVE_LATEST=0; shift ;;
    -h|--help)    usage 0 ;;
    *) echo "unknown argument: $1" >&2; usage 2 ;;
  esac
done

[ -n "$CITY_GUARD" ] || { echo "error: pass --city-guard <path> (or set CITY_GUARD_DIR)" >&2; exit 2; }
[ -f "$CITY_GUARD/pyproject.toml" ] || { echo "error: $CITY_GUARD does not look like city-guard (no pyproject.toml)" >&2; exit 2; }
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

echo "==> assembling BFF context (apps/bff + city-guard)"
mkdir "$SCRATCH/bff"
cp -a "$SCRATCH/repo/apps/bff/." "$SCRATCH/bff/"
mkdir "$SCRATCH/bff/city-guard"
tar -C "$CITY_GUARD" \
    --exclude='.git' --exclude='.env' --exclude='.env.*' --exclude='*.pem' --exclude='*.key' \
    --exclude='.venv' --exclude='venv' --exclude='__pycache__' --exclude='node_modules' \
    --exclude='.pytest_cache' --exclude='.ruff_cache' --exclude='*.egg-info' \
    -cf - . | tar -C "$SCRATCH/bff/city-guard" -xf -

# Belt and braces: refuse to build if a secret-looking file made it into a context.
leaked="$(find "$SCRATCH/repo" "$SCRATCH/bff" \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' \) ! -name '.env.example' ! -name '.env.mobile.example' -print || true)"
if [ -n "$leaked" ]; then
  echo "error: secret-looking files in the build context (names only):" >&2
  echo "$leaked" | sed "s#^$SCRATCH/##" >&2
  exit 1
fi

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
  -t "$PWA_IMG:$TAG" ${LATEST_PWA[@]+"${LATEST_PWA[@]}"} "$SCRATCH/repo"

echo "==> building $BFF_IMG:$TAG"
docker build \
  --label "org.opencontainers.image.revision=$SHA" \
  -t "$BFF_IMG:$TAG" ${LATEST_BFF[@]+"${LATEST_BFF[@]}"} "$SCRATCH/bff"

echo "==> done: $SHA"
docker images --format '   {{.Repository}}:{{.Tag}}  {{.Size}}' | grep -E "^   tapway/city-os-mobile-(pwa|bff):($TAG|latest|pre-$TAG) " || true
