"""Функциональные тесты API по docs/API.md и таблице 1 ТЗ."""
from datetime import date, timedelta

import pytest

from app.config import settings
from conftest import register


def refuel(client, auth, car, **kw):
    body = {"date": "2026-01-10", "mileage": 46000, "fuel_type_id": 2, "station": "Лукойл, Каширское ш., 61",
            "volume": 38.4, "price_per_liter": 59, "full_tank": True}
    body.update(kw)
    return client.post(f"/cars/{car['id']}/refuels", headers=auth, json=body)


def repair(client, auth, car, **kw):
    body = {"date": "2026-01-15", "mileage": 46100, "category_id": 1, "description": "ТО-6: замена масла и фильтров",
            "place": "СТО «Мотор»", "labor_cost": 2500, "parts_cost": 6400}
    body.update(kw)
    return client.post(f"/cars/{car['id']}/repairs", headers=auth, json=body)


# ---------------- Функции 1–2: регистрация, вход, выход ----------------

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["db"] == "ok"


def test_register_login_me_logout(client):
    r = client.post("/auth/register", json={"email": "Ivan.Petrov@Mail.ru", "password": "qwerty123", "name": " Иван Петров "})
    assert r.status_code == 201
    body = r.json()
    assert body["token"] and body["expires_at"].endswith("Z")
    assert body["user"]["email"] == "ivan.petrov@mail.ru" and body["user"]["name"] == "Иван Петров"

    r = client.post("/auth/login", json={"email": "IVAN.PETROV@mail.ru", "password": "qwerty123"})
    assert r.status_code == 200
    h = {"Authorization": "Bearer " + r.json()["token"]}
    assert client.get("/auth/me", headers=h).json()["email"] == "ivan.petrov@mail.ru"
    assert client.post("/auth/logout", headers=h).status_code == 204
    r = client.get("/auth/me", headers=h)
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"


def test_password_is_hashed(client):
    register(client)
    from app.db import SessionLocal
    from app.models import User
    with SessionLocal() as db:
        u = db.query(User).one()
        assert u.password_hash.startswith("$argon2") and "qwerty123" not in u.password_hash


