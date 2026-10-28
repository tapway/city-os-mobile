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
    # Compose and the Dockerfile must probe that route on the port uvicorn serves.
    compose_probe = " ".join(_compose()["services"]["bff"]["healthcheck"]["test"])
    dockerfile = (ROOT / "apps/bff/Dockerfile").read_text()
    for text in (compose_probe, dockerfile):
        assert re.search(r"127\.0\.0\.1:8002/health\b", text)


def test_cookie_secure_defaults_to_true():
    assert _compose()["services"]["bff"]["environment"]["COOKIE_SECURE"] == "${COOKIE_SECURE:-true}"


def test_host_gateway_alias_is_opt_in():
    assert "extra_hosts" not in _compose()["services"]["bff"]


def test_bff_hides_server_header_and_trusts_proxy_headers():
    dockerfile = (ROOT / "apps/bff/Dockerfile").read_text()
    for flag in ("--proxy-headers", "--no-server-header"):
        assert flag in dockerfile


def test_pwa_headers_ship_csp_report_only_not_enforcing():
    conf = (ROOT / "apps/pwa/docker/security-headers.conf").read_text()
    active = [l for l in conf.splitlines() if l.strip().startswith("add_header")]
    names = {l.split()[1] for l in active}
    assert "Content-Security-Policy-Report-Only" in names
    assert "Content-Security-Policy" not in names  # enforcing is a deliberate follow-up
    assert "Permissions-Policy" in names


def test_nginx_config_is_valid():
    import shutil

    image = "nginxinc/nginx-unprivileged:1.27-alpine"
    if not shutil.which("docker"):
        pytest.skip("docker not available: nginx -t not run")
    if subprocess.run(["docker", "image", "inspect", image], capture_output=True).returncode != 0:
        pytest.skip(f"{image} not present locally: nginx -t not run")
    conf = ROOT / "apps/pwa/docker"
    proc = subprocess.run(
        ["docker", "run", "--rm", "--entrypoint", "nginx",
         "-v", f"{conf}/nginx.conf:/etc/nginx/conf.d/default.conf:ro",
         "-v", f"{conf}/security-headers.conf:/etc/nginx/snippets/security-headers.conf:ro",
         image, "-t"],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr


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


# ---- build-mobile.sh tag handling, exercised against a stub `docker` ----------
import os
import stat
import tempfile

STUB = """#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
case "$1 $2" in
  "image inspect")
    ref="$3"
    case ",$STUB_EXISTING," in *",$ref,"*) exit 0 ;; esac
    case "$ref" in node:*|nginxinc/*|python:*) echo "x@sha256:0" ; exit 0 ;; esac
    exit 1 ;;
esac
if [ "$1" = build ]; then
  case "$*" in *"$STUB_FAIL_BUILD"*) [ -n "$STUB_FAIL_BUILD" ] && exit 1 ;; esac
fi
exit 0
"""


def _run_build(existing="", fail_build="", tag="t1"):
    with tempfile.TemporaryDirectory() as tmp:
        bindir = Path(tmp, "bin")
        bindir.mkdir()
        docker = bindir / "docker"
        docker.write_text(STUB)
        docker.chmod(docker.stat().st_mode | stat.S_IEXEC)
        log = Path(tmp, "calls.log")
        log.write_text("")
        env = {
            **os.environ,
            "PATH": f"{bindir}:{os.environ['PATH']}",
            "STUB_LOG": str(log),
            "STUB_EXISTING": existing,
            "STUB_FAIL_BUILD": fail_build,
            "TMPDIR": tmp,
        }
        proc = subprocess.run(
            ["bash", str(DEPLOY / "build-mobile.sh"), "--tag", tag],
            env=env, capture_output=True, text=True, cwd=ROOT,
        )
        calls = [l for l in log.read_text().splitlines() if not l.startswith("image inspect")]
        return proc, calls


PWA = "tapway/city-os-mobile-pwa"
BFF = "tapway/city-os-mobile-bff"


@pytest.mark.parametrize("existing", [f"{PWA}:t1", f"{BFF}:t1", f"{PWA}:pre-t1", f"{BFF}:pre-t1"])
def test_build_refuses_when_the_tag_or_its_rollback_tag_exists(existing):
    proc, calls = _run_build(existing=existing)
    assert proc.returncode != 0
    assert "already exists" in proc.stderr and "docker rmi" in proc.stderr
    assert calls == []  # nothing built, nothing tagged


def test_build_moves_no_tag_when_a_build_fails():
    proc, calls = _run_build(existing=f"{PWA}:latest,{BFF}:latest", fail_build="city-os-mobile-bff")
    assert proc.returncode != 0
    assert not [c for c in calls if c.startswith("tag ")]


def test_build_builds_both_then_retags_rollback_then_latest():
    proc, calls = _run_build(existing=f"{PWA}:latest,{BFF}:latest")
    assert proc.returncode == 0, proc.stderr
    builds = [i for i, c in enumerate(calls) if c.startswith("build ")]
    tags = [i for i, c in enumerate(calls) if c.startswith("tag ")]
    assert len(builds) == 2 and len(tags) == 4
    assert max(builds) < min(tags)
    assert all(":latest" not in calls[i] for i in builds)  # builds carry only :<tag>
    assert tags == sorted(tags)
    tag_calls = [calls[i] for i in tags]
    assert tag_calls[:2] == [f"tag {PWA}:latest {PWA}:pre-t1", f"tag {BFF}:latest {BFF}:pre-t1"]
    assert tag_calls[2:] == [f"tag {PWA}:t1 {PWA}:latest", f"tag {BFF}:t1 {BFF}:latest"]
