"""Shared test fixtures.

Settings are mutated by several tests (origins, upload limits, storage). This
autouse fixture snapshots and restores them so one test cannot change what
another one sees.
"""
import pytest

from src.settings import Settings, settings


@pytest.fixture(autouse=True)
def restore_settings():
    snapshot = {k: getattr(settings, k) for k in Settings.model_fields}
    yield
    for key, value in snapshot.items():
        setattr(settings, key, value)