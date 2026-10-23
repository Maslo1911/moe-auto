"""Методы 1–4: регистрация, вход, выход, текущий пользователь (функции 1, 2 ТЗ)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import bearer_token, current_user, json_body
from ..errors import ApiError
from ..models import AuthToken, User
from ..security import hash_password, new_token, token_expiry, token_hash, verify_password
from ..services import iso_utc, user_view
from ..validation import validate_register

router = APIRouter(prefix="/auth", tags=["Аутентификация"])


def issue_token(db: Session, user: User) -> dict:
    tok = new_token()
    expires = token_expiry()
    # Заодно убираем просроченные токены пользователя, чтобы таблица не росла
    db.execute(delete(AuthToken).where(AuthToken.user_id == user.id, AuthToken.expires_at <= datetime.now(timezone.utc)))
    db.add(AuthToken(user_id=user.id, token_hash=token_hash(tok), expires_at=expires))
    db.commit()
    return {"token": tok, "expires_at": iso_utc(expires), "user": user_view(user)}


@router.post("/register", status_code=201)
def register(body: dict = Depends(json_body), db: Session = Depends(get_db)):
    data = validate_register(body)
    taken = ApiError(409, "EMAIL_TAKEN", "Пользователь с таким e-mail уже зарегистрирован",
                     {"email": "Этот e-mail уже зарегистрирован. Войдите или укажите другой"})
    if db.scalar(select(User.id).where(User.email == data["email"])) is not None:
        raise taken
    user = User(email=data["email"], password_hash=hash_password(data["password"]), name=data["name"])
    db.add(user)
    try:
        db.flush()
    except IntegrityError:  # одновременная регистрация с тем же e-mail
        db.rollback()
        raise taken
    db.refresh(user)
    return issue_token(db, user)


@router.post("/login")
def login(body: dict = Depends(json_body), db: Session = Depends(get_db)):
    email = body.get("email")
    password = body.get("password")
    email = email.strip().lower() if isinstance(email, str) else ""
    password = password if isinstance(password, str) else ""
    user = db.scalar(select(User).where(User.email == email)) if email else None
    # Пароль проверяется и для несуществующего e-mail — по времени ответа нельзя понять, есть ли такой пользователь
    if not verify_password(user.password_hash if user else None, password) or user is None:
        raise ApiError(401, "INVALID_CREDENTIALS", "Неверный e-mail или пароль")
    return issue_token(db, user)


@router.post("/logout", status_code=204)
def logout(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(delete(AuthToken).where(AuthToken.token_hash == token_hash(bearer_token(request))))
    db.commit()
    return Response(status_code=204)


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_view(user)

