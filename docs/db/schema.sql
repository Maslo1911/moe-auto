-- DDL схемы БД АС «БЖА» (PostgreSQL 14+). Сгенерировано из миграций:
--   cd backend && alembic upgrade head --sql > ../docs/db/schema.sql
-- Справочники заполняет python -m app.seed

BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 0001

CREATE TABLE users (
    id SERIAL NOT NULL, 
    email VARCHAR(254) NOT NULL, 
    password_hash VARCHAR(255) NOT NULL, 
    name VARCHAR(100) NOT NULL, 
    role VARCHAR(10) DEFAULT 'user' NOT NULL, 
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_users_email UNIQUE (email), 
    CONSTRAINT ck_users_email_lower CHECK (email = lower(email)), 
    CONSTRAINT ck_users_role CHECK (role IN ('user', 'admin')), 
    CONSTRAINT ck_users_name_not_blank CHECK (length(trim(name)) > 0)
);

COMMENT ON TABLE users IS 'Пользователи (владельцы автомобилей)';

COMMENT ON COLUMN users.email IS 'E-mail, хранится в нижнем регистре';

COMMENT ON COLUMN users.password_hash IS 'Хэш пароля Argon2id';

COMMENT ON COLUMN users.name IS 'Имя пользователя';

COMMENT ON COLUMN users.role IS 'user — владелец, admin — администратор';

COMMENT ON COLUMN users.registered_at IS 'Дата регистрации';

