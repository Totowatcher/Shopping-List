# Shopping-List API
FROM python:3.12-slim-bookworm
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY web/backend/ /app/web/backend/

WORKDIR /app/web/backend
RUN python -m venv .venv \
    && .venv/bin/pip install --no-cache-dir -r requirements.txt

ENV PATH="/app/web/backend/.venv/bin:$PATH"

EXPOSE 8004
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004"]
