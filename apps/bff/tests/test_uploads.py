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
        self.meta: dict[tuple[str, str], dict] = {}
        self.buckets: set[str] = set()

    def bucket_exists(self, bucket):
        return bucket in self.buckets

    def make_bucket(self, bucket):
        self.buckets.add(bucket)

    def put_object(self, bucket, key, data, length=None, content_type=None, metadata=None):
        self.objects[(bucket, key)] = data.read()
        # MinIO returns user metadata under the x-amz-meta- prefix.
        self.meta[(bucket, key)] = {f"x-amz-meta-{k.lower()}": v for k, v in (metadata or {}).items()}

    def stat_object(self, bucket, key):
        if (bucket, key) not in self.objects:
            raise FileNotFoundError(key)
        return type("Stat", (), {"metadata": self.meta.get((bucket, key), {})})()

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

    async def ok(token: str) -> str:
        # The test token doubles as the caller's identity: "Bearer user-a" is user-a.
        return token

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

def _upload_as(token: str) -> str:
    resp = client.post(
        "/api/uploads",
        files={"file": ("evidence.png", _png_bytes(), "image/png")},
        data={"ticket_uid": "CH-2026-05001"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["url"]


def test_upload_records_the_uploader_in_object_metadata(storage):
    url = _upload_as("user-a")
    key = url.removeprefix("/api/uploads/")
    assert storage.meta[(settings.minio_bucket, key)].get("x-amz-meta-uploader-sub") == "user-a"


def test_only_the_uploader_can_delete(storage):
    url = _upload_as("user-a")
    key = url.removeprefix("/api/uploads/")

    other = client.delete(url, headers={"Authorization": "Bearer user-b"})
    assert other.status_code == 403
    assert (settings.minio_bucket, key) in storage.objects, "another user deleted the evidence"

    own = client.delete(url, headers={"Authorization": "Bearer user-a"})
    assert own.status_code == 204
    assert (settings.minio_bucket, key) not in storage.objects


def test_delete_of_an_object_without_an_owner_is_refused(storage):
    """Uploads from before the owner was recorded have no metadata; nobody may delete them."""
    key = f"{settings.uploads_prefix}/legacy/20260101/a.png"
    storage.buckets.add(settings.minio_bucket)
    storage.objects[(settings.minio_bucket, key)] = _png_bytes()
    resp = client.delete(f"/api/uploads/{key}", headers={"Authorization": "Bearer user-a"})
    assert resp.status_code == 403
    assert (settings.minio_bucket, key) in storage.objects


class _FakeResp:
    def __init__(self, status_code=200, payload=None, raw_json_error=False):
        self.status_code = status_code
        self._payload = payload
        self._err = raw_json_error
        self.text = ""

    def json(self):
        if self._err:
            raise ValueError("not json")
        return self._payload


def _fake_city_help(monkeypatch, resp):
    """Stub the HTTP call only, so the real _verify_token parsing runs."""
    class FakeClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, headers=None): return resp

    monkeypatch.setattr(uploads.httpx, "AsyncClient", FakeClient)


@pytest.mark.parametrize(
    "payload, expected",
    [
        ({"id": "sub-1", "username": "ali"}, "sub-1"),
        ({"id": None, "username": "ali"}, "ali"),
        ({"username": "ali"}, "ali"),
        ({"id": None, "username": None}, ""),
        (["not", "a", "dict"], ""),
        ("a string", ""),
        (None, ""),
    ],
)
def test_verify_token_derives_the_owner_from_auth_me(monkeypatch, payload, expected):
    import asyncio

    _fake_city_help(monkeypatch, _FakeResp(200, payload))
    assert asyncio.run(uploads._verify_token("t")) == expected


def test_verify_token_survives_a_non_json_body(monkeypatch):
    import asyncio

    _fake_city_help(monkeypatch, _FakeResp(200, raw_json_error=True))
    assert asyncio.run(uploads._verify_token("t")) == ""


def test_upload_does_not_500_when_auth_me_is_not_a_dict(monkeypatch):
    fake = FakeMinio()
    monkeypatch.setattr(settings, "minio_endpoint", "minio:9000")
    monkeypatch.setattr(settings, "minio_access_key", "a")
    monkeypatch.setattr(settings, "minio_secret_key", "b")
    monkeypatch.setattr(settings, "minio_bucket", "city-help")
    monkeypatch.setattr(uploads, "_storage", lambda: fake)
    _fake_city_help(monkeypatch, _FakeResp(200, ["oops"]))
    resp = client.post(
        "/api/uploads",
        files={"file": ("e.png", _png_bytes(), "image/png")},
        headers={"Authorization": "Bearer t"},
    )
    assert resp.status_code == 200, resp.text
    key = resp.json()["key"]
    assert fake.meta[("city-help", key)] == {}, "no owner is recorded when identity is unknown"
