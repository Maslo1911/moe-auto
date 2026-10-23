FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN useradd --create-home bja && mkdir -p /app/logs && chown bja /app/logs
USER bja

EXPOSE 8000
# Миграции → справочники (и демо-данные при SEED_DEMO=1) → сервер
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed $( [ \"$SEED_DEMO\" = 1 ] && echo --demo ) && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --workers 2"]
