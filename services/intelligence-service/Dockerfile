FROM python:3.12-slim
WORKDIR /app

# Tesseract is the OCR fallback for scanned documents (phase 3).
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app
# documents: PDF/OCR · ml: Isolation Forest · ai: Gemini and ElevenLabs adapters.
RUN pip install --no-cache-dir -e ".[documents,ml,ai]"

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
