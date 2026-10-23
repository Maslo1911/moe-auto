"""Строка подключения к БД в форматах хостингов (Neon, Render)."""
import pytest

from app.config import normalize_database_url


@pytest.mark.parametrize("given, expected", [
    ("postgresql://u:p@ep-cool-1.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
     "postgresql+psycopg://u:p@ep-cool-1.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"),
    ("postgres://u:p@host:5432/db", "postgresql+psycopg://u:p@host:5432/db"),
    ("  postgresql://u:p@host/db\n", "postgresql+psycopg://u:p@host/db"),
    ("postgresql+psycopg://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
])
def test_normalize_database_url(given, expected):
    assert normalize_database_url(given) == expected
