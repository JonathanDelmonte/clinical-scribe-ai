"""
Motor de transcrição local — Whisper + pyannote.

Expõe a mesma forma de resposta que o worker espera de qualquer fornecedor de
ASR, para que trocar `local` por `cloud` seja uma linha de configuração e não
uma reescrita.

O áudio entra, os trechos saem, e nada sai deste container pela rede.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import struct
import tempfile
import threading
import time
from typing import Any, Sequence

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from faster_whisper import BatchedInferencePipeline, WhisperModel
from faster_whisper.audio import decode_audio

import canais

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("asr-local")

SAMPLE_RATE = 16000

MODEL_SIZE = os.getenv("WHISPER_MODEL", "medium")
LANGUAGE = os.getenv("WHISPER_LANGUAGE", "pt")

# "auto" resolve para cuda quando houver GPU visível. Um valor fixo permite
# forçar CPU numa máquina com GPU, o que é útil para medir a diferença.
DEVICE_SETTING = os.getenv("WHISPER_DEVICE", "auto")

# Feixe de busca. 5 dá texto melhor; 1 é cerca de duas vezes mais rápido.
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "5"))

# Inferência em lote. DESLIGADA por padrão, e isso é decisão de segurança
# clínica, não de desempenho.
#
# O lote é ~2x mais rápido, mas TRUNCA áudio em que o VAD encontra uma única
# região contínua maior que a janela de 30s do Whisper: transcreve os primeiros
# 30 segundos e descarta o resto, sem erro e com aparência de sucesso. Duas
# pessoas conversando sem pausas longas produzem exatamente esse padrão, e o
# que se perde no fim de uma consulta é a conduta. Ver ADR-0002.
BATCH_SIZE = int(os.getenv("WHISPER_BATCH_SIZE", "0"))

# Realimentar o texto anterior como contexto é o padrão do Whisper e causa duas
# falhas medidas: encerrar a transcrição antes do fim do áudio e alucinar um
# fecho ("Obrigado.") que ninguém disse.
CONDITION_ON_PREVIOUS = (
    os.getenv("WHISPER_CONDITION_ON_PREVIOUS", "false").lower() == "true"
)

# Quanto de áudio final pode ficar sem transcrição antes de considerarmos que
# algo se perdeu. Silêncio no fim da gravação é normal; meio minuto não é.
MAX_UNCOVERED_S = float(os.getenv("MAX_UNCOVERED_SECONDS", "5"))

# Modelo de impressão vocal — o Método A da §7 da documentação.
#
# 256 dimensões. Comparar dois vetores por produto interno diz o quanto duas
# falas vieram da mesma pessoa. Medido aqui com duas vozes sintéticas: mesma
# voz 0,49, vozes diferentes 0,19.
EMBEDDING_MODEL = os.getenv(
    "EMBEDDING_MODEL", "pyannote/wespeaker-voxceleb-resnet34-LM"
)
EMBEDDING_DIMENSIONS = 256

# Trechos curtos não dão impressão vocal confiável: meio segundo de "sim" não
# carrega timbre suficiente. Abaixo disto o trecho herda a decisão do grupo.
MIN_VOICE_SAMPLE_S = float(os.getenv("MIN_VOICE_SAMPLE_SECONDS", "1.2"))

HF_TOKEN = os.getenv("HF_TOKEN", "").strip()
DIARIZATION_MODEL = os.getenv("DIARIZATION_MODEL", "pyannote/speaker-diarization-3.1")

# Limites da reconstrução de trechos a partir das palavras. Ver `build_segments`.
MAX_GAP_S = float(os.getenv("SEGMENT_MAX_GAP_S", "0.8"))
MAX_SEGMENT_S = float(os.getenv("SEGMENT_MAX_SECONDS", "18"))

SENTENCE_END = re.compile(r"[.!?…]$")

# Uma troca de falante mais curta que isto e com menos palavras que isto não é
# troca de turno — é ruído da diarização, e precisa ser absorvida.
#
# Ninguém toma o turno da conversa para dizer meia palavra. Quando duas pessoas
# falam por cima (máscara, microfone ruim, sala com murmúrio de fundo), o
# pyannote emite turnos sobrepostos, e casar palavra a palavra com o turno de
# maior sobreposição oscila perto das bordas. Medido num áudio real de
# consulta: 147 turnos do pyannote viraram 234 trechos, com "tudo bem" partido
# entre dois falantes.
MIN_TURN_S = float(os.getenv("SEGMENT_MIN_TURN_SECONDS", "0.7"))
MIN_TURN_WORDS = int(os.getenv("SEGMENT_MIN_TURN_WORDS", "3"))

# Intervalo mínimo entre palavras para que uma troca de falante seja aceita.
#
# Ninguém toma o turno da conversa sem que haja uma pausa. Duas palavras
# coladas — menos de dois décimos de segundo entre elas — são a mesma pessoa
# continuando a falar, e uma fronteira de falante ali é erro do modelo.
#
# Medido no áudio real de consulta: 49 dos 147 turnos do pyannote duram menos
# de 0,7s, e os erros visíveis caíam no meio de frases sem pausa alguma
# ("Me" | "chamo Gabriel.", "Vou fazer uma" | "coisa.").
MIN_SWITCH_GAP_S = float(os.getenv("SEGMENT_MIN_SWITCH_GAP_SECONDS", "0.2"))

# Peso de cada fase no progresso total. Medido: transcrever 11 min de áudio
# levou ~57s e separar as vozes ~34s, então a transcrição vale cerca de dois
# terços. Aproximado serve: o objetivo é uma barra que não trava nem salta.
PESO_TRANSCRICAO = 0.65
PESO_DIARIZACAO = 0.30


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

app = FastAPI(title="asr-local", version="0.3.0")

_whisper: WhisperModel | None = None
_batched: Any | None = None
_diarizer: Any | None = None
_diarizer_error: str | None = None
_embedder: Any | None = None

# -----------------------------------------------------------------------------
# Progresso
#
# O profissional fica olhando uma tela enquanto a consulta processa. Um
# indicador que só gira não diz se faltam dez segundos ou dez minutos, e a
# diferença entre esperar informado e esperar no escuro é grande.
#
# Isto é progresso REAL, não estimativa de relógio: o faster-whisper devolve os
# trechos num gerador, então sabemos exatamente até que segundo do áudio ele já
# chegou. O pyannote reporta pelo seu próprio hook.
# -----------------------------------------------------------------------------
_progress: dict[str, dict[str, Any]] = {}
_progress_lock = threading.Lock()


def set_progress(job: str | None, **campos: Any) -> None:
    if job is None:
        return
    with _progress_lock:
        atual = _progress.setdefault(job, {"iniciado_em": time.time()})
        atual.update(campos)
        decorrido = time.time() - atual["iniciado_em"]
        atual["elapsed_s"] = round(decorrido, 1)
        pct = atual.get("percent", 0)
        # ETA só a partir de 5%: antes disso a extrapolação é ruído, e um
        # número que despenca de "faltam 40 min" para "faltam 2 min" corrói a
        # confiança mais do que não mostrar nada.
        atual["eta_s"] = (
            round(decorrido * (100 - pct) / pct) if 5 <= pct < 100 else None
        )


@app.get("/progress/{job}")
def get_progress(job: str) -> dict[str, Any]:
    with _progress_lock:
        return dict(_progress.get(job, {"phase": "unknown", "percent": 0}))


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
    """Pipeline em lote quando pedido, ou o modelo direto."""
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
# Impressão vocal
# -----------------------------------------------------------------------------


def get_embedder() -> Any | None:
    """Modelo que transforma um pedaço de fala num vetor de 256 números."""
    global _embedder
    if _embedder is None and HF_TOKEN:
        try:
            import torch
            from pyannote.audio.pipelines.speaker_verification import (
                PretrainedSpeakerEmbedding,
            )

            log.info("carregando impressão vocal %s", EMBEDDING_MODEL)
            _embedder = PretrainedSpeakerEmbedding(
                EMBEDDING_MODEL,
                device=torch.device(DEVICE if DEVICE == "cuda" else "cpu"),
                use_auth_token=HF_TOKEN,
            )
        except Exception as exc:  # noqa: BLE001
            log.error("falha ao carregar impressão vocal: %s", exc)
    return _embedder


def _normalizar(v: np.ndarray) -> np.ndarray:
    """
    Deixa o vetor com comprimento 1.

    Com vetores normalizados o produto interno JÁ é a similaridade de cosseno,
    o que torna a comparação uma multiplicação de matriz — importante quando são
    centenas de trechos contra uma referência.
    """
    norma = float(np.linalg.norm(v))
    return v / norma if norma > 0 else v


def voice_embedding(audio: np.ndarray) -> list[float] | None:
    """Impressão vocal de um pedaço de áudio, normalizada."""
    emb = get_embedder()
    if emb is None or len(audio) < MIN_VOICE_SAMPLE_S * SAMPLE_RATE:
        return None
    import torch

    tensor = torch.from_numpy(audio).unsqueeze(0).unsqueeze(0)
    vetor = np.asarray(emb(tensor)).ravel().astype(np.float32)
    if not np.all(np.isfinite(vetor)):
        return None
    return _normalizar(vetor).tolist()


def similaridades_por_trecho(
    audio: np.ndarray,
    segments: list[dict[str, Any]],
    referencia: Sequence[float],
) -> None:
    """
    Anota em cada trecho o quanto ele soa como a voz cadastrada.

    Preenche `voice_similarity` no lugar, de −1 a 1.

    É aqui que o Método A ganha da classificação por conteúdo: o conteúdo
    decide QUAL GRUPO é o profissional, olhando a conversa inteira. Isto
    responde por TRECHO — e é o trecho que a diarização erra. Numa consulta
    real medida aqui, falas do médico foram parar no rótulo da paciente; nenhum
    sinal textual conserta isso, mas a voz sim.
    """
    emb = get_embedder()
    if emb is None:
        return
    ref = _normalizar(np.asarray(referencia, dtype=np.float32))

    for seg in segments:
        inicio = int(seg["start_ms"] / 1000 * SAMPLE_RATE)
        fim = int(seg["end_ms"] / 1000 * SAMPLE_RATE)
        pedaco = audio[inicio:fim]
        vetor = voice_embedding(pedaco)
        # Trecho curto demais fica sem nota em vez de receber uma nota ruim:
        # similaridade de um "sim" de meio segundo é ruído, e ruído com
        # aparência de medida é pior que ausência de medida.
        seg["voice_similarity"] = (
            round(float(np.asarray(vetor, dtype=np.float32) @ ref), 4)
            if vetor is not None
            else None
        )


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


def smooth_speakers(words: Sequence[Any], speakers: list[str]) -> list[str]:
    """
    Corrige trocas de falante que não podem ser reais.

    Duas passadas, em ordem:

    1. TROCA SEM PAUSA — palavras coladas são a mesma pessoa. Esta é a regra
       forte: uma fronteira de falante no meio de uma frase corrida é sempre
       erro do modelo, porque a fala humana não funciona assim.

    2. TURNO CURTO DEMAIS — sequência de poucas palavras e pouco tempo cercada
       pelo MESMO outro falante dos dois lados. A exigência de que os dois lados
       coincidam evita estragar uma troca legítima: A→B→C não é suavizado, só
       A→B→A.
    """
    if not words:
        return speakers

    # ---- passada 1: nenhuma troca sem pausa --------------------------------
    speakers = list(speakers)
    for i in range(1, len(words)):
        intervalo = words[i].start - words[i - 1].end
        if speakers[i] != speakers[i - 1] and intervalo < MIN_SWITCH_GAP_S:
            speakers[i] = speakers[i - 1]

    # ---- passada 2: blocos curtos demais ----------------------------------
    # Agrupa em blocos de mesmo falante: (inicio, fim_exclusivo, falante)
    blocos: list[list[Any]] = []
    for i, spk in enumerate(speakers):
        if blocos and blocos[-1][2] == spk:
            blocos[-1][1] = i + 1
        else:
            blocos.append([i, i + 1, spk])

    for b in range(1, len(blocos) - 1):
        ini, fim, _ = blocos[b]
        anterior, seguinte = blocos[b - 1][2], blocos[b + 1][2]
        if anterior != seguinte:
            continue
        duracao = words[fim - 1].end - words[ini].start
        if (fim - ini) <= MIN_TURN_WORDS and duracao <= MIN_TURN_S:
            blocos[b][2] = anterior

    suavizado = list(speakers)
    for ini, fim, spk in blocos:
        for i in range(ini, fim):
            suavizado[i] = spk
    return suavizado


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
    falantes = (
        smooth_speakers(
            words,
            [speaker_of(w.start, w.end, turns) for w in words],
        )
        if turns is not None
        else ["SPEAKER_00"] * len(words)
    )

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

    for indice, word in enumerate(words):
        speaker = falantes[indice]

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


def diarize(
    audio: np.ndarray, job: str | None
) -> list[tuple[float, float, str]] | None:
    """
    Separa as vozes, reportando progresso.

    Recebe a FORMA DE ONDA já decodificada, não o caminho do arquivo, e isso é
    correção de bug, não otimização: entregando o caminho, o pyannote decodifica
    por conta própria com o torchaudio, e para MP3 o resultado não fecha com a
    janela de embedding de 10s — quebra com "Sizes of tensors must match except
    in dimension 0. Expected size 160000 but got size 145516".

    Decodificar uma vez com o ffmpeg e passar o mesmo vetor para os dois modelos
    resolve a quebra, elimina a decodificação dupla, e garante que os timestamps
    do Whisper e os turnos do pyannote se refiram exatamente ao mesmo áudio —
    o que importa, porque um é casado com o outro em `build_segments`.
    """
    diarizer = get_diarizer()
    if diarizer is None:
        return None

    import torch

    class Hook:
        """Traduz o andamento interno do pyannote para a nossa escala."""

        def __call__(
            self,
            step: str,
            _artifact: Any = None,
            file: Any = None,
            total: int | None = None,
            completed: int | None = None,
        ) -> None:
            if total and completed is not None:
                fracao = min(1.0, completed / total)
                set_progress(
                    job,
                    phase="diarizing",
                    phase_label="separando as vozes",
                    percent=round((PESO_TRANSCRICAO + PESO_DIARIZACAO * fracao) * 100),
                )

    waveform = torch.from_numpy(audio).unsqueeze(0)
    annotation = diarizer(
        {"waveform": waveform, "sample_rate": SAMPLE_RATE}, hook=Hook()
    )
    return [
        (turn.start, turn.end, speaker)
        for turn, _, speaker in annotation.itertracks(yield_label=True)
    ]


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


@app.post("/voice-embedding")
async def create_voice_embedding(file: UploadFile = File(...)) -> dict[str, Any]:
    """
    Cadastra a voz do profissional.

    Recebe uma amostra de fala e devolve o vetor que a representa. É o passo
    único de configuração: depois disso, toda consulta pode ser comparada com
    esta referência.
    """
    if file.filename is None:
        raise HTTPException(status_code=400, detail="arquivo sem nome")
    suffix = os.path.splitext(file.filename)[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        path = tmp.name
    try:
        audio = await asyncio.to_thread(decode_audio, path, SAMPLE_RATE)
        duracao = len(audio) / SAMPLE_RATE
        if duracao < 5:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"amostra curta demais ({duracao:.1f}s). Fale por pelo menos "
                    "5 segundos — quanto mais fala, mais estável a impressão."
                ),
            )
        vetor = await asyncio.to_thread(voice_embedding, audio)
        if vetor is None:
            raise HTTPException(
                status_code=503,
                detail="impressão vocal indisponível — verifique o HF_TOKEN",
            )
        return {
            "embedding": vetor,
            "dimensions": len(vetor),
            "duration_s": round(duracao, 1),
            "model": EMBEDDING_MODEL,
        }
    finally:
        os.unlink(path)


@app.post("/diarize-channels")
async def diarize_channels(
    principal: UploadFile = File(...),
    envelope: UploadFile = File(...),
    regioes: str = Form(default=""),
    duracao_original_ms: float = Form(default=0),
) -> dict[str, Any]:
    """
    Quem falou quando, a partir de DOIS microfones — um perto de cada pessoa.

    `principal` é o áudio da sessão. `envelope` NÃO é áudio: é a energia do
    segundo microfone a cada 5 ms, medida no navegador — a gravação do lado do
    paciente nunca sai do aparelho de quem a fez. Ver `canais.py`.

    `regioes` é o mapa de fala do navegador, quando ele cortou o silêncio do
    principal: sem ele não há como alinhar um arquivo comprimido no tempo com
    outro que não foi.

    Devolve os turnos no tempo do áudio PRINCIPAL — o mesmo dos trechos já
    transcritos — e o que foi medido pelo caminho. `confiavel: false` não é
    erro: é a resposta honesta de que os dois microfones não separaram as
    pessoas, e quem chamou deve manter a diarização que já tinha.
    """
    try:
        energia_b = canais.decodificar_envelope(await envelope.read())
    except canais.EnvelopeInvalido as erro:
        raise HTTPException(status_code=400, detail=str(erro)) from erro

    mapa: list[dict] = []
    if regioes.strip() != "":
        try:
            bruto = json.loads(regioes)
        except (ValueError, TypeError) as erro:
            # Mapa ilegível: seguir como se o áudio não tivesse sido cortado
            # daria um alinhamento errado em silêncio. Melhor recusar.
            raise HTTPException(status_code=400, detail="mapa de regiões ilegível") from erro
        if isinstance(bruto, list):
            mapa = [r for r in bruto if isinstance(r, dict) and "startMs" in r and "endMs" in r]

    sufixo = os.path.splitext(principal.filename or "")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=sufixo, delete=False) as tmp:
        tmp.write(await principal.read())
        caminho = tmp.name

    try:
        return await asyncio.to_thread(
            _diarizar_canais, caminho, energia_b, mapa, duracao_original_ms / 1000
        )
    finally:
        try:
            os.unlink(caminho)
        except OSError:
            pass


def _diarizar_canais(
    caminho: str, energia_b: np.ndarray, regioes: list[dict], duracao_original_s: float
) -> dict[str, Any]:
    inicio = time.time()
    a = decode_audio(caminho, sampling_rate=SAMPLE_RATE).astype(np.float32)
    resultado = canais.diarizar_sessao(a, energia_b, regioes, duracao_original_s)
    al = resultado["alinhamento"]
    log.info(
        "diarização por canal: deslocamento %.3fs, deriva %+.0f ppm, qualidade %.2f, "
        "separação %s dB, cobertura %s, confiável %s",
        al["deslocamento_s"],
        al["deriva_ppm"],
        al["qualidade"],
        resultado.get("separacao_db"),
        resultado.get("cobertura"),
        resultado["confiavel"],
    )
    return {**resultado, "segundos": round(time.time() - inicio, 1)}


# ---------------------------------------------------------------------------
# Conversão — o que o navegador não lê


def _decodificar_ou_415(caminho: str) -> np.ndarray:
    """Decodifica para 16 kHz mono, ou recusa com 415.

    Quem chega aqui é o arquivo que o NAVEGADOR não conseguiu ler: AMR de
    gravador antigo de Android, WMA, ALAC do iPhone, AIFF, DSS de ditafone,
    WAV em ADPCM. O ffmpeg lê quase tudo; o que nem ele lê não é áudio, e a
    resposta certa é dizer isso — não um 500, que o worker tentaria de novo
    três vezes à toa.
    """
    try:
        audio = decode_audio(caminho, sampling_rate=SAMPLE_RATE)
    except MemoryError:
        raise
    except Exception as erro:  # o arquivo vem de fora: qualquer falha é "ilegível"
        raise HTTPException(
            status_code=415,
            detail=f"o arquivo não é um áudio que o sistema consiga ler ({type(erro).__name__})",
        ) from erro
    if len(audio) < SAMPLE_RATE // 10:
        raise HTTPException(status_code=415, detail="o arquivo não tem áudio")
    return audio.astype(np.float32)


async def _guardar_temporario(arquivo: UploadFile) -> str:
    """O upload em disco, copiado em blocos — um arquivo de 200 MB não passa pela memória."""
    sufixo = os.path.splitext(arquivo.filename or "")[1] or ".bin"
    with tempfile.NamedTemporaryFile(suffix=sufixo, delete=False) as tmp:
        await asyncio.to_thread(shutil.copyfileobj, arquivo.file, tmp, 1024 * 1024)
        return tmp.name


def _apagar(caminho: str) -> None:
    try:
        os.unlink(caminho)
    except OSError:
        pass


def _wav_pcm16(audio: np.ndarray) -> bytes:
    """WAV PCM 16 bits mono — o mesmo que `paraWav`, em prepare.ts, produz no navegador."""
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    cabecalho = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + pcm.nbytes, b"WAVE",
        b"fmt ", 16, 1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16,
        b"data", pcm.nbytes,
    )
    return cabecalho + pcm.tobytes()


@app.post("/convert")
async def convert(file: UploadFile = File(...)) -> Response:
    """
    Qualquer áudio (ou vídeo) que o ffmpeg leia → WAV 16 kHz, mono, 16 bits.

    O conversor universal do produto. O navegador prepara sozinho tudo o que
    ele decodifica; o resto chega aqui pelo worker e sai no mesmo WAV que o
    navegador teria feito: tocável na tela da consulta — as citações da nota
    dependem de ouvir o trecho — e igual para todo o resto do caminho.
    """
    caminho = await _guardar_temporario(file)
    try:
        audio = await asyncio.to_thread(_decodificar_ou_415, caminho)
    finally:
        _apagar(caminho)
    wav = await asyncio.to_thread(_wav_pcm16, audio)
    duracao_ms = round(len(audio) * 1000 / SAMPLE_RATE)
    log.info("convertido para WAV: %s, %.1f min", sufixo_de(file), duracao_ms / 60000)
    return Response(content=wav, media_type="audio/wav", headers={"x-duracao-ms": str(duracao_ms)})


@app.post("/envelope")
async def envelope(file: UploadFile = File(...)) -> Response:
    """
    Qualquer áudio que o ffmpeg leia → só a energia a cada 5 ms (formato CVE1).

    O segundo microfone quando o navegador não lê o arquivo. A gravação não é
    guardada aqui nem em lugar nenhum: vira medida, e o temporário é apagado
    antes da resposta — o mesmo resultado que o navegador teria mandado.
    """
    caminho = await _guardar_temporario(file)
    try:
        audio = await asyncio.to_thread(_decodificar_ou_415, caminho)
    finally:
        _apagar(caminho)
    energia = canais.energia_por_passo(audio)
    if len(energia) > canais.MAX_PASSOS:
        raise HTTPException(status_code=413, detail="gravação longa demais: o segundo microfone aceita até 4 horas")
    duracao_ms = round(len(audio) * 1000 / SAMPLE_RATE)
    log.info("segundo microfone medido no servidor: %s, %.1f min", sufixo_de(file), duracao_ms / 60000)
    return Response(
        content=canais.codificar_envelope(energia),
        media_type="application/octet-stream",
        headers={"x-duracao-ms": str(duracao_ms)},
    )


def sufixo_de(arquivo: UploadFile) -> str:
    """Só a extensão vai para o log — o nome do arquivo pode ter o nome do paciente."""
    return os.path.splitext(arquivo.filename or "")[1].lower() or "(sem extensão)"


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Query(default=LANGUAGE),
    diarize_speakers: bool = Query(default=True, alias="diarize"),
    job: str | None = Query(default=None),
    professional_embedding: str = Form(default=""),
    vocabulary: str = Form(default=""),
) -> dict[str, Any]:
    """
    Recebe o áudio e devolve os trechos.

    Só a leitura do upload acontece no laço de eventos; o processamento vai
    para uma thread separada via `asyncio.to_thread`.

    Isso não é otimização, é o que torna o progresso possível. O Whisper e o
    pyannote bloqueiam a thread por minutos, e dentro de um `async def` isso
    congela o laço inteiro: `/progress/{job}` fica sem resposta exatamente
    enquanto há progresso para reportar. O sintoma engana, porque o endpoint
    responde normalmente quando testado fora de um processamento.
    """
    if file.filename is None:
        raise HTTPException(status_code=400, detail="arquivo sem nome")

    suffix = os.path.splitext(file.filename)[1] or ".wav"
    set_progress(job, phase="decoding", phase_label="preparando o áudio", percent=1)

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        path = tmp.name

    referencia: list[float] | None = None
    if professional_embedding.strip() != "":
        try:
            bruto = json.loads(professional_embedding)
            if isinstance(bruto, list) and len(bruto) == EMBEDDING_DIMENSIONS:
                referencia = [float(x) for x in bruto]
            else:
                log.warning(
                    "impressão vocal ignorada: esperava %d números, veio %s",
                    EMBEDDING_DIMENSIONS,
                    len(bruto) if isinstance(bruto, list) else type(bruto).__name__,
                )
        except (ValueError, TypeError) as exc:
            # Impressão vocal inválida NÃO derruba a transcrição: ela é uma
            # camada a mais sobre o que já funciona, e perder a camada é muito
            # melhor que perder a consulta.
            log.warning("impressão vocal ilegível, seguindo sem ela: %s", exc)

    return await asyncio.to_thread(
        _processar,
        path,
        language,
        diarize_speakers,
        job,
        referencia,
        vocabulary.strip() or None,
    )


def _processar(
    path: str,
    language: str,
    diarize_speakers: bool,
    job: str | None,
    referencia: Sequence[float] | None,
    vocabulario: str | None = None,
) -> dict[str, Any]:
    started = time.time()
    try:
        # Uma decodificação só, compartilhada entre os dois modelos.
        audio = decode_audio(path, sampling_rate=SAMPLE_RATE)
        audio_seconds = len(audio) / SAMPLE_RATE
        set_progress(
            job,
            phase="transcribing",
            phase_label="transcrevendo",
            percent=2,
            audio_s=round(audio_seconds, 1),
        )

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

        # Vocabulário do domínio: `hotwords`, e não `initial_prompt`.
        #
        # Com `condition_on_previous_text` desligado — e ele está desligado
        # porque truncava o fim das consultas — o faster-whisper zera o
        # contexto depois de cada janela de 30 s, levando o `initial_prompt`
        # junto. `hotwords` é reinserido no prompt de TODA janela.
        vocabulario_tokens = 0
        vocabulario_cortado = False
        if vocabulario is not None:
            options["hotwords"] = vocabulario
            # A biblioteca corta pelo fim, em silêncio, acima de metade do
            # contexto. Contar aqui é o único jeito de saber se a lista que o
            # worker mandou chegou inteira ao modelo.
            limite = get_transcriber().max_length // 2 - 1
            vocabulario_tokens = len(
                get_transcriber().hf_tokenizer.encode(
                    " " + vocabulario, add_special_tokens=False
                ).ids
            )
            vocabulario_cortado = vocabulario_tokens > limite
            if vocabulario_cortado:
                log.warning(
                    "vocabulário com %d tokens, acima do limite de %d: o fim foi cortado",
                    vocabulario_tokens,
                    limite,
                )

        raw, info = get_transcriber().transcribe(audio, **options)

        # Consumir o gerador aqui, e não com list(), é o que dá progresso real:
        # cada trecho traz o segundo do áudio onde termina.
        whisper_segments = []
        for seg in raw:
            whisper_segments.append(seg)
            if audio_seconds > 0:
                fracao = min(1.0, seg.end / audio_seconds)
                set_progress(
                    job,
                    phase="transcribing",
                    phase_label="transcrevendo",
                    percent=max(2, round(PESO_TRANSCRICAO * fracao * 100)),
                    transcribed_s=round(seg.end, 1),
                    preview=seg.text.strip()[:120],
                )

        turns: list[tuple[float, float, str]] | None = None
        if diarize_speakers:
            set_progress(
                job,
                phase="diarizing",
                phase_label="separando as vozes",
                percent=round(PESO_TRANSCRICAO * 100),
            )
            turns = diarize(audio, job)

        set_progress(
            job,
            phase="assembling",
            phase_label="montando a transcrição",
            percent=round((PESO_TRANSCRICAO + PESO_DIARIZACAO) * 100),
        )

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

        # ---- impressão vocal por trecho ------------------------------------
        if referencia is not None and segments:
            set_progress(
                job,
                phase="voice",
                phase_label="comparando com a voz cadastrada",
                percent=round((PESO_TRANSCRICAO + PESO_DIARIZACAO) * 100),
            )
            similaridades_por_trecho(audio, segments, referencia)

        elapsed = time.time() - started

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
                audio_seconds,
                last_ms / 1000,
                uncovered_s,
            )

        set_progress(job, phase="done", phase_label="concluído", percent=100)

        return {
            "engine": "local",
            "model": MODEL_SIZE,
            "language": info.language,
            "duration_ms": int(audio_seconds * 1000),
            "processing_ms": int(elapsed * 1000),
            "realtime_factor": round(audio_seconds / elapsed, 2) if elapsed else None,
            "truncated": truncated,
            "uncovered_ms": int(uncovered_s * 1000),
            "voice_matching_applied": referencia is not None,
            "vocabulary_tokens": vocabulario_tokens,
            "vocabulary_truncated": vocabulario_cortado,
            "diarization_applied": turns is not None,
            "diarization_error": None if turns is not None else _diarizer_error,
            "speakers": sorted({s["speaker_label"] for s in segments}),
            "segments": segments,
        }
    except Exception as exc:
        set_progress(job, phase="failed", phase_label="falhou", error=str(exc)[:200])
        raise
    finally:
        os.unlink(path)
        # Guardar progresso de job concluído para sempre vaza memória num
        # serviço de vida longa. Meia hora é folga suficiente para a interface
        # ler o estado final.
        if job is not None:
            with _progress_lock:
                velhos = [
                    k
                    for k, v in _progress.items()
                    if time.time() - v.get("iniciado_em", 0) > 1800
                ]
                for k in velhos:
                    _progress.pop(k, None)