CREATE TABLE auth_tokens (
    id SERIAL NOT NULL, 
    user_id INTEGER NOT NULL, 
    token_hash VARCHAR(64) NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_auth_tokens_token_hash UNIQUE (token_hash), 
    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

COMMENT ON TABLE auth_tokens IS 'Выданные токены доступа; выход из системы удаляет запись';

COMMENT ON COLUMN auth_tokens.token_hash IS 'HMAC-SHA256 токена; сам токен не хранится';

COMMENT ON COLUMN auth_tokens.expires_at IS 'Окончание срока действия';

CREATE INDEX ix_auth_tokens_user_id ON auth_tokens (user_id);

CREATE INDEX ix_auth_tokens_expires_at ON auth_tokens (expires_at);

CREATE TABLE repair_categories (
    id SMALLSERIAL NOT NULL, 
    name VARCHAR(50) NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_repair_categories_name UNIQUE (name)
);

COMMENT ON TABLE repair_categories IS 'Справочник «Категории ремонта»';

CREATE TABLE fuel_types (
    id SMALLSERIAL NOT NULL, 
    name VARCHAR(50) NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT uq_fuel_types_name UNIQUE (name)
);

COMMENT ON TABLE fuel_types IS 'Справочник «Виды топлива»';

CREATE TABLE cars (
    id SERIAL NOT NULL, 
    user_id INTEGER NOT NULL, 
    brand VARCHAR(50) NOT NULL, 
    model VARCHAR(50) NOT NULL, 
    year SMALLINT NOT NULL, 
    plate_number VARCHAR(12) NOT NULL, 
    vin VARCHAR(17), 
    initial_mileage INTEGER NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_cars_year CHECK (year >= 1900 AND year <= EXTRACT(YEAR FROM CURRENT_DATE)), 
    CONSTRAINT ck_cars_initial_mileage CHECK (initial_mileage >= 0), 
    CONSTRAINT ck_cars_vin CHECK (vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$'), 
    CONSTRAINT ck_cars_plate CHECK (plate_number = upper(plate_number) AND length(plate_number) > 0), 
    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

COMMENT ON TABLE cars IS 'Автомобили пользователей';

COMMENT ON COLUMN cars.brand IS 'Марка';

COMMENT ON COLUMN cars.model IS 'Модель';

COMMENT ON COLUMN cars.year IS 'Год выпуска';

COMMENT ON COLUMN cars.plate_number IS 'Гос. номер, без пробелов, в верхнем регистре';

COMMENT ON COLUMN cars.vin IS 'VIN, необязательный';

COMMENT ON COLUMN cars.initial_mileage IS 'Начальный пробег, км';

CREATE INDEX ix_cars_user_id ON cars (user_id);

CREATE TABLE repairs (
    id SERIAL NOT NULL, 
    car_id INTEGER NOT NULL, 
    category_id SMALLINT NOT NULL, 
    date DATE NOT NULL, 
    mileage INTEGER NOT NULL, 
    description VARCHAR(1000) NOT NULL, 
    place VARCHAR(200) DEFAULT '' NOT NULL, 
    labor_cost NUMERIC(10, 2) NOT NULL, 
    parts_cost NUMERIC(10, 2) NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_repairs_mileage CHECK (mileage >= 0), 
    CONSTRAINT ck_repairs_labor_cost CHECK (labor_cost >= 0), 
    CONSTRAINT ck_repairs_parts_cost CHECK (parts_cost >= 0), 
    CONSTRAINT ck_repairs_date CHECK (date <= CURRENT_DATE + 1), 
    CONSTRAINT ck_repairs_description CHECK (length(trim(description)) > 0), 
    FOREIGN KEY(car_id) REFERENCES cars (id) ON DELETE CASCADE, 
    FOREIGN KEY(category_id) REFERENCES repair_categories (id) ON DELETE RESTRICT
);

COMMENT ON TABLE repairs IS 'Журнал ремонтов и ТО';

COMMENT ON COLUMN repairs.date IS 'Дата ремонта';

COMMENT ON COLUMN repairs.mileage IS 'Пробег, км';

COMMENT ON COLUMN repairs.description IS 'Что сделано';

COMMENT ON COLUMN repairs.place IS 'Место (СТО)';

COMMENT ON COLUMN repairs.labor_cost IS 'Стоимость работ, руб.';

COMMENT ON COLUMN repairs.parts_cost IS 'Стоимость запчастей, руб.';

CREATE INDEX ix_repairs_car_date_mileage ON repairs (car_id, date, mileage);

CREATE INDEX ix_repairs_category_id ON repairs (category_id);

CREATE TABLE refuels (
    id SERIAL NOT NULL, 
    car_id INTEGER NOT NULL, 
    fuel_type_id SMALLINT NOT NULL, 
    date DATE NOT NULL, 
    mileage INTEGER NOT NULL, 
    station VARCHAR(200) DEFAULT '' NOT NULL, 
    volume NUMERIC(6, 2) NOT NULL, 
    price_per_liter NUMERIC(10, 2) NOT NULL, 
    amount NUMERIC(10, 2) GENERATED ALWAYS AS (round(volume * price_per_liter, 2)) STORED, 
    full_tank BOOLEAN DEFAULT false NOT NULL, 
    PRIMARY KEY (id), 
    CONSTRAINT ck_refuels_mileage CHECK (mileage >= 0), 
    CONSTRAINT ck_refuels_volume CHECK (volume > 0 AND volume <= 500), 
    CONSTRAINT ck_refuels_price CHECK (price_per_liter > 0), 
    CONSTRAINT ck_refuels_date CHECK (date <= CURRENT_DATE + 1), 
    FOREIGN KEY(car_id) REFERENCES cars (id) ON DELETE CASCADE, 
    FOREIGN KEY(fuel_type_id) REFERENCES fuel_types (id) ON DELETE RESTRICT
);

COMMENT ON TABLE refuels IS 'Журнал заправок';

COMMENT ON COLUMN refuels.date IS 'Дата заправки';

COMMENT ON COLUMN refuels.mileage IS 'Пробег, км';

COMMENT ON COLUMN refuels.station IS 'АЗС';

COMMENT ON COLUMN refuels.volume IS 'Объём, л';

COMMENT ON COLUMN refuels.price_per_liter IS 'Цена за литр, руб.';

COMMENT ON COLUMN refuels.amount IS 'Сумма S = V × P, вычисляется СУБД';

COMMENT ON COLUMN refuels.full_tank IS 'Заправлен полный бак';

CREATE INDEX ix_refuels_car_date_mileage ON refuels (car_id, date, mileage);

CREATE INDEX ix_refuels_fuel_type_id ON refuels (fuel_type_id);

INSERT INTO alembic_version (version_num) VALUES ('0001') RETURNING alembic_version.version_num;

COMMIT;

