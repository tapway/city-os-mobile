from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import router as auth_router
from .proxy import close_http_client, router as proxy_router
from .settings import settings
from .uploads import router as uploads_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Release pooled upstream connections on shutdown.
    await close_http_client()


app = FastAPI(title="City OS Mobile BFF", version="0.1.0", lifespan=lifespan)

# Origins come from configuration: the PWA is served from localhost in
# development and from a tunnel / reverse proxy in the field.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.pwa_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth")
# Uploads must be registered BEFORE the catch-all proxy so that
# /api/uploads/* is handled here rather than forwarded upstream.
app.include_router(uploads_router)
app.include_router(proxy_router, prefix="/api")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "uploads_enabled": settings.uploads_enabled,
        "pwa_origins": settings.pwa_origins_list,
    }