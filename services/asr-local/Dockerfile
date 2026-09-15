# Motor de transcrição LOCAL — Whisper + pyannote.
#
# É o motor do plano grátis. O áudio da consulta nunca sai deste container:
# nenhuma chamada externa, nenhum fornecedor, nenhuma transferência
# internacional de dado de saúde. A promessa "dados no Brasil" começa aqui.

FROM python:3.12-slim

# ffmpeg decodifica praticamente qualquer formato de áudio que o navegador
# ou o celular produzir (webm, m4a, ogg…). Sem ele, só WAV funciona.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Torch CPU-only ANTES do resto. Se o pyannote puxar torch sozinho, ele traz a
# build com CUDA — 2,5 GB de drivers de GPU num container que roda em CPU.
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      torch==2.5.1 torchaudio==2.5.1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Os modelos são baixados na primeira execução e ficam num volume. Sem isso,
# cada `docker compose up` rebaixaria gigabytes.
ENV HF_HOME=/models \
    WHISPER_MODEL=medium \
    WHISPER_COMPUTE_TYPE=int8 \
    WHISPER_LANGUAGE=pt

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
