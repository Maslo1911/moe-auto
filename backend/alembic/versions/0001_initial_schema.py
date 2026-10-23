"""Начальная схема БД АС «БЖА» (приложение А ТЗ, 3НФ).

Revision ID: 0001
Revises:
Create Date: 2026-10-23
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(254), nullable=False, comment="E-mail, хранится в нижнем регистре"),
        sa.Column("password_hash", sa.String(255), nullable=False, comment="Хэш пароля Argon2id"),
        sa.Column("name", sa.String(100), nullable=False, comment="Имя пользователя"),
        sa.Column("role", sa.String(10), nullable=False, server_default="user", comment="user — владелец, admin — администратор"),
        sa.Column("registered_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), comment="Дата регистрации"),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.CheckConstraint("email = lower(email)", name="ck_users_email_lower"),
        sa.CheckConstraint("role IN ('user', 'admin')", name="ck_users_role"),
        sa.CheckConstraint("length(trim(name)) > 0", name="ck_users_name_not_blank"),
        comment="Пользователи (владельцы автомобилей)",
    )

    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, comment="HMAC-SHA256 токена; сам токен не хранится"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False, comment="Окончание срока действия"),
        sa.UniqueConstraint("token_hash", name="uq_auth_tokens_token_hash"),
        comment="Выданные токены доступа; выход из системы удаляет запись",
    )
    op.create_index("ix_auth_tokens_user_id", "auth_tokens", ["user_id"])
    op.create_index("ix_auth_tokens_expires_at", "auth_tokens", ["expires_at"])

    op.create_table(
        "repair_categories",
        sa.Column("id", sa.SmallInteger, primary_key=True),
        sa.Column("name", sa.String(50), nullable=False),
        sa.UniqueConstraint("name", name="uq_repair_categories_name"),
        comment="Справочник «Категории ремонта»",
    )
    op.create_table(
        "fuel_types",
        sa.Column("id", sa.SmallInteger, primary_key=True),
        sa.Column("name", sa.String(50), nullable=False),
        sa.UniqueConstraint("name", name="uq_fuel_types_name"),
        comment="Справочник «Виды топлива»",
    )

    op.create_table(
        "cars",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("brand", sa.String(50), nullable=False, comment="Марка"),
        sa.Column("model", sa.String(50), nullable=False, comment="Модель"),
        sa.Column("year", sa.SmallInteger, nullable=False, comment="Год выпуска"),
        sa.Column("plate_number", sa.String(12), nullable=False, comment="Гос. номер, без пробелов, в верхнем регистре"),
        sa.Column("vin", sa.String(17), nullable=True, comment="VIN, необязательный"),
        sa.Column("initial_mileage", sa.Integer, nullable=False, comment="Начальный пробег, км"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("year >= 1900 AND year <= EXTRACT(YEAR FROM CURRENT_DATE)", name="ck_cars_year"),
        sa.CheckConstraint("initial_mileage >= 0", name="ck_cars_initial_mileage"),
        sa.CheckConstraint("vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$'", name="ck_cars_vin"),
        sa.CheckConstraint("plate_number = upper(plate_number) AND length(plate_number) > 0", name="ck_cars_plate"),
        comment="Автомобили пользователей",
    )
    op.create_index("ix_cars_user_id", "cars", ["user_id"])

    op.create_table(
        "repairs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("car_id", sa.Integer, sa.ForeignKey("cars.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", sa.SmallInteger, sa.ForeignKey("repair_categories.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("date", sa.Date, nullable=False, comment="Дата ремонта"),
        sa.Column("mileage", sa.Integer, nullable=False, comment="Пробег, км"),
        sa.Column("description", sa.String(1000), nullable=False, comment="Что сделано"),
        sa.Column("place", sa.String(200), nullable=False, server_default="", comment="Место (СТО)"),
        sa.Column("labor_cost", sa.Numeric(10, 2), nullable=False, comment="Стоимость работ, руб."),
        sa.Column("parts_cost", sa.Numeric(10, 2), nullable=False, comment="Стоимость запчастей, руб."),
        sa.CheckConstraint("mileage >= 0", name="ck_repairs_mileage"),
        sa.CheckConstraint("labor_cost >= 0", name="ck_repairs_labor_cost"),
        sa.CheckConstraint("parts_cost >= 0", name="ck_repairs_parts_cost"),
        sa.CheckConstraint("date <= CURRENT_DATE + 1", name="ck_repairs_date"),
        sa.CheckConstraint("length(trim(description)) > 0", name="ck_repairs_description"),
        comment="Журнал ремонтов и ТО",
    )
    op.create_index("ix_repairs_car_date_mileage", "repairs", ["car_id", "date", "mileage"])
    op.create_index("ix_repairs_category_id", "repairs", ["category_id"])

    op.create_table(
        "refuels",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("car_id", sa.Integer, sa.ForeignKey("cars.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fuel_type_id", sa.SmallInteger, sa.ForeignKey("fuel_types.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("date", sa.Date, nullable=False, comment="Дата заправки"),
        sa.Column("mileage", sa.Integer, nullable=False, comment="Пробег, км"),
        sa.Column("station", sa.String(200), nullable=False, server_default="", comment="АЗС"),
        sa.Column("volume", sa.Numeric(6, 2), nullable=False, comment="Объём, л"),
        sa.Column("price_per_liter", sa.Numeric(10, 2), nullable=False, comment="Цена за литр, руб."),
        sa.Column("amount", sa.Numeric(10, 2), sa.Computed("round(volume * price_per_liter, 2)", persisted=True),
                  comment="Сумма S = V × P, вычисляется СУБД"),
        sa.Column("full_tank", sa.Boolean, nullable=False, server_default=sa.false(), comment="Заправлен полный бак"),
        sa.CheckConstraint("mileage >= 0", name="ck_refuels_mileage"),
        sa.CheckConstraint("volume > 0 AND volume <= 500", name="ck_refuels_volume"),
        sa.CheckConstraint("price_per_liter > 0", name="ck_refuels_price"),
        sa.CheckConstraint("date <= CURRENT_DATE + 1", name="ck_refuels_date"),
        comment="Журнал заправок",
    )
    op.create_index("ix_refuels_car_date_mileage", "refuels", ["car_id", "date", "mileage"])
    op.create_index("ix_refuels_fuel_type_id", "refuels", ["fuel_type_id"])


def downgrade() -> None:
    for t in ("refuels", "repairs", "cars", "fuel_types", "repair_categories", "auth_tokens", "users"):
        op.drop_table(t)
