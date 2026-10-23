"""Ошибки API в едином формате (п. 1.2 docs/API.md):
{"error": {"code": "...", "message": "...", "fields": {...}}}"""
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, fields: dict[str, str] | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields or {}


def error_response(status: int, code: str, message: str, fields: dict[str, str] | None = None) -> JSONResponse:
    body: dict = {"code": code, "message": message}
    if fields:
        body["fields"] = fields
    return JSONResponse({"error": body}, status_code=status)


def invalid(fields: dict[str, str], message: str = "Проверьте заполнение полей") -> ApiError:
    return ApiError(422, "VALIDATION_ERROR", message, fields)


def not_found(message: str = "Запись не найдена") -> ApiError:
    return ApiError(404, "NOT_FOUND", message)


def unauthorized() -> ApiError:
    return ApiError(401, "UNAUTHORIZED", "Сеанс завершён, войдите снова")


def forbidden() -> ApiError:
    return ApiError(403, "FORBIDDEN", "Действие доступно только администратору")


def maintenance() -> ApiError:
    return ApiError(503, "MAINTENANCE", "Идут технические работы. Данные сохранены, попробуйте позже")
