"""Бизнес-правила (п. 4.3.1 ТЗ): контроль пробега, итоги, средний расход; представление объектов в JSON."""
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, literal, literal_column, select, union_all
from sqlalchemy.orm import Session

from .errors import ApiError
from .models import Car, FuelType, Refuel, Repair, RepairCategory, User
from .validation import fmt_km, today


def money(v: Decimal | int | None) -> float:
    return float(Decimal(v or 0).quantize(Decimal("0.01")))


def iso_utc(dt: datetime) -> str:
    """Служебная метка времени в формате YYYY-MM-DDTHH:MM:SSZ (п. 1 docs/API.md)."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------- Представление объектов ----------------

def user_view(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "registered_at": iso_utc(u.registered_at)}


def dict_view(x: RepairCategory | FuelType) -> dict:
    return {"id": x.id, "name": x.name}


def _records_union(car_ids):
    rep = select(Repair.car_id, Repair.date, Repair.mileage, literal("repair").label("type")).where(Repair.car_id.in_(car_ids))
    ref = select(Refuel.car_id, Refuel.date, Refuel.mileage, literal("refuel").label("type")).where(Refuel.car_id.in_(car_ids))
    return union_all(rep, ref).subquery()


def car_stats(db: Session, car_ids: list[int]) -> dict[int, dict]:
    """Текущий пробег, дата последней записи и число записей — одним запросом для нескольких автомобилей."""
    if not car_ids:
        return {}
    u = _records_union(car_ids)
    rows = db.execute(
        select(u.c.car_id, func.max(u.c.mileage), func.max(u.c.date),
               func.count().filter(u.c.type == "repair"), func.count().filter(u.c.type == "refuel"))
        .group_by(u.c.car_id)
    ).all()
    return {r[0]: {"current_mileage": r[1], "last_record_date": r[2], "repairs_count": r[3], "refuels_count": r[4]} for r in rows}


def car_view(c: Car, stats: dict | None) -> dict:
    s = stats or {}
    last = s.get("last_record_date")
    return {
        "id": c.id, "brand": c.brand, "model": c.model, "year": c.year, "plate_number": c.plate_number, "vin": c.vin,
        "initial_mileage": c.initial_mileage,
        # Текущий пробег — по последней записи (ф. 7 ТЗ); без записей — начальный
        "current_mileage": s["current_mileage"] if last else c.initial_mileage,
        "last_record_date": last.isoformat() if last else None,
        "repairs_count": s.get("repairs_count", 0), "refuels_count": s.get("refuels_count", 0),
        "created_at": iso_utc(c.created_at),
    }


def car_full_view(db: Session, c: Car) -> dict:
    return car_view(c, car_stats(db, [c.id]).get(c.id))


def repair_view(r: Repair) -> dict:
    return {
        "id": r.id, "car_id": r.car_id, "date": r.date.isoformat(), "mileage": r.mileage,
        "category": dict_view(r.category), "description": r.description, "place": r.place or "",
        "labor_cost": money(r.labor_cost), "parts_cost": money(r.parts_cost),
        "total_cost": money(r.labor_cost + r.parts_cost),
    }


def refuel_view(r: Refuel) -> dict:
    return {
        "id": r.id, "car_id": r.car_id, "date": r.date.isoformat(), "mileage": r.mileage, "station": r.station or "",
        "fuel_type": dict_view(r.fuel_type), "volume": money(r.volume), "price_per_liter": money(r.price_per_liter),
        "amount": money(r.amount), "full_tank": r.full_tank,
    }


def refuel_title(r: Refuel) -> str:
    vol = f"{r.volume:.2f}".replace(".", ",")
    parts = [r.station.split(",")[0].strip()] if r.station else []
    return ", ".join(parts + [r.fuel_type.name, f"{vol} л"])


# ---------------- Контроль пробега ----------------

def mileage_range(db: Session, car: Car, d: date, exclude_type: str | None = None, exclude_id: int | None = None) -> dict:
    """Допустимый пробег записи с датой d: не меньше пробега любой более ранней записи и начального пробега,
    не больше пробега любой более поздней записи (п. 4.3.1). exclude_* — сама редактируемая запись."""
    def scoped(model, kind):
        cond = [model.car_id == car.id]
        if exclude_type == kind and exclude_id is not None:
            cond.append(model.id != exclude_id)
        return cond

    lo = [select(func.max(m.mileage)).where(*scoped(m, k), m.date < d).scalar_subquery()
          for m, k in ((Repair, "repair"), (Refuel, "refuel"))]
    hi = [select(func.min(m.mileage)).where(*scoped(m, k), m.date > d).scalar_subquery()
          for m, k in ((Repair, "repair"), (Refuel, "refuel"))]
    row = db.execute(select(func.greatest(car.initial_mileage, *lo), func.least(*hi))).one()
    return {"date": d.isoformat(), "min": row[0], "max": row[1]}


def check_mileage(db: Session, car: Car, d: date, mileage: int, exclude_type: str | None = None,
                  exclude_id: int | None = None) -> None:
    rg = mileage_range(db, car, d, exclude_type, exclude_id)
    if mileage < rg["min"] or (rg["max"] is not None and mileage > rg["max"]):
        if rg["max"] is None:
            msg = f"Пробег не может быть меньше {fmt_km(rg['min'])} км — это пробег предыдущей записи" \
                if rg["min"] > car.initial_mileage else \
                f"Пробег не может быть меньше {fmt_km(rg['min'])} км — начального пробега автомобиля"
        else:
            msg = f"Пробег должен быть от {fmt_km(rg['min'])} до {fmt_km(rg['max'])} км — между соседними записями"
        raise ApiError(422, "MILEAGE_CONFLICT", "Пробег противоречит другим записям", {"mileage": msg})


def earliest_record_mileage(db: Session, car_id: int) -> int | None:
    u = _records_union([car_id])
    return db.scalar(select(func.min(u.c.mileage)))


# ---------------- Итоги ----------------

def _months(start: date, end: date) -> list[str]:
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def avg_consumption(refuels: list[tuple[int, Decimal, bool]]) -> float | None:
    """Q = ΣV / ΔL × 100 (п. 4.3.1). refuels — (пробег, объём, полный бак) по возрастанию пробега.
    ΣV — топливо после первой заправки «до полного бака» до последней такой заправки включительно,
    ΔL — пробег между ними. Меньше двух полных заправок — расход не считается."""
    full = [i for i, r in enumerate(refuels) if r[2]]
    if len(full) < 2:
        return None
    a, b = full[0], full[-1]
    dl = refuels[b][0] - refuels[a][0]
    if dl <= 0:
        return None
    vol = sum((r[1] for r in refuels[a + 1:b + 1]), Decimal(0))
    return money(vol / dl * 100)


def summary(db: Session, car: Car, d_from: date | None, d_to: date | None) -> dict:
    def period(model):
        cond = [model.car_id == car.id]
        if d_from:
            cond.append(model.date >= d_from)
        if d_to:
            cond.append(model.date <= d_to)
        return cond

    rep_cost = Repair.labor_cost + Repair.parts_cost
    repairs_total, rep_min, rep_max, rep_first = db.execute(
        select(func.coalesce(func.sum(rep_cost), 0), func.min(Repair.mileage), func.max(Repair.mileage), func.min(Repair.date))
        .where(*period(Repair))
    ).one()
    fuel_total, fuel_volume, ref_min, ref_max, ref_first = db.execute(
        select(func.coalesce(func.sum(Refuel.amount), 0), func.coalesce(func.sum(Refuel.volume), 0),
               func.min(Refuel.mileage), func.max(Refuel.mileage), func.min(Refuel.date))
        .where(*period(Refuel))
    ).one()

    kms = [x for x in (rep_min, rep_max, ref_min, ref_max) if x is not None]
    distance = max(kms) - min(kms) if kms else 0
    total = Decimal(repairs_total) + Decimal(fuel_total)

    refuels = db.execute(
        select(Refuel.mileage, Refuel.volume, Refuel.full_tank).where(*period(Refuel))
        .order_by(Refuel.mileage, Refuel.date, Refuel.id)
    ).all()

    by_category = [
        {"category": {"id": cid, "name": name}, "total": money(t), "count": n}
        for cid, name, t, n in db.execute(
            select(RepairCategory.id, RepairCategory.name, func.sum(rep_cost), func.count())
            .join(Repair, Repair.category_id == RepairCategory.id).where(*period(Repair))
            .group_by(RepairCategory.id, RepairCategory.name).order_by(func.sum(rep_cost).desc(), RepairCategory.id)
        ).all()
    ]

    # Формат — литералом, а не параметром: иначе PostgreSQL не сопоставит выражение в SELECT и GROUP BY
    month = lambda col: func.to_char(col, literal_column("'YYYY-MM'"))  # noqa: E731
    rep_m = dict(db.execute(select(month(Repair.date), func.sum(rep_cost)).where(*period(Repair)).group_by(month(Repair.date))).all())
    ref_m = dict(db.execute(select(month(Refuel.date), func.sum(Refuel.amount)).where(*period(Refuel)).group_by(month(Refuel.date))).all())
    firsts = [x for x in (rep_first, ref_first) if x is not None]
    start = d_from or (min(firsts) if firsts else today())
    end = d_to or today()
    by_month = [{"month": m, "repairs": money(rep_m.get(m)), "fuel": money(ref_m.get(m))} for m in _months(start, end)]

    return {
        "car_id": car.id,
        "date_from": d_from.isoformat() if d_from else None,
        "date_to": d_to.isoformat() if d_to else None,
        "repairs_total": money(repairs_total),
        "fuel_total": money(fuel_total),
        "total": money(total),
        "fuel_volume": money(fuel_volume),
        "distance": distance,
        "avg_consumption": avg_consumption([(r[0], r[1], r[2]) for r in refuels]),
        "cost_per_km": money(total / distance) if distance else None,
        "by_category": by_category,
        "by_month": by_month,
    }
