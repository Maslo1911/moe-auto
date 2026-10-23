# Образ собирается из корня репозитория (контекст «.»), чтобы вместе с бэкендом в него попал фронтенд:
#   docker build -f backend/Dockerfile .
# Так собирают и docker-compose.yml, и Render (render.yaml).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    FRONTEND_DIR=/app/frontend
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY frontend/ ./frontend/
RUN useradd --create-home bja && mkdir -p /app/logs && chown bja /app/logs
USER bja

EXPOSE 8000
# Миграции → справочники (и демо-данные при SEED_DEMO=1) → сервер.
# Порт берётся из PORT (его задаёт Render), по умолчанию 8000; число процессов — из WEB_CONCURRENCY (по умолчанию 2)
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed $( [ \"$SEED_DEMO\" = 1 ] && echo --demo ) && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-2} --proxy-headers --forwarded-allow-ips '*'"]
