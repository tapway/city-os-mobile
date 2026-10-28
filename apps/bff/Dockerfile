# City OS Mobile BFF (FastAPI).
#
# BUILD CONTEXT = a folder holding this app's files (apps/bff) PLUS a sibling
# copy of the private `city-guard` package at ./city-guard:
#
#   context/
#     Dockerfile  pyproject.toml  src/  .dockerignore
#     city-guard/            <- copy of the city-guard repo (no .git, no .env*)
#
# deploy/build-mobile.sh assembles exactly that from a git ref. Building straight
# from apps/bff fails at `COPY city-guard` by design (private package, no
# credentials in the build).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# City-guard from the local copy (avoids git credentials in the build).
COPY city-guard /tmp/city-guard
RUN pip install --no-cache-dir /tmp/city-guard && rm -rf /tmp/city-guard

# BFF source. Only pyproject.toml and src/ are copied, so nothing else that sits
# in the context (city-guard/, .env files, tests) can end up in the image.
COPY pyproject.toml /app/pyproject.toml
COPY src /app/src
RUN pip install --no-cache-dir .

# Run unprivileged.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin bff
USER 10001

EXPOSE 8002

# /health answers from process state only (no upstream calls), so it is cheap.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8002/health', timeout=3).read()" || exit 1

# --proxy-headers: honour X-Forwarded-Proto/-For from the reverse proxy in front
# (the TLS-terminating host proxy via the pwa container), so redirects the BFF
# generates keep the public https scheme. "*" is safe because this port is not
# published; only containers on the compose network (the pwa) can reach it.
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8002", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
