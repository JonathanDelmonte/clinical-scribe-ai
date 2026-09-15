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
import re
import tempfile
import time
from typing import Any, Sequence

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from faster_whisper import BatchedInferencePipeline, WhisperModel

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("asr-local")

MODEL_SIZE = os.getenv("WHISPER_MODEL", "medium")
LANGUAGE = os.getenv("WHISPER_LANGUAGE", "pt")

# "auto" resolve para cuda quando houver GPU visível. Um valor fixo permite
# forçar CPU numa máquina com GPU, o que é útil para medir a diferença.
DEVICE_SETTING = os.getenv("WHISPER_DEVICE", "auto")

# Feixe de busca. 5 dá texto melhor; 1 é cerca de duas vezes mais rápido.
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "5"))

# Inferência em lote. DESLIGADA por padrão, e isso é uma decisão de segurança
# clínica, não de desempenho.
#
# O lote é ~2x mais rápido (27x contra 12,8x de tempo real nesta máquina), mas
# TRUNCA áudio em que o VAD encontra uma única região contínua maior que a
# janela de 30s do Whisper: ele transcreve os primeiros 30 segundos e descarta
# o resto, sem erro e com aparência de sucesso.
#
# Duas pessoas conversando sem pausas longas produzem exatamente esse padrão.
# Numa consulta de 30 minutos, o produto entregaria o primeiro meio minuto — e
# o que se perde no fim costuma ser a conduta: a receita e a data de retorno.
#
# Dobrar o tempo de 1,2 para 2,5 minutos numa consulta inteira é um preço
# irrisório por não perder a prescrição.
BATCH_SIZE = int(os.getenv("WHISPER_BATCH_SIZE", "0"))

# Realimentar o texto anterior como contexto é o padrão do Whisper e causa duas
# falhas medidas: encerrar a transcrição antes do fim do áudio e alucinar um
# fecho ("Obrigado.") que ninguém disse. Desligado, o custo em velocidade é
# desprezível e o texto termina onde o áudio termina.
CONDITION_ON_PREVIOUS = (
    os.getenv("WHISPER_CONDITION_ON_PREVIOUS", "false").lower() == "true"
)

# Quanto de áudio final pode ficar sem transcrição antes de considerarmos que
# algo se perdeu. Silêncio no fim da gravação é normal; meio minuto não é.
MAX_UNCOVERED_S = float(os.getenv("MAX_UNCOVERED_SECONDS", "5"))

HF_TOKEN = os.getenv("HF_TOKEN", "").strip()
DIARIZATION_MODEL = os.getenv("DIARIZATION_MODEL", "pyannote/speaker-diarization-3.1")

# Limites da reconstrução de trechos a partir das palavras. Ver `build_segments`.
MAX_GAP_S = float(os.getenv("SEGMENT_MAX_GAP_S", "0.8"))
MAX_SEGMENT_S = float(os.getenv("SEGMENT_MAX_SECONDS", "18"))

SENTENCE_END = re.compile(r"[.!?…]$")


def resolve_device() -> str:
    """
    Decide entre GPU e CPU.

    Pergunta ao ctranslate2, não ao torch: é o ctranslate2 que roda o Whisper, e
    ele pode não enxergar a GPU mesmo com o torch enxergando — normalmente por
    falta da cuDNN na imagem. Perguntar à biblioteca errada daria um "cuda
    disponível" que falha só na hora de carregar o modelo.
    """
    if DEVICE_SETTING != "auto":
        return DEVICE_SETTING
    try:
        import ctranslate2

        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:  # noqa: BLE001
        return "cpu"


DEVICE = resolve_device()

# float16 é o formato nativo do tensor core; int8 é o que torna a CPU tolerável.
COMPUTE_TYPE = os.getenv(
    "WHISPER_COMPUTE_TYPE", "float16" if DEVICE == "cuda" else "int8"
)

app = FastAPI(title="asr-local", version="0.2.0")

# Carregados sob demanda: subir o container não deve esperar o download.
_whisper: WhisperModel | None = None
_batched: Any | None = None
_diarizer: Any | None = None
_diarizer_error: str | None = None


