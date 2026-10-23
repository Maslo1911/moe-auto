"""Проверка входных данных на сервере (п. 4.3.2 ТЗ).
Сообщения — на русском и привязаны к именам полей запроса, чтобы фронтенд подсветил нужное поле (п. 4.3.3)."""
import re
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .errors import invalid
from .models import FuelType, RepairCategory

MAX_MILEAGE = 9_999_999          # км, с запасом укладывается в INTEGER
MAX_MONEY = Decimal("99999999.99")  # предел NUMERIC(10,2)
MAX_PRICE = Decimal("10000")     # руб./л — чтобы сумма заправки гарантированно помещалась в NUMERIC(10,2)
MAX_VOLUME = Decimal("500")
MAX_ID = 2_147_483_647           # предел INTEGER: больший id заведомо не существует

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
CENT = Decimal("0.01")


def today() -> date:
    return datetime.now(settings.timezone).date()


def fmt_km(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def to_decimal(v) -> Decimal | None:
    """Число из JSON (или строка с числом) → Decimal, округлённый до копеек. None — если это не число."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float, str)):
        try:
            d = Decimal(str(v).strip().replace(",", "."))
        except InvalidOperation:
            return None
        if not d.is_finite():
            return None
        return d.quantize(CENT, rounding=ROUND_HALF_UP)
    return None


def to_date(v) -> date | None:
    if not isinstance(v, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def text(b: dict, key: str, fields: dict, *, required: bool, max_len: int, msg_required: str) -> str:
    v = b.get(key)
    if v is None:
        v = ""
    if not isinstance(v, str):
        fields[key] = "Ожидается текст"
        return ""
    v = v.strip()
    if required and not v:
        fields[key] = msg_required
    elif len(v) > max_len:
        fields[key] = f"Не длиннее {max_len} символов"
    return v


def check_id(v) -> int | None:
    """id справочника из тела запроса: целое число или строка с числом."""
    if isinstance(v, str) and v.strip().isdigit():
        v = int(v)
    return v if is_int(v) and 0 < v <= MAX_ID else None


# ---------------- Пользователь ----------------

def validate_register(b: dict) -> dict:
    f: dict[str, str] = {}
    email = b.get("email")
    email = email.strip().lower() if isinstance(email, str) else ""
    if not email or len(email) > 254 or not EMAIL_RE.match(email):
        f["email"] = "Укажите e-mail в формате name@example.ru"
    password = b.get("password")
    if not isinstance(password, str) or len(password) < 8:
        f["password"] = "Пароль — не менее 8 символов"
    elif len(password) > 128:
        f["password"] = "Пароль — не длиннее 128 символов"
    name = text(b, "name", f, required=True, max_len=100, msg_required="Укажите имя")
    if f:
        raise invalid(f)
    return {"email": email, "password": password, "name": name}


# ---------------- Автомобиль ----------------

def validate_car(b: dict) -> dict:
    f: dict[str, str] = {}
    y = today().year
    brand = text(b, "brand", f, required=True, max_len=50, msg_required="Укажите марку")
    model = text(b, "model", f, required=True, max_len=50, msg_required="Укажите модель")
    year = b.get("year")
    if not is_int(year) or not 1900 <= year <= y:
        f["year"] = f"Год выпуска — от 1900 до {y}"
    plate = b.get("plate_number")
    plate = re.sub(r"\s+", "", plate).upper() if isinstance(plate, str) else ""
    if not plate:
        f["plate_number"] = "Укажите гос. номер"
    elif len(plate) > 12:
        f["plate_number"] = "Гос. номер — не длиннее 12 символов"
    vin = b.get("vin")
    if vin is not None and not isinstance(vin, str):
        f["vin"] = "VIN — 17 символов: латинские буквы, кроме I, O, Q, и цифры"
        vin = None
    vin = (vin or "").strip().upper() or None
    if vin is not None and not VIN_RE.match(vin):
        f["vin"] = "VIN — 17 символов: латинские буквы, кроме I, O, Q, и цифры"
    initial = b.get("initial_mileage")
    if not is_int(initial) or not 0 <= initial <= MAX_MILEAGE:
        f["initial_mileage"] = "Укажите пробег целым числом от 0"
    if f:
        raise invalid(f)
    return {"brand": brand, "model": model, "year": year, "plate_number": plate, "vin": vin, "initial_mileage": initial}


# ---------------- Записи журналов ----------------

def _record_base(b: dict, f: dict) -> dict:
    d = to_date(b.get("date"))
    if d is None:
        f["date"] = "Укажите дату"
    elif d > today():
        f["date"] = "Дата не может быть позже сегодняшней"
    mileage = b.get("mileage")
    if not is_int(mileage) or not 0 <= mileage <= MAX_MILEAGE:
        f["mileage"] = "Укажите пробег целым числом, км"
    return {"date": d, "mileage": mileage}


def validate_repair(db: Session, b: dict) -> dict:
    f: dict[str, str] = {}
    out = _record_base(b, f)
    cat_id = check_id(b.get("category_id"))
    if cat_id is None or db.scalar(select(RepairCategory.id).where(RepairCategory.id == cat_id)) is None:
        f["category_id"] = "Выберите категорию работ"
    out["category_id"] = cat_id
    out["description"] = text(b, "description", f, required=True, max_len=1000, msg_required="Опишите, что сделано")
    out["place"] = text(b, "place", f, required=False, max_len=200, msg_required="")
    for key, label in (("labor_cost", "Стоимость работ"), ("parts_cost", "Стоимость запчастей")):
        v = to_decimal(b.get(key))
        if v is None or v < 0:
            f[key] = f"{label} — число от 0"
        elif v > MAX_MONEY:
            f[key] = f"{label} — не больше 99 999 999,99 ₽"
        out[key] = v
    if f:
        raise invalid(f)
    return out


def validate_refuel(db: Session, b: dict) -> dict:
    f: dict[str, str] = {}
    out = _record_base(b, f)
    ft_id = check_id(b.get("fuel_type_id"))
    if ft_id is None or db.scalar(select(FuelType.id).where(FuelType.id == ft_id)) is None:
        f["fuel_type_id"] = "Выберите вид топлива"
    out["fuel_type_id"] = ft_id
    out["station"] = text(b, "station", f, required=False, max_len=200, msg_required="")
    volume = to_decimal(b.get("volume"))
    if volume is None or volume <= 0:
        f["volume"] = "Укажите объём больше 0"
    elif volume > MAX_VOLUME:
        f["volume"] = "Объём — не больше 500 л"
    out["volume"] = volume
    price = to_decimal(b.get("price_per_liter"))
    if price is None or price <= 0:
        f["price_per_liter"] = "Укажите цену больше 0"
    elif price > MAX_PRICE:
        f["price_per_liter"] = "Цена — не больше 10 000 ₽ за литр"
    out["price_per_liter"] = price
    full = b.get("full_tank", False)
    if full is None:
        full = False
    if not isinstance(full, bool):
        f["full_tank"] = "Ожидается да или нет"
    out["full_tank"] = bool(full)
    if f:
        raise invalid(f)
    return out


# ---------------- Параметры строки запроса ----------------

def q_date(q: dict, key: str, f: dict) -> date | None:
    v = (q.get(key) or "").strip()
    if not v:
        return None
    d = to_date(v)
    if d is None:
        f[key] = "Дата в формате ГГГГ-ММ-ДД"
    return d


def q_int(q: dict, key: str, f: dict, *, default: int | None = None, lo: int = 0, hi: int = MAX_ID,
          msg: str = "Укажите целое число") -> int | None:
    v = (q.get(key) or "").strip().replace(" ", "")
    if not v:
        return default
    if not re.fullmatch(r"\d+", v) or not lo <= int(v) <= hi:
        f[key] = msg
        return default
    return int(v)


def q_page(q: dict, f: dict, default_limit: int = 50) -> tuple[int, int]:
    """limit (по умолчанию 50, максимум 200) и offset — п. 1.3 docs/API.md"""
    limit = q_int(q, "limit", f, default=default_limit, lo=1, msg="limit — целое число от 1")
    offset = q_int(q, "offset", f, default=0, msg="offset — целое число от 0")
    return min(limit, 200), offset


def q_period(q: dict, f: dict) -> tuple[date | None, date | None]:
    d_from, d_to = q_date(q, "date_from", f), q_date(q, "date_to", f)
    if d_from and d_to and d_from > d_to:
        f["date_to"] = "Конец периода раньше начала"
    return d_from, d_to
