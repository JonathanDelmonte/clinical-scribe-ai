"""
Motor de transcrição local — Whisper + pyannote.

Expõe a mesma forma de resposta que o worker espera de qualquer fornecedor de
ASR, para que trocar `local` por `cloud` seja uma linha de configuração e não
uma reescrita.

O áudio entra, os trechos saem, e nada sai deste container pela rede.
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
from typing import Any, Iterable

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("asr-local")

MODEL_SIZE = os.getenv("WHISPER_MODEL", "medium")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
LANGUAGE = os.getenv("WHISPER_LANGUAGE", "pt")
HF_TOKEN = os.getenv("HF_TOKEN", "").strip()
DIARIZATION_MODEL = os.getenv(
    "DIARIZATION_MODEL", "pyannote/speaker-diarization-3.1"
)

app = FastAPI(title="asr-local", version="0.1.0")

# Carregados sob demanda: subir o container não deve esperar 3 GB de download.
_whisper: WhisperModel | None = None
_diarizer: Any | None = None
_diarizer_error: str | None = None


def get_whisper() -> WhisperModel:
    global _whisper
    if _whisper is None:
        log.info("carregando whisper %s (%s)", MODEL_SIZE, COMPUTE_TYPE)
        started = time.time()
        _whisper = WhisperModel(
            MODEL_SIZE,
            device="cpu",
            compute_type=COMPUTE_TYPE,
            cpu_threads=os.cpu_count() or 4,
        )
        log.info("whisper pronto em %.1fs", time.time() - started)
    return _whisper


def get_diarizer() -> Any | None:
    """
    Carrega o pyannote, se houver token.

    A diarização exige aceitar os termos do modelo no Hugging Face e um token.
    Sem isso o serviço continua funcionando — só devolve tudo como um falante
    só. Transcrição sem separação de vozes ainda é útil; serviço que não sobe
    não é.
    """
    global _diarizer, _diarizer_error
    if _diarizer is not None or _diarizer_error is not None:
        return _diarizer
    if not HF_TOKEN:
        _diarizer_error = (
            "HF_TOKEN ausente — defina-o e aceite os termos de "
            f"{DIARIZATION_MODEL} no Hugging Face para habilitar diarização"
        )
        log.warning(_diarizer_error)
        return None
    try:
        from pyannote.audio import Pipeline

        log.info("carregando diarização %s", DIARIZATION_MODEL)
        started = time.time()
        _diarizer = Pipeline.from_pretrained(
            DIARIZATION_MODEL, use_auth_token=HF_TOKEN
        )
        log.info("diarização pronta em %.1fs", time.time() - started)
    except Exception as exc:  # noqa: BLE001 — qualquer falha vira degradação
        _diarizer_error = f"falha ao carregar diarização: {exc}"
        log.error(_diarizer_error)
    return _diarizer


def assign_speakers(
    segments: list[dict[str, Any]], turns: Iterable[tuple[float, float, str]]
) -> None:
    """
    Atribui um falante a cada trecho do Whisper por MAIOR SOBREPOSIÇÃO temporal.

    O Whisper corta por pausa e prosódia; o pyannote corta por troca de voz. Os
    dois cortes não coincidem, então um trecho do Whisper quase sempre cruza
    mais de um turno de fala.

    Escolher pelo início do trecho é a implementação ingênua, e ela erra
    exatamente onde dói: quando alguém completa a frase do outro, o rótulo
    inteiro vai para quem apenas começou falando. Sobreposição máxima acerta
    esse caso — e é ele que o cpWER mede.
    """
    turn_list = list(turns)
    for seg in segments:
        best_speaker, best_overlap = None, 0.0
        for start, end, speaker in turn_list:
            overlap = min(seg["end_ms"] / 1000, end) - max(
                seg["start_ms"] / 1000, start
            )
            if overlap > best_overlap:
                best_speaker, best_overlap = speaker, overlap
        seg["speaker_label"] = best_speaker or "SPEAKER_00"


@app.get("/health")
def health() -> dict[str, Any]:
    diarizer = get_diarizer()
    return {
        "status": "ok",
        "engine": "local",
        "model": MODEL_SIZE,
        "compute_type": COMPUTE_TYPE,
        "language": LANGUAGE,
        "device": "cpu",
        "cpu_threads": os.cpu_count(),
        "model_loaded": _whisper is not None,
        "diarization_available": diarizer is not None,
        "diarization_error": _diarizer_error,
    }


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Query(default=LANGUAGE),
    diarize: bool = Query(default=True),
) -> dict[str, Any]:
    if file.filename is None:
        raise HTTPException(status_code=400, detail="arquivo sem nome")

    suffix = os.path.splitext(file.filename)[1] or ".wav"
    started = time.time()

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        path = tmp.name

    try:
        raw, info = get_whisper().transcribe(
            path,
            language=language,
            # VAD corta silêncio antes de transcrever. Numa consulta real há
            # muita pausa — paciente pensando, profissional escrevendo — e sem
            # isso o Whisper alucina texto para preencher o vazio.
            vad_filter=True,
            beam_size=5,
            word_timestamps=False,
        )

        segments: list[dict[str, Any]] = [
            {
                "start_ms": int(s.start * 1000),
                "end_ms": int(s.end * 1000),
                "text": s.text.strip(),
                "speaker_label": "SPEAKER_00",
                # avg_logprob é log-probabilidade; exp() devolve algo entre 0 e
                # 1, comparável com o que os fornecedores de nuvem reportam.
                "confidence": round(min(1.0, max(0.0, 2.718281828**s.avg_logprob)), 4),
            }
            for s in raw
        ]

        diarization_applied = False
        if diarize and segments:
            diarizer = get_diarizer()
            if diarizer is not None:
                annotation = diarizer(path)
                assign_speakers(
                    segments,
                    (
                        (turn.start, turn.end, speaker)
                        for turn, _, speaker in annotation.itertracks(
                            yield_label=True
                        )
                    ),
                )
                diarization_applied = True

        elapsed = time.time() - started
        audio_seconds = info.duration or 0.0

        return {
            "engine": "local",
            "model": MODEL_SIZE,
            "language": info.language,
            "duration_ms": int(audio_seconds * 1000),
            "processing_ms": int(elapsed * 1000),
            # Quanto mais rápido que o tempo real. Abaixo de 1,0 significa que
            # processar demora mais que a consulta durou — o número que decide
            # se o plano grátis é viável em CPU.
            "realtime_factor": round(audio_seconds / elapsed, 2) if elapsed else None,
            "diarization_applied": diarization_applied,
            "diarization_error": None if diarization_applied else _diarizer_error,
            "speakers": sorted({s["speaker_label"] for s in segments}),
            "segments": segments,
        }
    finally:
        os.unlink(path)
