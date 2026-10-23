"""Настройки приложения из переменных окружения (и файла .env)."""
import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _list(value: str) -> list[str]:
    return [x.strip() for x in value.split(",") if x.strip()]


def normalize_database_url(url: str) -> str:
    """Строку подключения в том виде, в каком её выдают Neon, Render и другие хостинги
    (postgres://… или postgresql://…), переводим на драйвер psycopg 3: postgresql+psycopg://…
    Параметры вроде ?sslmode=require сохраняются."""
    url = url.strip()
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@dataclass(frozen=True)
class Settings:
    database_url: str = normalize_database_url(
        os.getenv("DATABASE_URL", "postgresql+psycopg://bja:bja@localhost:5432/bja"))
    secret_key: str = os.getenv("SECRET_KEY", "dev-secret-change-me")
    # Срок действия токена, часы (п. 1 docs/API.md — 24 часа)
    token_ttl_hours: int = int(os.getenv("TOKEN_TTL", "24"))
    # Часовой пояс, по которому определяется «сегодня» при проверке дат записей
    timezone: ZoneInfo = field(default_factory=lambda: ZoneInfo(os.getenv("APP_TIMEZONE", "Europe/Moscow")))
    # Разрешённые адреса сайта для CORS, через запятую. Пусто — CORS выключен (сайт и API на одном адресе)
    cors_origins: list[str] = field(default_factory=lambda: _list(os.getenv("CORS_ORIGINS", "")))
    # Папка фронтенда: если задана, бэкенд отдаёт сайт на «/» (удобно для разработки и docker compose)
    frontend_dir: str = os.getenv("FRONTEND_DIR", "")
    # Сервисный режим (п. 4.1.4 ТЗ): пока файл существует, API отвечает 503 MAINTENANCE
    maintenance_file: Path = Path(os.getenv("MAINTENANCE_FILE", str(BASE_DIR / "maintenance.on")))
    log_dir: Path = Path(os.getenv("LOG_DIR", str(BASE_DIR / "logs")))
    log_level: str = os.getenv("LOG_LEVEL", "INFO")


settings = Settings()