def get_whisper() -> WhisperModel:
    global _whisper
    if _whisper is None:
        log.info("carregando whisper %s em %s (%s)", MODEL_SIZE, DEVICE, COMPUTE_TYPE)
        started = time.time()
        _whisper = WhisperModel(
            MODEL_SIZE,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
            cpu_threads=os.cpu_count() or 4,
        )
        log.info("whisper pronto em %.1fs", time.time() - started)
    return _whisper


def get_transcriber() -> Any:
    """Pipeline em lote quando faz sentido, ou o modelo direto."""
    global _batched
    model = get_whisper()
    if BATCH_SIZE <= 0:
        return model
    if _batched is None:
        log.info("inferência em lote ativa (batch_size=%d)", BATCH_SIZE)
        _batched = BatchedInferencePipeline(model=model)
    return _batched


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
        _diarizer = Pipeline.from_pretrained(DIARIZATION_MODEL, use_auth_token=HF_TOKEN)
        if DEVICE == "cuda":
            import torch

            _diarizer.to(torch.device("cuda"))
        log.info("diarização pronta em %.1fs", time.time() - started)
    except Exception as exc:  # noqa: BLE001 — qualquer falha vira degradação
        _diarizer_error = f"falha ao carregar diarização: {exc}"
        log.error(_diarizer_error)
    return _diarizer


# -----------------------------------------------------------------------------
# Reconstrução de trechos a partir das palavras
# -----------------------------------------------------------------------------


def speaker_of(
    start: float, end: float, turns: Sequence[tuple[float, float, str]]
) -> str:
    """Falante cujo turno mais cobre o intervalo dado."""
    best, best_overlap = "SPEAKER_00", 0.0
    for turn_start, turn_end, speaker in turns:
        overlap = min(end, turn_end) - max(start, turn_start)
        if overlap > best_overlap:
            best, best_overlap = speaker, overlap
    return best


def build_segments(
    words: Sequence[Any], turns: Sequence[tuple[float, float, str]] | None
) -> list[dict[str, Any]]:
    """
    Agrupa palavras em trechos, quebrando onde importa.

    O Whisper corta por prosódia e pausa, não por troca de falante, e os blocos
    que ele devolve chegam a juntar profissional e paciente num trecho só. Isso
    arruinaria as duas coisas centrais do produto: a separação de vozes (um
    bloco com dois falantes recebe um rótulo só) e as citações (clicar numa
    frase tocaria meio minuto de áudio em vez de cinco segundos).

    A saída é reconstruir os trechos a partir das palavras, que já vêm com
    tempo individual — e cortar onde a conversa realmente muda.

    Quebra em quatro situações, nesta ordem de importância:

      1. TROCA DE FALANTE — o corte que a diarização existe para produzir
      2. PAUSA LONGA      — silêncio costuma marcar troca de turno
      3. FIM DE FRASE     — ponto, interrogação, exclamação
      4. DURAÇÃO MÁXIMA   — trecho longo demais é citação imprecisa
    """
    segments: list[dict[str, Any]] = []
    current: list[Any] = []
    current_speaker = "SPEAKER_00"

    def flush() -> None:
        if not current:
            return
        text = "".join(w.word for w in current).strip()
        if text:
            segments.append(
                {
                    "start_ms": int(current[0].start * 1000),
                    "end_ms": int(current[-1].end * 1000),
                    "text": text,
                    "speaker_label": current_speaker,
                    "confidence": round(
                        sum(getattr(w, "probability", 1.0) or 1.0 for w in current)
                        / len(current),
                        4,
                    ),
                }
            )
        current.clear()

    for word in words:
        speaker = (
            speaker_of(word.start, word.end, turns)
            if turns is not None
            else "SPEAKER_00"
        )

        if current:
            previous = current[-1]
            if (
                speaker != current_speaker
                or word.start - previous.end > MAX_GAP_S
                or SENTENCE_END.search(previous.word.strip()) is not None
                or word.end - current[0].start > MAX_SEGMENT_S
            ):
                flush()

        if not current:
            current_speaker = speaker
        current.append(word)

    flush()
    return segments


