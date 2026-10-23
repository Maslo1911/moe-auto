"""Заполнение справочников при развёртывании (п. 4.3.2 и раздел 8 ТЗ) и, по желанию, демо-данных.

    python -m app.seed            # справочники «Категории ремонта» и «Виды топлива»
    python -m app.seed --demo     # + демо-пользователь ivan.petrov@mail.ru / qwerty123 с двумя автомобилями

Команда повторяемая: существующие записи не дублируются."""
import argparse
import math
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import Car, FuelType, Refuel, Repair, RepairCategory, User
from .security import hash_password

REPAIR_CATEGORIES = ["ТО", "Двигатель", "Ходовая часть", "Тормозная система", "Электрика", "Кузов", "Шины", "Прочее"]
FUEL_TYPES = ["АИ-92", "АИ-95", "АИ-98", "ДТ", "Газ"]

DEMO_EMAIL = "ivan.petrov@mail.ru"
DEMO_PASSWORD = "qwerty123"


def seed_dictionaries(db: Session) -> None:
    for model, names in ((RepairCategory, REPAIR_CATEGORIES), (FuelType, FUEL_TYPES)):
        rows = [{"id": i, "name": n} for i, n in enumerate(names, start=1)]
        db.execute(insert(model).values(rows).on_conflict_do_nothing())
        # Последовательность id — после заданных вручную значений, чтобы администратор мог добавлять новые
        db.execute(select(func.setval(func.pg_get_serial_sequence(model.__tablename__, "id"),
                                      select(func.max(model.id)).scalar_subquery())))
    db.commit()


# ---------------- Демо-данные (как в frontend/js/mock-data.js) ----------------

def _rng(seed: int):
    """Детерминированный генератор mulberry32 — тот же, что в демо-режиме фронтенда."""
    state = [seed & 0xFFFFFFFF]

    def imul(a, b):
        return (a * b) & 0xFFFFFFFF

    def rand():
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rand


def _r2(x: float) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


STATIONS = ["Лукойл, Каширское ш., 61", "Роснефть, Варшавское ш., 132", "Газпромнефть, ул. Кировоградская, 2",
            "Лукойл, МКАД 33-й км", "Татнефть, Балаклавский пр-т, 7"]


def _simulate(seed, start, end, initial, daily, cons, tank, fuel_type, price, price_grow):
    rand = _rng(seed)
    km, fuel, st = initial, tank * 0.6, 0
    by_day, refuels = {}, []
    d, i = start, 0
    while d <= end:
        winter = d.month in (12, 1, 2)
        run = daily + daily * 0.38 * math.sin(i / 7) + (rand() - 0.5) * daily * 0.4
        if d.isoweekday() == 7 and rand() < 0.5:
            run *= 0.3
        run = max(0, round(run))
        km += run
        fuel -= run * (cons + (0.7 if winter else 0) + (rand() - 0.5) * 0.4) / 100
        if fuel < tank * 0.2:
            full = rand() < 0.84
            vol = float(_r2(tank - fuel - rand() * 0.6)) if full else float(_r2(18 + rand() * 12))
            months = (d - start).days / 30.4
            p = _r2(price + months * price_grow + (rand() - 0.5) * 0.9)
            station = STATIONS[(st + (2 if rand() < 0.3 else 0)) % len(STATIONS)]
            st += 1
            refuels.append(dict(date=d, mileage=km, station=station, fuel_type_id=fuel_type, volume=_r2(vol),
                                price_per_liter=p, full_tank=full))
            fuel = tank if full else fuel + vol
        by_day[d] = km
        d += timedelta(days=1)
        i += 1
    return by_day, refuels


