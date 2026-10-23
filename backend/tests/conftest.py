"""Тесты идут на отдельной БД (TEST_DATABASE_URL, по умолчанию bja_test на том же сервере).
БД создаётся при необходимости, схема — миграциями, перед каждым тестом данные очищаются."""
import os
import tempfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

TEST_URL = os.getenv("TEST_DATABASE_URL", "postgresql+psycopg://bja:bja@localhost:5432/bja_test")
os.environ["DATABASE_URL"] = TEST_URL
os.environ["FRONTEND_DIR"] = ""
os.environ["LOG_DIR"] = tempfile.mkdtemp(prefix="bja-logs-")
os.environ["MAINTENANCE_FILE"] = str(Path(tempfile.mkdtemp(prefix="bja-mnt-")) / "maintenance.on")

BACKEND = Path(__file__).resolve().parent.parent


def _ensure_database() -> None:
    url = make_url(TEST_URL)
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        if not conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": url.database}):
            conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    admin.dispose()


@pytest.fixture(scope="session", autouse=True)
def database():
    _ensure_database()
    from alembic import command
    from alembic.config import Config
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.set_main_option("sqlalchemy.url", TEST_URL)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    from app.db import SessionLocal
    from app.seed import seed_dictionaries
    with SessionLocal() as db:
        seed_dictionaries(db)
    yield


@pytest.fixture(autouse=True)
def clean(database):
    from app.db import engine
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE users RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app, base_url="http://testserver/api/v1") as c:
        yield c


def register(client, email="ivan@example.ru", password="qwerty123", name="Иван"):
    r = client.post("/auth/register", json={"email": email, "password": password, "name": name})
    assert r.status_code == 201, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


@pytest.fixture
def auth(client):
    return register(client)


@pytest.fixture
def car(client, auth):
    r = client.post("/cars", headers=auth, json={"brand": "Lada", "model": "Vesta", "year": 2019,
                                                 "plate_number": "а 123 вс 77", "vin": None, "initial_mileage": 45000})
    assert r.status_code == 201, r.text
    return r.json()
