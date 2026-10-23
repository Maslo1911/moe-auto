"""АС «Бортовой журнал автомобилиста» — серверная часть (REST API по docs/API.md)."""
import logging
import logging.handlers
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings
from .db import engine
from .errors import ApiError, error_response, maintenance
from .routers import auth, cars, dictionaries, refuels, repairs, summary

API_PREFIX = "/api/v1"


# ---------------- Журнал (п. 4.1.5 ТЗ): дата, время, тип события ----------------
def setup_logging() -> logging.Logger:
    log = logging.getLogger("bja")
    if log.handlers:
        return log
    log.setLevel(settings.log_level)
    log.propagate = False
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    log.addHandler(console)
    try:
        settings.log_dir.mkdir(parents=True, exist_ok=True)
        # Новый файл каждые сутки, хранятся 30 последних
        fh = logging.handlers.TimedRotatingFileHandler(settings.log_dir / "app.log", when="midnight",
                                                       backupCount=30, encoding="utf-8")
        fh.setFormatter(fmt)
        log.addHandler(fh)
    except OSError as e:  # журнал в файл недоступен — пишем только в консоль
        log.warning("file log disabled: %s", e)
    return log


log = setup_logging()

app = FastAPI(
    title="АС «БЖА» — Бортовой журнал автомобилиста",
    version="1.0.0",
    description="REST API по документу docs/API.md. Все методы, кроме регистрации, входа и /health, "
                "требуют заголовок Authorization: Bearer <token>.",
    docs_url=f"{API_PREFIX}/docs",
    openapi_url=f"{API_PREFIX}/openapi.json",
    redoc_url=None,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )


@app.middleware("http")
async def service_middleware(request: Request, call_next):
    path = request.url.path
    is_api = path.startswith(API_PREFIX)
    # Сервисный режим (п. 4.1.4): пока существует файл-флаг, API отвечает 503, health-check работает
    if is_api and not path.endswith("/health") and settings.maintenance_file.exists():
        e = maintenance()
        return error_response(e.status, e.code, e.message)
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("unhandled error %s %s", request.method, path)
        return error_response(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера. Попробуйте ещё раз")
    if is_api:
        ms = (time.perf_counter() - start) * 1000
        user = getattr(request.state, "user_id", "-")
        level = logging.WARNING if response.status_code >= 500 else logging.INFO
        log.log(level, "request %s %s -> %s %.0fms user=%s ip=%s", request.method, path, response.status_code, ms,
                user, request.client.host if request.client else "-")
    return response


# ---------------- Ошибки — всегда в формате п. 1.2 docs/API.md ----------------
@app.exception_handler(ApiError)
async def api_error_handler(_: Request, e: ApiError):
    return error_response(e.status, e.code, e.message, e.fields)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, e: StarletteHTTPException):
    if e.status_code == 404:
        return error_response(404, "NOT_FOUND", "Метод не найден")
    if e.status_code == 405:
        return error_response(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается")
    return error_response(e.status_code, "HTTP_ERROR", str(e.detail))


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, e: RequestValidationError):
    fields = {str(err["loc"][-1]): "Неверное значение" for err in e.errors() if err.get("loc")}
    return error_response(422, "VALIDATION_ERROR", "Проверьте заполнение полей", fields)


@app.exception_handler(Exception)
async def internal_error_handler(request: Request, e: Exception):
    log.exception("unhandled error %s %s", request.method, request.url.path)
    return error_response(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера. Попробуйте ещё раз")


# ---------------- Маршруты ----------------
for r in (auth.router, dictionaries.router, cars.router, repairs.router, refuels.router, summary.router):
    app.include_router(r, prefix=API_PREFIX)


def health():
    """Метод 25: проверка доступности сервиса и БД, без авторизации."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001
        log.error("health: database unavailable: %s", e)
        return JSONResponse({"status": "fail", "db": "fail", "time": now}, status_code=503)
    return {"status": "ok", "db": "ok", "time": now}


app.add_api_route(f"{API_PREFIX}/health", health, methods=["GET"], tags=["Служебные"])
app.add_api_route("/health", health, methods=["GET"], tags=["Служебные"], include_in_schema=False)

# Фронтенд с того же адреса (разработка, docker compose). В продакшене сайт отдаёт nginx — deploy/nginx.conf
if settings.frontend_dir and Path(settings.frontend_dir, "index.html").is_file():
    app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")
