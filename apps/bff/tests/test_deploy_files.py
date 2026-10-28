"""Guards for the container deployment files (deploy/, Dockerfiles).

These are static checks: they run without docker and fail fast on the mistakes
that would only show up on another server (a published BFF port, a secret in the
env template, a HEALTHCHECK pointing at a route that does not exist).
"""
import re
import subprocess
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

ROOT = Path(__file__).resolve().parents[3]
DEPLOY = ROOT / "deploy"
COMPOSE = DEPLOY / "docker-compose.mobile.yml"
ENV_EXAMPLE = DEPLOY / ".env.mobile.example"

pytestmark = pytest.mark.skipif(not COMPOSE.exists(), reason="deploy/ not in this checkout")


def _compose() -> dict:
    return yaml.safe_load(COMPOSE.read_text())


def test_project_name_does_not_collide_with_city_help():
    assert _compose()["name"] not in {"deploy", "city-help"}


def test_only_the_pwa_publishes_a_port_and_only_on_loopback():
    services = _compose()["services"]
    assert "ports" not in services["bff"]
    assert services["pwa"]["ports"] == ["127.0.0.1:${MOBILE_PORT:-19447}:8080"]


@pytest.mark.parametrize("service", ["bff", "pwa"])
def test_services_restart_and_report_health(service):
    svc = _compose()["services"][service]
    assert svc["restart"] == "unless-stopped"
    assert "healthcheck" in svc


def test_pwa_waits_for_a_healthy_bff():
    assert _compose()["services"]["pwa"]["depends_on"]["bff"]["condition"] == "service_healthy"


def test_bff_healthcheck_route_exists():
    from fastapi.testclient import TestClient
    from src.main import app

    assert TestClient(app).get("/health").status_code == 200
    for text in ((ROOT / "apps/bff/Dockerfile").read_text(), COMPOSE.read_text()):
        assert "127.0.0.1:8002/health" in text


def test_external_network_is_only_in_the_optional_override():
    # The base file must work with no pre-existing network; joining one (for
    # example City Help's deploy_default) lives in the override file.
    assert "upstream" not in _compose().get("networks", {})
    override = yaml.safe_load((DEPLOY / "docker-compose.mobile.upstream.yml").read_text())
    upstream = override["networks"]["upstream"]
    assert upstream["external"] is True
    assert "${UPSTREAM_NETWORK" in upstream["name"]


def test_env_template_holds_no_secret_values():
    secret_keys = re.compile(r"(SECRET|PASSWORD|ACCESS_KEY|_TOKEN$)")
    for line in ENV_EXAMPLE.read_text().splitlines():
        if line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if secret_keys.search(key):
            assert value == "", f"{key} must be empty in the template"


def test_env_template_covers_every_variable_compose_requires():
    required = set(re.findall(r"\$\{(\w+):\?", COMPOSE.read_text()))
    keys = {l.partition("=")[0] for l in ENV_EXAMPLE.read_text().splitlines() if "=" in l and not l.startswith("#")}
    assert required and required <= keys


def test_bff_image_runs_unprivileged_and_copies_only_what_it_needs():
    dockerfile = (ROOT / "apps/bff/Dockerfile").read_text()
    assert re.search(r"^USER\s+\S+", dockerfile, re.M)
    assert "COPY . " not in dockerfile  # copy only pyproject.toml and src/: a context may hold .env files
    assert "--proxy-headers" in dockerfile


def test_pwa_image_deletes_sourcemaps_and_runs_unprivileged():
    dockerfile = (ROOT / "apps/pwa/Dockerfile").read_text()
    assert "*.map" in dockerfile
    assert "nginx-unprivileged" in dockerfile
    assert "--frozen-lockfile" in dockerfile


def test_build_script_is_valid_bash():
    subprocess.run(["bash", "-n", str(DEPLOY / "build-mobile.sh")], check=True)


def _imports_city_guard() -> bool:
    src = Path(__file__).resolve().parents[1] / "src"
    return any(
        re.search(r"^\s*(import|from)\s+city_guard\b", f.read_text(), re.M) for f in src.rglob("*.py")
    )


def test_dockerfile_mentions_city_guard_only_if_the_code_imports_it():
    # The BFF used to build with a sibling copy of the private city-guard package
    # that no module imported. Do not bring it (and the sibling-folder build) back
    # unless the code really needs it.
    dockerfile = (ROOT / "apps/bff/Dockerfile").read_text()
    if not _imports_city_guard():
        assert "city-guard" not in dockerfile.lower().replace("_", "-")
    assert "city-guard" not in (DEPLOY / "build-mobile.sh").read_text() or _imports_city_guard()


def test_build_script_needs_no_extra_folders():
    text = (DEPLOY / "build-mobile.sh").read_text()
    assert "--city-guard" not in text and "CITY_GUARD" not in text
