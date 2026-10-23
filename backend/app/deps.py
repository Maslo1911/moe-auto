"""Общие зависимости обработчиков: текущий пользователь, тело запроса, проверка владельца."""
import json
from datetime import datetime, timezone

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .errors import ApiError, forbidden, not_found, unauthorized
from .models import AuthToken, Car, User
from .security import token_hash
from .validation import MAX_ID


def bearer_token(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    scheme, _, value = auth.partition(" ")
    return value.strip() if scheme.lower() == "bearer" and value.strip() else None


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    tok = bearer_token(request)
    if not tok:
        raise unauthorized()
    row = db.execute(
        select(User, AuthToken.expires_at).join(AuthToken, AuthToken.user_id == User.id)
        .where(AuthToken.token_hash == token_hash(tok))
    ).first()
    if row is None or row.expires_at <= datetime.now(timezone.utc):
        raise unauthorized()
    request.state.user_id = row.User.id
    return row.User


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise forbidden()
    return user


async def json_body(request: Request) -> dict:
    """Тело запроса как JSON-объект. Некорректный JSON — 400 (п. 1.1 docs/API.md)."""
    raw = await request.body()
    try:
        data = json.loads(raw or b"{}")
    except (ValueError, UnicodeDecodeError):
        raise ApiError(400, "BAD_REQUEST", "Тело запроса не является корректным JSON")
    if not isinstance(data, dict):
        raise ApiError(400, "BAD_REQUEST", "Ожидается JSON-объект")
    return data


def parse_id(raw: str) -> int | None:
    return int(raw) if raw.isdigit() and 0 < int(raw) <= MAX_ID else None


def owned_car(db: Session, user: User, car_id: str, *, lock: bool = False) -> Car:
    """Автомобиль текущего пользователя. Чужой автомобиль неотличим от несуществующего — 404 (п. 4.4.8 ТЗ).
    lock=True блокирует строку автомобиля до конца транзакции: параллельные записи одного автомобиля
    проверяют пробег по очереди и не обходят контроль пробега."""
    cid = parse_id(car_id)
    if cid is None:
        raise not_found("Автомобиль не найден")
    stmt = select(Car).where(Car.id == cid, Car.user_id == user.id)
    if lock:
        stmt = stmt.with_for_update()
    car = db.scalar(stmt)
    if car is None:
        raise not_found("Автомобиль не найден")
    return car
