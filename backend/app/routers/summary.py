"""Метод 24: итоговые суммы и средний расход за период (функция 9 ТЗ)."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, owned_car
from ..errors import invalid
from ..models import User
from ..services import summary
from ..validation import q_period

router = APIRouter(tags=["Итоги"])


@router.get("/cars/{car_id}/summary")
def get_summary(car_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    car = owned_car(db, user, car_id)
    f: dict[str, str] = {}
    d_from, d_to = q_period(dict(request.query_params), f)
    if f:
        raise invalid(f)
    return summary(db, car, d_from, d_to)