@app.get("/health")
def health() -> dict[str, Any]:
    diarizer = get_diarizer()
    return {
        "status": "ok",
        "engine": "local",
        "model": MODEL_SIZE,
        "compute_type": COMPUTE_TYPE,
        "language": LANGUAGE,
        "device": DEVICE,
        "beam_size": BEAM_SIZE,
        "batch_size": BATCH_SIZE,
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
        options: dict[str, Any] = {
            "language": language,
            # VAD corta silêncio antes de transcrever. Numa consulta real há
            # muita pausa — paciente pensando, profissional escrevendo — e sem
            # isso o Whisper alucina texto para preencher o vazio.
            "vad_filter": True,
            "beam_size": BEAM_SIZE,
            # Custa ~18% de tempo e é o que permite reconstruir trechos finos e
            # cortar na troca de falante. Barato pelo que entrega.
            "word_timestamps": True,
            "condition_on_previous_text": CONDITION_ON_PREVIOUS,
        }
        if BATCH_SIZE > 0:
            options["batch_size"] = BATCH_SIZE

        raw, info = get_transcriber().transcribe(path, **options)
        whisper_segments = list(raw)

        # Diarização ANTES de montar os trechos: as fronteiras de falante são o
        # critério de corte mais importante, e aplicá-las depois obrigaria a
        # refazer o agrupamento inteiro.
        turns: list[tuple[float, float, str]] | None = None
        if diarize:
            diarizer = get_diarizer()
            if diarizer is not None:
                annotation = diarizer(path)
                turns = [
                    (turn.start, turn.end, speaker)
                    for turn, _, speaker in annotation.itertracks(yield_label=True)
                ]

        words = [w for seg in whisper_segments for w in (seg.words or [])]

        if words:
            segments = build_segments(words, turns)
        else:
            # Sem tempo por palavra — só acontece se o modelo não os produzir.
            # Cai para os trechos crus: granularidade pior, mas devolver texto é
            # melhor que devolver nada.
            segments = [
                {
                    "start_ms": int(s.start * 1000),
                    "end_ms": int(s.end * 1000),
                    "text": s.text.strip(),
                    "speaker_label": (
                        speaker_of(s.start, s.end, turns)
                        if turns is not None
                        else "SPEAKER_00"
                    ),
                    "confidence": round(
                        min(1.0, max(0.0, 2.718281828**s.avg_logprob)), 4
                    ),
                }
                for s in whisper_segments
            ]

        elapsed = time.time() - started
        audio_seconds = info.duration or 0.0

        # ---- trava de cobertura ------------------------------------------
        # Compara onde o texto termina com onde o áudio termina.
        #
        # Existe porque a falha que ela pega é invisível: o serviço responde
        # 200, devolve texto coerente, e simplesmente omite o final da consulta.
        # Sem esta conferência, a única forma de descobrir seria alguém notar
        # que a receita sumiu da nota — provavelmente depois do paciente ir
        # embora.
        last_ms = max((s["end_ms"] for s in segments), default=0)
        uncovered_s = max(0.0, audio_seconds - last_ms / 1000)
        truncated = uncovered_s > MAX_UNCOVERED_S
        if truncated:
            log.error(
                "TRANSCRICAO INCOMPLETA: audio=%.1fs, texto termina em %.1fs, "
                "faltam %.1fs",
                audio_seconds, last_ms / 1000, uncovered_s,
            )

        return {
            "truncated": truncated,
            "uncovered_ms": int(uncovered_s * 1000),
            "engine": "local",
            "model": MODEL_SIZE,
            "language": info.language,
            "duration_ms": int(audio_seconds * 1000),
            "processing_ms": int(elapsed * 1000),
            # Quanto mais rápido que o tempo real. Abaixo de 1,0 significa que
            # processar demora mais que a consulta durou.
            "realtime_factor": round(audio_seconds / elapsed, 2) if elapsed else None,
            "diarization_applied": turns is not None,
            "diarization_error": None if turns is not None else _diarizer_error,
            "speakers": sorted({s["speaker_label"] for s in segments}),
            "segments": segments,
        }
    finally:
        os.unlink(path)
