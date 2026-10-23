"""Хэширование паролей (Argon2, п. 4.4.8 ТЗ) и токены доступа."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from .config import settings

_hasher = PasswordHasher()
# Хэш для несуществующего пользователя: вход проверяется за одинаковое время, есть e-mail в базе или нет
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """В БД хранится только HMAC токена: утечка таблицы не даёт войти от имени пользователя."""
    return hmac.new(settings.secret_key.encode(), token.encode(), hashlib.sha256).hexdigest()


def token_expiry() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=settings.token_ttl_hours)
