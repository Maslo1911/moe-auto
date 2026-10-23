"""Методы 7–13: автомобили, лента записей, допустимый пробег (функции 3, 4, 7 ТЗ)."""
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, json_body, owned_car, parse_id
from ..errors import ApiError, invalid
from ..models import Car, Refuel, Repair, User
from ..services import (
    car_full_view, car_stats, car_view, earliest_record_mileage, mileage_range, money, refuel_title,
)
from ..validation import fmt_km, q_date, q_int, validate_car

router = APIRouter(prefix="/cars", tags=["Автомобили"])

MAX_CARS = 10  # п. 4.4.2 ТЗ


@router.get("")
def list_cars(user: User = Depends(current_user), db: Session = Depends(get_db)):
    cars = db.scalars(select(Car).where(Car.user_id == user.id).order_by(Car.created_at, Car.id)).all()
    stats = car_stats(db, [c.id for c in cars])
    return [car_view(c, stats.get(c.id)) for c in cars]


@router.post("", status_code=201)
def create_car(body: dict = Depends(json_body), user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = validate_car(body)
    # Блокируем строку пользователя, чтобы параллельные запросы не обошли лимит в 10 автомобилей
    db.execute(select(User.id).where(User.id == user.id).with_for_update())
    if db.scalar(select(func.count()).select_from(Car).where(Car.user_id == user.id)) >= MAX_CARS:
        raise invalid({"limit": f"Можно добавить не больше {MAX_CARS} автомобилей"})
    car = Car(user_id=user.id, **data)
    db.add(car)
    db.commit()
    db.refresh(car)
    return car_view(car, None)


@router.get("/{car_id}")
def get_car(car_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return car_full_view(db, owned_car(db, user, car_id))


@router.put("/{car_id}")
def update_car(car_id: str, body: dict = Depends(json_body), user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    car = owned_car(db, user, car_id, lock=True)
    data = validate_car(body)
    earliest = earliest_record_mileage(db, car.id)
    if earliest is not None and data["initial_mileage"] > earliest:
        raise ApiError(422, "MILEAGE_CONFLICT", "Начальный пробег больше пробега в записях", {
            "initial_mileage": f"Начальный пробег не может быть больше {fmt_km(earliest)} км — пробега самой ранней записи"})
    for k, v in data.items():
        setattr(car, k, v)
    db.commit()
    return car_full_view(db, car)


@router.delete("/{car_id}", status_code=204)
def delete_car(car_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    # Ремонты и заправки удаляются каскадно внешними ключами (ON DELETE CASCADE)
    db.delete(owned_car(db, user, car_id))
    db.commit()
    return Response(status_code=204)


@router.get("/{car_id}/records")
def records(car_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    car = owned_car(db, user, car_id)
    f: dict[str, str] = {}
    limit = q_int(dict(request.query_params), "limit", f, default=5, lo=1, hi=50, msg="limit — от 1 до 50")
    if f:
        raise invalid(f)
    reps = db.scalars(select(Repair).where(Repair.car_id == car.id)
                      .order_by(Repair.date.desc(), Repair.mileage.desc(), Repair.id.desc()).limit(limit)).all()
    refs = db.scalars(select(Refuel).where(Refuel.car_id == car.id)
                      .order_by(Refuel.date.desc(), Refuel.mileage.desc(), Refuel.id.desc()).limit(limit)).all()
    items = [{"type": "repair", "id": r.id, "date": r.date, "mileage": r.mileage, "title": r.description,
              "category": r.category.name, "amount": money(r.labor_cost + r.parts_cost)} for r in reps]
    items += [{"type": "refuel", "id": r.id, "date": r.date, "mileage": r.mileage, "title": refuel_title(r),
               "category": "полный бак" if r.full_tank else "долив", "amount": money(r.amount)} for r in refs]
    items.sort(key=lambda x: (x["date"], x["mileage"]), reverse=True)
    for x in items:
        x["date"] = x["date"].isoformat()
    return {"items": items[:limit]}


@router.get("/{car_id}/mileage-range")
def get_mileage_range(car_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    car = owned_car(db, user, car_id)
    q = dict(request.query_params)
    f: dict[str, str] = {}
    d = q_date(q, "date", f)
    if d is None and "date" not in f:
        f["date"] = "Укажите дату"
    ex_type = q.get("exclude_type") or None
    if ex_type not in (None, "repair", "refuel"):
        f["exclude_type"] = "Допустимо repair или refuel"
    ex_id = parse_id((q.get("exclude_id") or "").strip()) if q.get("exclude_id") else None
    if f:
        raise invalid(f)
    return mileage_range(db, car, d, ex_type, ex_id)
