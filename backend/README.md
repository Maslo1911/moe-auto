# Бэкенд АС «БЖА»

REST API по документу [`docs/API.md`](../docs/API.md): все 25 методов, коды ответов и формат ошибок — как в списке API.
Стек: Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 14+ (проверено на 16), пароли — Argon2id.

## Запуск

### Вариант 1. Docker — всё одной командой

Из корня репозитория:

```bash
docker compose up -d --build
```

Поднимаются PostgreSQL и бэкенд, применяются миграции, заполняются справочники и демо-данные
(`ivan.petrov@mail.ru` / `qwerty123`; отключить — `SEED_DEMO=0`). Сайт и API: http://localhost:8000,
документация Swagger: http://localhost:8000/api/v1/docs, проверка: http://localhost:8000/health.

Образ ([`Dockerfile`](Dockerfile)) собирается из корня репозитория и содержит и бэкенд, и фронтенд:
`docker build -f backend/Dockerfile .`. При запуске он применяет миграции, заполняет справочники и стартует сервер
на порту `PORT` (по умолчанию 8000) с `WEB_CONCURRENCY` процессами (по умолчанию 2). Этот же образ использует
Render — см. [`render.yaml`](../render.yaml) и раздел «Деплой на Render + Neon» в [корневом README](../README.md).

### Вариант 2. Локально

Нужны Python 3.11+ и PostgreSQL 14+ (можно только БД из Docker: `docker compose up -d db`).

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env              # параметры подключения к БД и секрет
alembic upgrade head              # миграции
python -m app.seed --demo         # справочники (+ демо-данные с флагом --demo)
uvicorn app.main:app --reload     # http://localhost:8000
```

При `FRONTEND_DIR=../frontend` (по умолчанию в `.env.example`) бэкенд отдаёт и сайт, поэтому фронтенд открывается
на том же адресе без CORS. В продакшене сайт отдаёт nginx — [`deploy/nginx.conf`](../deploy/nginx.conf).

## Тесты

```bash
cd backend
pytest
```

35 тестов по всем функциям таблицы 1 ТЗ: регистрация и вход, доступ только к своим данным,
лимит 10 автомобилей, каскадное удаление, расчёт суммы заправки, контроль пробега, поиск с суммой,
итоги и средний расход, сервисный режим, разбор строки подключения от хостингов. Тесты создают отдельную БД `bja_test` (адрес — `TEST_DATABASE_URL`).

## Структура

```
backend/
  app/
    main.py          приложение: маршруты, формат ошибок, журнал запросов, сервисный режим, /health
    config.py        настройки из переменных окружения
    models.py        модель данных (SQLAlchemy)
    validation.py    проверка входных данных, сообщения на русском по полям
    services.py      контроль пробега, итоги, средний расход, представление объектов
    security.py      Argon2, токены
    deps.py          текущий пользователь, проверка владельца
    routers/         методы API по разделам docs/API.md
    seed.py          справочники и демо-данные
    cli.py           служебные команды (назначить администратора, очистить токены)
  alembic/           миграции схемы БД
  tests/             функциональные тесты
```

## База данных

Схема — в миграции [`alembic/versions/0001_initial_schema.py`](alembic/versions/0001_initial_schema.py),
готовый DDL — [`docs/db/schema.sql`](../docs/db/schema.sql). Таблицы соответствуют приложению А ТЗ и ER-диаграмме
в корневом README:

| Таблица | Назначение | Ключевые ограничения |
|---|---|---|
| `users` | Пользователи | e-mail уникален и хранится в нижнем регистре; `role` — `user` / `admin` |
| `auth_tokens` | Выданные токены | хранится HMAC токена, а не сам токен; выход удаляет строку |
| `repair_categories`, `fuel_types` | Справочники | уникальное название |
| `cars` | Автомобили | год 1900…текущий, пробег ≥ 0, формат VIN; `ON DELETE CASCADE` от пользователя |
| `repairs` | Ремонты | стоимости `NUMERIC(10,2)` ≥ 0, пробег ≥ 0; `ON DELETE CASCADE` от автомобиля |
| `refuels` | Заправки | объём 0…500, цена > 0; `amount` = `round(volume × price_per_liter, 2)` — вычисляемый столбец СУБД |

Отличия имён от ER-диаграммы в README: гос. номер — `plate_number`, сумма заправки — `amount` (как в `docs/API.md`).

Сумма заправки хранится как вычисляемый (`GENERATED ALWAYS ... STORED`) столбец: она есть в БД, как требует ТЗ,
но рассогласоваться с объёмом и ценой не может, поэтому 3НФ не нарушается.

Контроль пробега (п. 4.3.1 ТЗ) выполняется в транзакции с блокировкой строки автомобиля (`SELECT … FOR UPDATE`),
поэтому две одновременные записи не могут обойти проверку.

## Что ещё реализовано по ТЗ

| Требование ТЗ | Как сделано |
|---|---|
| 4.1.4 Сервисный режим | Пока существует файл `backend/maintenance.on` (`MAINTENANCE_FILE`), API отвечает `503 MAINTENANCE`; `/health` работает. В nginx — свой флаг, см. `deploy/nginx.conf` |
| 4.1.5 Журнал и health-check | Каждый запрос и каждая ошибка пишутся с датой и временем в консоль и `backend/logs/app.log` (новый файл каждые сутки, 30 дней). `GET /health` и `GET /api/v1/health` проверяют связь с БД |
| 4.3.7 Роль «администратор» | `python -m app.cli set-role <email> admin`. Администратору доступны `POST /repair-categories`, `PUT/DELETE /repair-categories/{id}` и то же для `/fuel-types` (`{"name": "..."}`); используемую запись справочника удалить нельзя — `409 IN_USE`. Остальным — `403 FORBIDDEN` |
| 4.3.2, 4.4.9 Резервное копирование | [`deploy/backup.sh`](../deploy/backup.sh): `pg_dump` раз в сутки по cron, копии старше 7 суток удаляются |
| 4.4.8 Защита | Argon2id, токены с ограниченным сроком (`TOKEN_TTL`), проверка владельца в каждом запросе (чужое — `404`), только ORM/параметризованные запросы, проверка всех данных на сервере |

## Переменные окружения

См. [`.env.example`](.env.example): `DATABASE_URL`, `SECRET_KEY`, `TOKEN_TTL` (часы), `APP_TIMEZONE`,
`CORS_ORIGINS`, `FRONTEND_DIR`, `LOG_DIR`, `MAINTENANCE_FILE`, `TEST_DATABASE_URL`; в Docker-образе ещё `PORT`, `WEB_CONCURRENCY`, `SEED_DEMO`.

## Лицензии зависимостей

FastAPI, Starlette, Pydantic, SQLAlchemy, Alembic, argon2-cffi — MIT; uvicorn, python-dotenv, httpx — BSD;
psycopg — LGPL-3.0 (свободная лицензия, допускает использование как подключаемой библиотеки).
