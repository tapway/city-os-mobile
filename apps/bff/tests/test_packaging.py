"""Packaging guards for the BFF."""
import tomllib
from pathlib import Path

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def test_bff_does_not_require_city_guard():
    # No module under src/ imports city_guard, and the private git dependency
    # made `pip install -e apps/bff` fail in CI (no access to tapway/city-guard).
    deps = tomllib.loads(PYPROJECT.read_text())["project"]["dependencies"]
    assert not [d for d in deps if d.replace("_", "-").startswith("city-guard")]
