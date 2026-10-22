FROM python:3.11-slim

# Evitar prompts interactivos
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Instalar dependencias del sistema (ffmpeg para whisper, libs para playwright)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    wget \
    gnupg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Directorio de trabajo
WORKDIR /app

# Copiar requirements primero (para cache de Docker)
COPY requirements.txt .

# Instalar dependencias de Python
# Usar CPU-only torch para reducir tamaño de imagen
RUN pip install --no-cache-dir \
    torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# Instalar Playwright y Chromium
RUN playwright install chromium --with-deps

# Pre-descargar modelo Whisper base en caché
RUN python -c "import whisper; whisper.load_model('base')"

# Copiar el resto del proyecto
COPY . .

# Crear directorios necesarios
RUN mkdir -p transcripciones predicaciones

# Exponer puerto
EXPOSE 5000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5000/ || exit 1

# Ejecutar con gunicorn para producción
RUN pip install --no-cache-dir gunicorn

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "300", "--worker-class", "gthread", "--threads", "4", "app:app"]
