"""Служебные команды сопровождения.

    python -m app.cli set-role <email> admin   # назначить администратора (управляет справочниками)
    python -m app.cli set-role <email> user    # снять права администратора
    python -m app.cli purge-tokens             # удалить просроченные токены"""
import argparse
import sys
from datetime import datetime, timezone

from sqlalchemy import delete, select

from .db import SessionLocal
from .models import AuthToken, User


def main() -> int:
    p = argparse.ArgumentParser(description="Сопровождение АС «БЖА»")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("set-role", help="изменить роль пользователя")
    r.add_argument("email")
    r.add_argument("role", choices=["user", "admin"])
    sub.add_parser("purge-tokens", help="удалить просроченные токены")
    args = p.parse_args()

    with SessionLocal() as db:
        if args.cmd == "set-role":
            user = db.scalar(select(User).where(User.email == args.email.strip().lower()))
            if user is None:
                print(f"Пользователь {args.email} не найден", file=sys.stderr)
                return 1
            user.role = args.role
            db.commit()
            print(f"{user.email}: роль {user.role}")
        elif args.cmd == "purge-tokens":
            n = db.execute(delete(AuthToken).where(AuthToken.expires_at <= datetime.now(timezone.utc))).rowcount
            db.commit()
            print(f"Удалено токенов: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
