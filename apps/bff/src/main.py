from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .auth import router as auth_router
from .proxy import router as proxy_router

app = FastAPI(title="City OS Mobile BFF", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth")
app.include_router(proxy_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}