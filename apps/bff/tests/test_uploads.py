"""Upload endpoint tests: auth, validation, storage, and the read route."""
import io

import pytest
from fastapi.testclient import TestClient

from src import uploads
from src.main import app
from src.settings import settings

client = TestClient(app)


class FakeMinio:
    """In-memory stand-in for the MinIO client."""

    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}
        self.buckets: set[str] = set()

    def bucket_exists(self, bucket):
        return bucket in self.buckets

    def make_bucket(self, bucket):
        self.buckets.add(bucket)

    def put_object(self, bucket, key, data, length=None, content_type=None):
        self.objects[(bucket, key)] = data.read()

    def remove_object(self, bucket, key):
        if (bucket, key) not in self.objects:
            raise FileNotFoundError(key)
        del self.objects[(bucket, key)]

    def get_object(self, bucket, key):
        if (bucket, key) not in self.objects:
            raise FileNotFoundError(key)
        return FakeObject(self.objects[(bucket, key)])


class FakeObject(io.BytesIO):
    """Mirrors the object handle MinIO returns (needs close + release_conn)."""

    def release_conn(self):
        return None


@pytest.fixture
def storage(monkeypatch):
    """Enable uploads against a fake object store and stub token verification."""
    fake = FakeMinio()
    monkeypatch.setattr(settings, "minio_endpoint", "minio:9000")
    monkeypatch.setattr(settings, "minio_access_key", "test-access")
    monkeypatch.setattr(settings, "minio_secret_key", "test-secret")
    monkeypatch.setattr(settings, "minio_bucket", "city-help")
    monkeypatch.setattr(uploads, "_storage", lambda: fake)

    async def ok(_token: str) -> None:
        return None

    monkeypatch.setattr(uploads, "_verify_token", ok)
    return fake


def test_delete_requires_a_bearer_token(storage):
    """Deleting is a write: it must not be reachable unauthenticated."""
    resp = client.delete(f"/api/uploads/{settings.uploads_prefix}/x/y.png")
    assert resp.status_code == 401
    assert "z" not in storage.objects


def test_delete_refuses_objects_outside_the_uploads_prefix(storage):
    """The prefix check is the guard against using this route to reach anything
    else in the bucket (or, via a relative key, outside it)."""
    for key in ("secrets/leak.txt", "city-help-important", "..."):
        resp = client.delete(
            f"/api/uploads/{key}", headers={"Authorization": "Bearer test-token"}
        )
        assert resp.status_code == 400, key


def test_delete_removes_the_uploaded_object(storage):
    """A rejected ticket update leaves evidence orphaned; this is the cleanup."""
    created = client.post(
        "/api/uploads",
        files={"file": ("evidence.png", _png_bytes(), "image/png")},
        data={"uid": "CH-2026-05000"},
        headers={"Authorization": "Bearer test-token"},
    )
    assert created.status_code == 200, created.text
    url = created.json()["url"]
    key = url.removeprefix("/api/uploads/")
    assert (settings.minio_bucket, key) in storage.objects

    resp = client.delete(url, headers={"Authorization": "Bearer test-token"})
    assert resp.status_code == 204
    assert (settings.minio_bucket, key) not in storage.objects, "the object is still there"


def test_delete_is_idempotent_when_the_object_is_already_gone(storage):
    """Cleanup runs on a failure path; it must not raise a second error."""
    resp = client.delete(
        f"/api/uploads/{settings.uploads_prefix}/gone/gone.png",
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 204


def _png_bytes() -> bytes:
    # 1x1 PNG — small but a real image payload.
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000a49444154789c6300010000050001"
        "0d0a2db40000000049454e44ae426082"
    )


def test_upload_requires_bearer_token():
    resp = client.post(
        "/api/uploads",
        files={"file": ("evidence.png", _png_bytes(), "image/png")},
    )
    assert resp.status_code == 401


def test_upload_rejects_unsupported_type(storage):
    resp = client.post(
        "/api/uploads",
        files={"file": ("notes.txt", b"hello", "text/plain")},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 415


def test_upload_rejects_empty_file(storage):
    resp = client.post(
        "/api/uploads",
        files={"file": ("empty.png", b"", "image/png")},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 400


def test_upload_rejects_oversized_file(storage, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_bytes", 10)
    resp = client.post(
        "/api/uploads",
        files={"file": ("big.png", _png_bytes() * 10, "image/png")},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 413


def test_upload_stores_under_prefix_and_returns_url(storage):
    resp = client.post(
        "/api/uploads",
        files={"file": ("evidence.png", _png_bytes(), "image/png")},
        data={"ticket_uid": "CH-2026-01204"},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["key"].startswith(f"{settings.uploads_prefix}/CH-2026-01204/")
    assert body["url"] == f"/api/uploads/{body['key']}"
    assert body["content_type"] == "image/png"
    assert body["size"] > 0
    assert (("city-help", body["key"])) in storage.objects


def test_upload_sanitises_ticket_uid_so_it_cannot_escape_the_prefix(storage):
    resp = client.post(
        "/api/uploads",
        files={"file": ("evidence.png", _png_bytes(), "image/png")},
        data={"ticket_uid": "../../etc/passwd"},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 200
    key = resp.json()["key"]
    assert ".." not in key
    assert key.startswith(f"{settings.uploads_prefix}/")


def test_upload_returns_503_when_storage_is_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "minio_endpoint", "")
    resp = client.post(
        "/api/uploads",
        files={"file": ("evidence.png", _png_bytes(), "image/png")},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 503


def test_serve_refuses_keys_outside_the_prefix(storage):
    resp = client.get("/api/uploads/jira-attachments/123/456/foo.jpg")
    assert resp.status_code == 404


def test_serve_returns_the_stored_image(storage):
    storage.buckets.add("city-help")
    storage.objects[("city-help", f"{settings.uploads_prefix}/x/20260101/a.png")] = _png_bytes()

    resp = client.get(f"/api/uploads/{settings.uploads_prefix}/x/20260101/a.png")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content == _png_bytes()


def test_serve_404s_for_a_missing_object(storage):
    resp = client.get(f"/api/uploads/{settings.uploads_prefix}/missing/a.png")
    assert resp.status_code == 404