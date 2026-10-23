"""Методы 14–18: журнал ремонтов и поиск по ремонтам (функции 5, 7, 8 ТЗ)."""
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, json_body, owned_car, parse_id
from ..errors import invalid, not_found
from ..models import Car, Repair, User
from ..services import check_mileage, money, repair_view
from ..validation import q_int, q_page, q_period, validate_repair

router = APIRouter(prefix="/cars/{car_id}/repairs", tags=["Журнал ремонтов"])

SORTS = {
    "date_desc": (Repair.date.desc(), Repair.mileage.desc(), Repair.id.desc()),
    "date_asc": (Repair.date.asc(), Repair.mileage.asc(), Repair.id.asc()),
    "cost_desc": ((Repair.labor_cost + Repair.parts_cost).desc(), Repair.date.desc(), Repair.id.desc()),
}


def _like_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def owned_repair(db: Session, car: Car, repair_id: str) -> Repair:
    rid = parse_id(repair_id)
    r = db.scalar(select(Repair).where(Repair.id == rid, Repair.car_id == car.id)) if rid else None
    if r is None:
        raise not_found()
    return r


@router.get("")
def list_repairs(car_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    car = owned_car(db, user, car_id)
    q = dict(request.query_params)
    f: dict[str, str] = {}
    d_from, d_to = q_period(q, f)
    cat_id = q_int(q, "category_id", f, lo=1, msg="Выберите категорию из списка")
    km_from = q_int(q, "mileage_from", f, msg="Пробег — целое число от 0")
    km_to = q_int(q, "mileage_to", f, msg="Пробег — целое число от 0")
    sort = q.get("sort") or "date_desc"
    if sort not in SORTS:
        f["sort"] = "Допустимо date_desc, date_asc или cost_desc"
    limit, offset = q_page(q, f)
    if f:
        raise invalid(f)

    cond = [Repair.car_id == car.id]
    text = (q.get("q") or "").strip()
    if text:
        pattern = f"%{_like_escape(text)}%"
        cond.append(or_(Repair.description.ilike(pattern, escape="\\"), Repair.place.ilike(pattern, escape="\\")))
    if cat_id is not None:
        cond.append(Repair.category_id == cat_id)
    if d_from:
        cond.append(Repair.date >= d_from)
    if d_to:
        cond.append(Repair.date <= d_to)
    if km_from is not None:
        cond.append(Repair.mileage >= km_from)
    if km_to is not None:
        cond.append(Repair.mileage <= km_to)

    # Сумма — по всем найденным записям, а не только по странице
    count, labor, parts = db.execute(
        select(func.count(), func.coalesce(func.sum(Repair.labor_cost), 0), func.coalesce(func.sum(Repair.parts_cost), 0))
        .where(*cond)
    ).one()
    items = db.scalars(select(Repair).where(*cond).order_by(*SORTS[sort]).limit(limit).offset(offset)).all()
    return {
        "items": [repair_view(r) for r in items],
        "total_count": count,
        "sum": {"labor_cost": money(labor), "parts_cost": money(parts), "total_cost": money(labor + parts)},
    }


@router.post("", status_code=201)
def create_repair(car_id: str, body: dict = Depends(json_body), user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    car = owned_car(db, user, car_id, lock=True)
    data = validate_repair(db, body)
    check_mileage(db, car, data["date"], data["mileage"])
    r = Repair(car_id=car.id, **data)
    db.add(r)
    db.commit()
    db.refresh(r)
    return repair_view(r)


@router.get("/{repair_id}")
def get_repair(car_id: str, repair_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return repair_view(owned_repair(db, owned_car(db, user, car_id), repair_id))


@router.put("/{repair_id}")
def update_repair(car_id: str, repair_id: str, body: dict = Depends(json_body), user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    car = owned_car(db, user, car_id, lock=True)
    r = owned_repair(db, car, repair_id)
    data = validate_repair(db, body)
    check_mileage(db, car, data["date"], data["mileage"], "repair", r.id)
    for k, v in data.items():
        setattr(r, k, v)
    db.commit()
    db.refresh(r)
    return repair_view(r)


@router.delete("/{repair_id}", status_code=204)
def delete_repair(car_id: str, repair_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(owned_repair(db, owned_car(db, user, car_id), repair_id))
    db.commit()
    return Response(status_code=204)