def seed_demo(db: Session) -> bool:
    if db.scalar(select(User.id).where(User.email == DEMO_EMAIL)) is not None:
        return False
    user = User(email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD), name="Иван Петров",
                registered_at=datetime(2025, 1, 12, 9, 10, tzinfo=timezone.utc))
    db.add(user)
    db.flush()
    # Демо-журнал заканчивается вчерашним днём, чтобы итоги «за месяц» и «за год» были непустыми
    end = date.today() - timedelta(days=1)
    vesta = Car(user_id=user.id, brand="Lada", model="Vesta", year=2019, plate_number="А123ВС77",
                vin="XTAGFL110KY123456", initial_mileage=45000, created_at=datetime(2025, 1, 12, 9, 15, tzinfo=timezone.utc))
    solaris = Car(user_id=user.id, brand="Hyundai", model="Solaris", year=2017, plate_number="Е777КХ199",
                  vin=None, initial_mileage=98000, created_at=datetime(2026, 6, 1, 18, 40, tzinfo=timezone.utc))
    db.add_all([vesta, solaris])
    db.flush()

    v_km, v_ref = _simulate(7, date(2025, 1, 12), end, 45000, 50, 7.6, 55, 2, 55.4, 0.36)
    s_km, s_ref = _simulate(19, date(2026, 6, 1), end, 98000, 31, 7.1, 43, 1, 57.6, 0.3)

    motor = "СТО «Мотор», Варшавское ш., 118"
    koleso = "Шиномонтаж «Колесо», ул. Кировоградская, 9"
    v_repairs = [
        ("2025-01-25", 1, "ТО-4: замена масла, масляного и воздушного фильтров", motor, 2200, 4850),
        ("2025-04-12", 7, "Сезонная замена шин на летние, балансировка", koleso, 2400, 0),
        ("2025-06-21", 3, "Замена передних стоек стабилизатора", motor, 1500, 2380),
        ("2025-08-30", 1, "ТО-5: замена масла, фильтров и свечей зажигания", motor, 3100, 6900),
        ("2025-10-25", 7, "Сезонная замена шин на зимние, балансировка", koleso, 2400, 0),
        ("2025-12-13", 5, "Замена аккумулятора 60 А·ч", "Автомагазин на Чертановской, 32", 0, 7900),
        ("2026-03-07", 6, "Покраска переднего бампера после парковки", "Кузовной центр «Профи»", 9500, 1800),
        ("2026-04-11", 7, "Сезонная замена шин на летние, балансировка", koleso, 2600, 0),
        ("2026-04-19", 4, "Замена передних тормозных колодок и дисков", motor, 1800, 6400),
        ("2026-07-04", 8, "Замена щёток стеклоочистителя и лампы ближнего света", "Своими силами", 0, 1450),
        ("2026-08-22", 1, "ТО-6: замена масла, фильтров и тормозной жидкости", motor, 3600, 7250),
        ("2026-10-03", 2, "Замена ремня ГРМ, роликов и помпы", motor, 4800, 7600),
        ("2026-10-17", 7, "Сезонная замена шин на зимние, балансировка", koleso, 2600, 0),
    ]
    s_repairs = [
        ("2026-07-15", 1, "ТО: замена масла и фильтров", "Дилерский центр Hyundai, Каширское ш., 41", 2000, 4300),
        ("2026-09-20", 3, "Развал-схождение", koleso, 2200, 0),
    ]
    for car, by_day, plan in ((vesta, v_km, v_repairs), (solaris, s_km, s_repairs)):
        for day, cat, desc, place, labor, parts in plan:
            d = date.fromisoformat(day)
            if d in by_day:  # ремонты позже конца демо-журнала пропускаются
                db.add(Repair(car_id=car.id, date=d, mileage=by_day[d], category_id=cat, description=desc, place=place,
                              labor_cost=Decimal(labor), parts_cost=Decimal(parts)))
    for car, refs in ((vesta, v_ref), (solaris, s_ref)):
        db.add_all(Refuel(car_id=car.id, **r) for r in refs)
    db.commit()
    return True


def main() -> None:
    p = argparse.ArgumentParser(description="Заполнение справочников АС «БЖА»")
    p.add_argument("--demo", action="store_true", help=f"добавить демо-пользователя {DEMO_EMAIL} с данными")
    args = p.parse_args()
    with SessionLocal() as db:
        seed_dictionaries(db)
        print("Справочники заполнены")
        if args.demo:
            print("Демо-данные добавлены" if seed_demo(db) else "Демо-пользователь уже есть, пропускаю")


if __name__ == "__main__":
    main()
