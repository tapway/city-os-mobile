# City OS Mobile BFF (FastAPI).
#
# BUILD CONTEXT = apps/bff (this folder):
#   docker build -t tapway/city-os-mobile-bff:dev apps/bff
# deploy/build-mobile.sh does this from a clean `git archive` of a ref.
#
# Pin the base image by digest with --build-arg PYTHON_IMAGE=python:3.11-slim@sha256:...
ARG PYTHON_IMAGE=python:3.11-slim
FROM ${PYTHON_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# BFF source. Only pyproject.toml and src/ are copied, so nothing else that sits
# in the context (.env files, tests, virtualenvs) can end up in the image.
COPY pyproject.toml /app/pyproject.toml
COPY src /app/src
RUN pip install --no-cache-dir .

# Run unprivileged.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin bff
USER 10001

EXPOSE 8002

# /health answers from process state only (no upstream calls), so it is cheap.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8002/health', timeout=3).read()" || exit 1

# --proxy-headers: honour X-Forwarded-Proto/-For from the reverse proxy in front
# (the TLS-terminating host proxy via the pwa container), so redirects the BFF
# generates keep the public https scheme. "*" is safe because this port is not
# published; only containers on the compose network (the pwa) can reach it.
# Never publish port 8002: with it open, any client could forge X-Forwarded-*.
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8002", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
