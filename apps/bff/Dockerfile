FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git gcc libpq5 curl && \
    rm -rf /var/lib/apt/lists/*

# Copy city-guard from local clone (avoids git credential issues in build)
COPY city-guard /tmp/city-guard
RUN pip install --no-cache-dir /tmp/city-guard && rm -rf /tmp/city-guard

# Copy BFF source
COPY . /app
RUN pip install --no-cache-dir .

EXPOSE 8002
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8002"]