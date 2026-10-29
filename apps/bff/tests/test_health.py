from fastapi.testclient import TestClient
from src.main import app


def test_health():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    # The health payload also reports deployment-critical capability state so a
    # smoke check can tell "running" from "running but storage is not wired up".
    assert "uploads_enabled" in body
    assert "pwa_origins" in body