def test_register_validation_and_duplicate(client):
    r = client.post("/auth/register", json={"email": "bad", "password": "123", "name": ""})
    assert r.status_code == 422
    assert set(r.json()["error"]["fields"]) == {"email", "password", "name"}
    register(client, email="a@b.ru")
    r = client.post("/auth/register", json={"email": "A@B.ru", "password": "qwerty123", "name": "X"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "EMAIL_TAKEN"


def test_login_does_not_reveal_what_is_wrong(client):
    register(client, email="a@b.ru")
    wrong_pw = client.post("/auth/login", json={"email": "a@b.ru", "password": "wrong-pass"})
    no_user = client.post("/auth/login", json={"email": "x@b.ru", "password": "qwerty123"})
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json() == no_user.json()
    assert wrong_pw.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_expired_token(client, auth):
    from app.db import engine
    from sqlalchemy import text
    with engine.begin() as conn:
        conn.execute(text("UPDATE auth_tokens SET expires_at = now() - interval '1 minute'"))
    assert client.get("/cars", headers=auth).status_code == 401


def test_requires_auth(client):
    for path in ("/cars", "/repair-categories", "/fuel-types", "/auth/me"):
        r = client.get(path)
        assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"


def test_dictionaries(client, auth):
    cats = client.get("/repair-categories", headers=auth).json()
    assert [c["name"] for c in cats] == ["ТО", "Двигатель", "Ходовая часть", "Тормозная система", "Электрика",
                                         "Кузов", "Шины", "Прочее"]
    assert [f["name"] for f in client.get("/fuel-types", headers=auth).json()] == ["АИ-92", "АИ-95", "АИ-98", "ДТ", "Газ"]


def test_invalid_json(client, auth):
    r = client.post("/cars", headers={**auth, "Content-Type": "application/json"}, content=b"{oops")
    assert r.status_code == 400 and r.json()["error"]["code"] == "BAD_REQUEST"


# ---------------- Функции 3–4: автомобили ----------------

def test_car_crud(client, auth, car):
    assert car["plate_number"] == "А123ВС77"
    assert car["current_mileage"] == 45000 and car["last_record_date"] is None
    assert car["repairs_count"] == 0 and car["refuels_count"] == 0

    body = {"brand": "Lada", "model": "Vesta SW", "year": 2020, "plate_number": "А123ВС77",
            "vin": "xtagfl110ky123456", "initial_mileage": 44000}
    r = client.put(f"/cars/{car['id']}", headers=auth, json=body)
    assert r.status_code == 200 and r.json()["model"] == "Vesta SW" and r.json()["vin"] == "XTAGFL110KY123456"
    assert [c["id"] for c in client.get("/cars", headers=auth).json()] == [car["id"]]
    assert client.delete(f"/cars/{car['id']}", headers=auth).status_code == 204
    assert client.get(f"/cars/{car['id']}", headers=auth).status_code == 404


def test_car_validation(client, auth):
    r = client.post("/cars", headers=auth, json={"brand": "", "model": " ", "year": 1800, "plate_number": "",
                                                "vin": "IOQ", "initial_mileage": -1})
    assert r.status_code == 422
    assert set(r.json()["error"]["fields"]) == {"brand", "model", "year", "plate_number", "vin", "initial_mileage"}
    r = client.post("/cars", headers=auth, json={"brand": "A", "model": "B", "year": date.today().year + 1,
                                                "plate_number": "X1", "initial_mileage": 0})
    assert "year" in r.json()["error"]["fields"]


def test_car_limit(client, auth):
    for i in range(10):
        assert client.post("/cars", headers=auth, json={"brand": "A", "model": str(i), "year": 2010,
                                                       "plate_number": f"X{i}", "initial_mileage": 0}).status_code == 201
    r = client.post("/cars", headers=auth, json={"brand": "A", "model": "11", "year": 2010, "plate_number": "Y",
                                                "initial_mileage": 0})
    assert r.status_code == 422 and "limit" in r.json()["error"]["fields"]


def test_foreign_data_is_404(client, auth, car):
    rid = repair(client, auth, car).json()["id"]
    other = register(client, email="other@b.ru")
    assert client.get("/cars", headers=other).json() == []
    for method, path in (("GET", f"/cars/{car['id']}"), ("PUT", f"/cars/{car['id']}"), ("DELETE", f"/cars/{car['id']}"),
                         ("GET", f"/cars/{car['id']}/repairs"), ("GET", f"/cars/{car['id']}/repairs/{rid}"),
                         ("DELETE", f"/cars/{car['id']}/repairs/{rid}"), ("GET", f"/cars/{car['id']}/summary"),
                         ("GET", f"/cars/{car['id']}/records")):
        r = client.request(method, path, headers=other, json={} if method == "PUT" else None)
        assert r.status_code == 404, (method, path)
        assert r.json()["error"]["code"] == "NOT_FOUND"
    assert client.get(f"/cars/{car['id']}/repairs/{rid}", headers=auth).status_code == 200


def test_delete_car_cascades(client, auth, car):
    refuel(client, auth, car)
    repair(client, auth, car)
    client.delete(f"/cars/{car['id']}", headers=auth)
    from app.db import engine
    from sqlalchemy import text
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM repairs")) == 0
        assert conn.scalar(text("SELECT count(*) FROM refuels")) == 0


# ---------------- Функции 5–7: журналы и контроль пробега ----------------

def test_refuel_amount_is_computed(client, auth, car):
    r = refuel(client, auth, car, volume=38.4, price_per_liter=59, amount=1)
    assert r.status_code == 201
    assert r.json()["amount"] == 2265.6
    r = refuel(client, auth, car, date="2026-01-11", mileage=46100, volume=33.333, price_per_liter=57.777)
    # 33.33 × 57.78 = 1925.8074 → 1925.81
    assert r.json()["volume"] == 33.33 and r.json()["amount"] == 1925.81


def test_refuel_validation(client, auth, car):
    tomorrow = (date.today() + timedelta(days=2)).isoformat()
    r = refuel(client, auth, car, date=tomorrow, mileage=None, fuel_type_id=99, volume=0, price_per_liter=-1)
    assert r.status_code == 422
    assert set(r.json()["error"]["fields"]) == {"date", "mileage", "fuel_type_id", "volume", "price_per_liter"}
    assert "volume" in refuel(client, auth, car, volume=501).json()["error"]["fields"]


def test_repair_crud(client, auth, car):
    r = repair(client, auth, car)
    assert r.status_code == 201
    rep = r.json()
    assert rep["total_cost"] == 8900 and rep["category"] == {"id": 1, "name": "ТО"}
    r = client.put(f"/cars/{car['id']}/repairs/{rep['id']}", headers=auth,
                   json={**{k: rep[k] for k in ("date", "mileage", "description", "place")},
                         "category_id": 4, "labor_cost": 1000, "parts_cost": 0.5})
    assert r.status_code == 200 and r.json()["total_cost"] == 1000.5 and r.json()["category"]["id"] == 4
    assert client.delete(f"/cars/{car['id']}/repairs/{rep['id']}", headers=auth).status_code == 204
    assert client.get(f"/cars/{car['id']}/repairs/{rep['id']}", headers=auth).status_code == 404


def test_repair_validation(client, auth, car):
    r = repair(client, auth, car, category_id=None, description="", labor_cost=-1, parts_cost="abc")
    assert set(r.json()["error"]["fields"]) == {"category_id", "description", "labor_cost", "parts_cost"}


def test_mileage_control(client, auth, car):
    refuel(client, auth, car, date="2026-01-10", mileage=46000)
    refuel(client, auth, car, date="2026-01-20", mileage=46500)
    # Меньше начального пробега
    r = repair(client, auth, car, date="2026-01-01", mileage=44000)
    assert r.status_code == 422 and r.json()["error"]["code"] == "MILEAGE_CONFLICT"
    # Между соседними записями
    r = repair(client, auth, car, date="2026-01-15", mileage=46600)
    assert r.json()["error"]["fields"]["mileage"] == "Пробег должен быть от 46 000 до 46 500 км — между соседними записями"
    assert repair(client, auth, car, date="2026-01-15", mileage=46200).status_code == 201
    # Позже всех — не меньше последнего
    assert repair(client, auth, car, date="2026-02-01", mileage=46400).status_code == 422
    rg = client.get(f"/cars/{car['id']}/mileage-range", headers=auth, params={"date": "2026-01-12"}).json()
    assert rg == {"date": "2026-01-12", "min": 46000, "max": 46200}
    rg = client.get(f"/cars/{car['id']}/mileage-range", headers=auth, params={"date": "2026-03-01"}).json()
    assert rg["max"] is None and rg["min"] == 46500


def test_mileage_control_on_edit_excludes_itself(client, auth, car):
    a = refuel(client, auth, car, date="2026-01-10", mileage=46000).json()
    refuel(client, auth, car, date="2026-01-20", mileage=46500)
    rg = client.get(f"/cars/{car['id']}/mileage-range", headers=auth,
                    params={"date": "2026-01-10", "exclude_type": "refuel", "exclude_id": a["id"]}).json()
    assert rg["min"] == 45000 and rg["max"] == 46500
    body = {"date": "2026-01-10", "mileage": 46400, "fuel_type_id": 2, "volume": 30, "price_per_liter": 60, "full_tank": False}
    r = client.put(f"/cars/{car['id']}/refuels/{a['id']}", headers=auth, json=body)
    assert r.status_code == 200 and r.json()["mileage"] == 46400 and r.json()["full_tank"] is False


def test_initial_mileage_cannot_exceed_records(client, auth, car):
    refuel(client, auth, car, mileage=46000)
    body = {"brand": "Lada", "model": "Vesta", "year": 2019, "plate_number": "А123ВС77", "initial_mileage": 47000}
    r = client.put(f"/cars/{car['id']}", headers=auth, json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "MILEAGE_CONFLICT"
    assert "initial_mileage" in r.json()["error"]["fields"]


def test_current_mileage_and_records_feed(client, auth, car):
    refuel(client, auth, car, date="2026-01-10", mileage=46000, full_tank=False)
    repair(client, auth, car, date="2026-01-15", mileage=46100)
    c = client.get(f"/cars/{car['id']}", headers=auth).json()
    assert c["current_mileage"] == 46100 and c["last_record_date"] == "2026-01-15"
    assert c["repairs_count"] == 1 and c["refuels_count"] == 1
    items = client.get(f"/cars/{car['id']}/records", headers=auth).json()["items"]
    assert [i["type"] for i in items] == ["repair", "refuel"]
    assert items[0]["category"] == "ТО" and items[0]["amount"] == 8900
    assert items[1] == {"type": "refuel", "id": items[1]["id"], "date": "2026-01-10", "mileage": 46000,
                        "title": "Лукойл, АИ-95, 38,40 л", "category": "долив", "amount": 2265.6}


# ---------------- Функция 8: поиск по ремонтам ----------------

def test_repair_search_and_sum(client, auth, car):
    repair(client, auth, car, date="2026-01-15", mileage=46100, category_id=4,
           description="Замена передних тормозных колодок", labor_cost=1200, parts_cost=3100)
    repair(client, auth, car, date="2026-02-15", mileage=47000, category_id=1, description="ТО-7",
           place="Дилер", labor_cost=3000, parts_cost=5000)
    repair(client, auth, car, date="2026-03-15", mileage=48000, category_id=4, description="Задние колодки",
           labor_cost=1000, parts_cost=2000)
    url = f"/cars/{car['id']}/repairs"
    r = client.get(url, headers=auth, params={"q": "КОЛОД"}).json()
    assert r["total_count"] == 2 and r["sum"] == {"labor_cost": 2200, "parts_cost": 5100, "total_cost": 7300}
    assert [x["date"] for x in r["items"]] == ["2026-03-15", "2026-01-15"]
    assert client.get(url, headers=auth, params={"q": "дилер"}).json()["total_count"] == 1
    assert client.get(url, headers=auth, params={"category_id": 1}).json()["total_count"] == 1
    r = client.get(url, headers=auth, params={"date_from": "2026-02-15", "date_to": "2026-03-15"}).json()
    assert r["total_count"] == 2
    assert client.get(url, headers=auth, params={"mileage_from": 46500, "mileage_to": 47000}).json()["total_count"] == 1
    # Сумма — по всем найденным, а не по странице
    r = client.get(url, headers=auth, params={"limit": 1, "sort": "cost_desc"}).json()
    assert len(r["items"]) == 1 and r["items"][0]["total_cost"] == 8000
    assert r["total_count"] == 3 and r["sum"]["total_cost"] == 15300
    r = client.get(url, headers=auth, params={"limit": 2, "offset": 2, "sort": "date_asc"}).json()
    assert [x["date"] for x in r["items"]] == ["2026-03-15"]
    assert client.get(url, headers=auth, params={"q": "%"}).json()["total_count"] == 0
    r = client.get(url, headers=auth, params={"date_from": "abc", "sort": "zzz"})
    assert r.status_code == 422 and set(r.json()["error"]["fields"]) == {"date_from", "sort"}


def test_refuels_list(client, auth, car):
    refuel(client, auth, car, date="2026-01-10", mileage=46000, volume=40, price_per_liter=50)
    refuel(client, auth, car, date="2026-02-10", mileage=46500, volume=30, price_per_liter=60, fuel_type_id=3)
    r = client.get(f"/cars/{car['id']}/refuels", headers=auth).json()
    assert r["total_count"] == 2 and r["sum"] == {"volume": 70, "amount": 3800}
    assert r["items"][0]["date"] == "2026-02-10"
    r = client.get(f"/cars/{car['id']}/refuels", headers=auth, params={"fuel_type_id": 3}).json()
    assert r["total_count"] == 1 and r["items"][0]["fuel_type"]["name"] == "АИ-98"


# ---------------- Функция 9: итоги ----------------

def test_summary(client, auth, car):
    # Полный бак → 400 км → долив 20 л → 100 км → полный бак 15 л: расход (20 + 15) / 500 × 100 = 7 л/100 км
    refuel(client, auth, car, date="2026-01-10", mileage=46000, volume=40, price_per_liter=50, full_tank=True)
    refuel(client, auth, car, date="2026-01-20", mileage=46400, volume=20, price_per_liter=50, full_tank=False)
    refuel(client, auth, car, date="2026-02-05", mileage=46500, volume=15, price_per_liter=50, full_tank=True)
    repair(client, auth, car, date="2026-02-10", mileage=46600, labor_cost=1000, parts_cost=500)
    repair(client, auth, car, date="2025-12-10", mileage=45500, category_id=7, labor_cost=2000, parts_cost=0)

    s = client.get(f"/cars/{car['id']}/summary", headers=auth,
                   params={"date_from": "2026-01-01", "date_to": "2026-02-28"}).json()
    assert s["repairs_total"] == 1500 and s["fuel_total"] == 3750 and s["total"] == 5250
    assert s["fuel_volume"] == 75 and s["distance"] == 600
    assert s["avg_consumption"] == 7.0
    assert s["cost_per_km"] == 8.75
    assert s["by_category"] == [{"category": {"id": 1, "name": "ТО"}, "total": 1500, "count": 1}]
    assert s["by_month"] == [{"month": "2026-01", "repairs": 0, "fuel": 3000}, {"month": "2026-02", "repairs": 1500, "fuel": 750}]

    s = client.get(f"/cars/{car['id']}/summary", headers=auth).json()
    assert s["date_from"] is None and s["total"] == 7250 and s["by_month"][0]["month"] == "2025-12"

    s = client.get(f"/cars/{car['id']}/summary", headers=auth, params={"date_from": "2026-01-15"}).json()
    assert s["avg_consumption"] is None  # в периоде одна полная заправка


def test_summary_empty(client, auth, car):
    s = client.get(f"/cars/{car['id']}/summary", headers=auth, params={"date_from": "2026-01-01", "date_to": "2026-01-31"}).json()
    assert s["total"] == 0 and s["distance"] == 0 and s["avg_consumption"] is None and s["cost_per_km"] is None
    assert s["by_month"] == [{"month": "2026-01", "repairs": 0, "fuel": 0}]


# ---------------- Администратор и сервисный режим ----------------

def test_admin_manages_dictionaries(client, auth, car):
    assert client.post("/fuel-types", headers=auth, json={"name": "Электричество"}).status_code == 403
    from app.db import engine
    from sqlalchemy import text
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET role = 'admin'"))
    r = client.post("/fuel-types", headers=auth, json={"name": "Электричество"})
    assert r.status_code == 201 and r.json()["id"] == 6
    assert client.post("/fuel-types", headers=auth, json={"name": "Электричество"}).status_code == 409
    assert client.put("/fuel-types/6", headers=auth, json={"name": "ЭЛ"}).json()["name"] == "ЭЛ"
    refuel(client, auth, car, fuel_type_id=2)
    assert client.delete("/fuel-types/2", headers=auth).status_code == 409
    assert client.delete("/fuel-types/6", headers=auth).status_code == 204


def test_maintenance_mode(client, auth):
    settings.maintenance_file.touch()
    try:
        r = client.get("/cars", headers=auth)
        assert r.status_code == 503 and r.json()["error"]["code"] == "MAINTENANCE"
        assert client.get("/health").status_code == 200
    finally:
        settings.maintenance_file.unlink()
    assert client.get("/cars", headers=auth).status_code == 200


@pytest.mark.parametrize("path", ["/cars/abc", "/cars/99999999999", "/cars/0"])
def test_bad_ids_are_404(client, auth, path):
    assert client.get(path, headers=auth).status_code == 404
