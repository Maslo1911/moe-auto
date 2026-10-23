"""Модель данных (приложение А ТЗ). Схема создаётся миграциями Alembic — см. alembic/versions."""
import datetime as dt
from decimal import Decimal

from sqlalchemy import (
    Boolean, CheckConstraint, Computed, Date, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger,
    String, func, text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="ck_users_email_lower"),
        CheckConstraint("role IN ('user', 'admin')", name="ck_users_role"),
        CheckConstraint("length(trim(name)) > 0", name="ck_users_name_not_blank"),
        {"comment": "Пользователи (владельцы автомобилей)"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, comment="E-mail, хранится в нижнем регистре")
    password_hash: Mapped[str] = mapped_column(String(255), comment="Хэш пароля Argon2id")
    name: Mapped[str] = mapped_column(String(100), comment="Имя пользователя")
    role: Mapped[str] = mapped_column(String(10), server_default="user", comment="user — владелец, admin — администратор")
    registered_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                    comment="Дата регистрации")

    cars: Mapped[list["Car"]] = relationship(back_populates="user", passive_deletes=True)


class AuthToken(Base):
    """Выданные токены. Хранится только HMAC-хэш токена; выход из системы удаляет строку."""
    __tablename__ = "auth_tokens"
    __table_args__ = {"comment": "Выданные токены доступа; выход из системы удаляет запись"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, comment="HMAC-SHA256 токена; сам токен не хранится")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True, comment="Окончание срока действия")

    user: Mapped[User] = relationship()


class RepairCategory(Base):
    __tablename__ = "repair_categories"
    __table_args__ = {"comment": "Справочник «Категории ремонта»"}

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)


class FuelType(Base):
    __tablename__ = "fuel_types"
    __table_args__ = {"comment": "Справочник «Виды топлива»"}

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)


class Car(Base):
    __tablename__ = "cars"
    __table_args__ = (
        CheckConstraint("year >= 1900 AND year <= EXTRACT(YEAR FROM CURRENT_DATE)", name="ck_cars_year"),
        CheckConstraint("initial_mileage >= 0", name="ck_cars_initial_mileage"),
        CheckConstraint("vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$'", name="ck_cars_vin"),
        CheckConstraint("plate_number = upper(plate_number) AND length(plate_number) > 0", name="ck_cars_plate"),
        {"comment": "Автомобили пользователей"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    brand: Mapped[str] = mapped_column(String(50), comment="Марка")
    model: Mapped[str] = mapped_column(String(50), comment="Модель")
    year: Mapped[int] = mapped_column(SmallInteger, comment="Год выпуска")
    plate_number: Mapped[str] = mapped_column(String(12), comment="Гос. номер, без пробелов, в верхнем регистре")
    vin: Mapped[str | None] = mapped_column(String(17), comment="VIN, необязательный")
    initial_mileage: Mapped[int] = mapped_column(Integer, comment="Начальный пробег, км")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="cars")


class Repair(Base):
    __tablename__ = "repairs"
    __table_args__ = (
        CheckConstraint("mileage >= 0", name="ck_repairs_mileage"),
        CheckConstraint("labor_cost >= 0", name="ck_repairs_labor_cost"),
        CheckConstraint("parts_cost >= 0", name="ck_repairs_parts_cost"),
        # Точная проверка «не позже сегодня» — в приложении по APP_TIMEZONE; здесь запас в сутки на часовые пояса
        CheckConstraint("date <= CURRENT_DATE + 1", name="ck_repairs_date"),
        CheckConstraint("length(trim(description)) > 0", name="ck_repairs_description"),
        Index("ix_repairs_car_date_mileage", "car_id", "date", "mileage"),
        {"comment": "Журнал ремонтов и ТО"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    car_id: Mapped[int] = mapped_column(ForeignKey("cars.id", ondelete="CASCADE"))
    category_id: Mapped[int] = mapped_column(ForeignKey("repair_categories.id", ondelete="RESTRICT"), index=True)
    date: Mapped[dt.date] = mapped_column(Date, comment="Дата ремонта")
    mileage: Mapped[int] = mapped_column(Integer, comment="Пробег, км")
    description: Mapped[str] = mapped_column(String(1000), comment="Что сделано")
    place: Mapped[str] = mapped_column(String(200), server_default="", comment="Место (СТО)")
    labor_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), comment="Стоимость работ, руб.")
    parts_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), comment="Стоимость запчастей, руб.")

    category: Mapped[RepairCategory] = relationship(lazy="joined")


class Refuel(Base):
    __tablename__ = "refuels"
    __table_args__ = (
        CheckConstraint("mileage >= 0", name="ck_refuels_mileage"),
        CheckConstraint("volume > 0 AND volume <= 500", name="ck_refuels_volume"),
        CheckConstraint("price_per_liter > 0", name="ck_refuels_price"),
        CheckConstraint("date <= CURRENT_DATE + 1", name="ck_refuels_date"),
        Index("ix_refuels_car_date_mileage", "car_id", "date", "mileage"),
        {"comment": "Журнал заправок"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    car_id: Mapped[int] = mapped_column(ForeignKey("cars.id", ondelete="CASCADE"))
    fuel_type_id: Mapped[int] = mapped_column(ForeignKey("fuel_types.id", ondelete="RESTRICT"), index=True)
    date: Mapped[dt.date] = mapped_column(Date, comment="Дата заправки")
    mileage: Mapped[int] = mapped_column(Integer, comment="Пробег, км")
    station: Mapped[str] = mapped_column(String(200), server_default="", comment="АЗС")
    volume: Mapped[Decimal] = mapped_column(Numeric(6, 2), comment="Объём, л")
    price_per_liter: Mapped[Decimal] = mapped_column(Numeric(10, 2), comment="Цена за литр, руб.")
    # S = V × P с округлением до копеек (п. 4.3.1) — вычисляет сама СУБД, рассогласование невозможно
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), Computed("round(volume * price_per_liter, 2)", persisted=True),
                                         comment="Сумма S = V × P, вычисляется СУБД")
    full_tank: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), comment="Заправлен полный бак")

    fuel_type: Mapped[FuelType] = relationship(lazy="joined")
