"""Методы 19–23: журнал заправок (функции 6, 7 ТЗ)."""
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, json_body, owned_car, parse_id
from ..errors import invalid, not_found
from ..models import Car, Refuel, User
from ..services import check_mileage, money, refuel_view
from ..validation import q_int, q_page, q_period, validate_refuel

router = APIRouter(prefix="/cars/{car_id}/refuels", tags=["Журнал заправок"])

SORTS = {
    "date_desc": (Refuel.date.desc(), Refuel.mileage.desc(), Refuel.id.desc()),
    "date_asc": (Refuel.date.asc(), Refuel.mileage.asc(), Refuel.id.asc()),
}


def owned_refuel(db: Session, car: Car, refuel_id: str) -> Refuel:
    rid = parse_id(refuel_id)
    r = db.scalar(select(Refuel).where(Refuel.id == rid, Refuel.car_id == car.id)) if rid else None
    if r is None:
        raise not_found()
    return r


@router.get("")
def list_refuels(car_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    car = owned_car(db, user, car_id)
    q = dict(request.query_params)
    f: dict[str, str] = {}
    d_from, d_to = q_period(q, f)
    ft_id = q_int(q, "fuel_type_id", f, lo=1, msg="Выберите вид топлива из списка")
    sort = q.get("sort") or "date_desc"
    if sort not in SORTS:
        f["sort"] = "Допустимо date_desc или date_asc"
    limit, offset = q_page(q, f)
    if f:
        raise invalid(f)

    cond = [Refuel.car_id == car.id]
    if ft_id is not None:
        cond.append(Refuel.fuel_type_id == ft_id)
    if d_from:
        cond.append(Refuel.date >= d_from)
    if d_to:
        cond.append(Refuel.date <= d_to)

    count, volume, amount = db.execute(
        select(func.count(), func.coalesce(func.sum(Refuel.volume), 0), func.coalesce(func.sum(Refuel.amount), 0))
        .where(*cond)
    ).one()
    items = db.scalars(select(Refuel).where(*cond).order_by(*SORTS[sort]).limit(limit).offset(offset)).all()
    return {
        "items": [refuel_view(r) for r in items],
        "total_count": count,
        "sum": {"volume": money(volume), "amount": money(amount)},
    }


@router.post("", status_code=201)
def create_refuel(car_id: str, body: dict = Depends(json_body), user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    car = owned_car(db, user, car_id, lock=True)
    data = validate_refuel(db, body)
    check_mileage(db, car, data["date"], data["mileage"])
    r = Refuel(car_id=car.id, **data)
    db.add(r)
    db.commit()
    db.refresh(r)  # сумму (amount) вычислила СУБД
    return refuel_view(r)


@router.get("/{refuel_id}")
def get_refuel(car_id: str, refuel_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return refuel_view(owned_refuel(db, owned_car(db, user, car_id), refuel_id))


@router.put("/{refuel_id}")
def update_refuel(car_id: str, refuel_id: str, body: dict = Depends(json_body), user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    car = owned_car(db, user, car_id, lock=True)
    r = owned_refuel(db, car, refuel_id)
    data = validate_refuel(db, body)
    check_mileage(db, car, data["date"], data["mileage"], "refuel", r.id)
    for k, v in data.items():
        setattr(r, k, v)
    db.commit()
    db.refresh(r)
    return refuel_view(r)


@router.delete("/{refuel_id}", status_code=204)
def delete_refuel(car_id: str, refuel_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(owned_refuel(db, owned_car(db, user, car_id), refuel_id))
    db.commit()
    return Response(status_code=204)
