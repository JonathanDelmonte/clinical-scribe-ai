"""
A limpeza de áudio ajuda a separar as vozes?

Roda dentro do container do motor, importando as funções do próprio serviço —
então mede o caminho de produção. Mas em processo separado: o serviço que está
no ar não é tocado.

O Whisper NÃO é rodado de novo. A limpeza, por desenho, só vai para o caminho
das vozes; o texto é o mesmo nas duas condições. Os trechos vêm de uma
transcrição já feita (sem vocabulário, sem diarização) e cada um é atribuído a
um falante pela diarização de cada condição.
"""

import json
import sys
import time

import numpy as np
import torch
import torchaudio

sys.path.insert(0, "/app")
import app as svc  # noqa: E402

AUDIO = sys.argv[1]
TRECHOS = sys.argv[2]
SAIDA = sys.argv[3]
LIMPO = sys.argv[4]
SR = svc.SAMPLE_RATE

audio = svc.decode_audio(AUDIO, sampling_rate=SR).astype(np.float32)
# A limpeza rodou em outro processo, com a GPU escondida: na GPU o GRU da rede
# recusa a consulta inteira de uma vez, e a biblioteca não obedece a pedidos
# para usar a CPU — ela guarda a escolha de dispositivo em mais de um lugar.
limpo = np.load(LIMPO).astype(np.float32)
print(f"áudio: {len(audio) / SR:.1f}s · limpo: {len(limpo) / SR:.1f}s", flush=True)

# ---------------------------------------------------------------- alinhamento
# Correlação cruzada num trecho com fala: onde o pico cai é o deslocamento.
# Qualquer valor diferente de zero desloca a diarização em relação às palavras.
ini, n = 60 * SR, 20 * SR
a, b = audio[ini : ini + n], limpo[ini : ini + n]
janela = 800  # ±50 ms
corr = [
    float(np.dot(a[janela:-janela], b[janela + k : len(b) - janela + k]))
    for k in range(-janela, janela + 1)
]
atraso = int(np.argmax(corr)) - janela
print(f"atraso da versão limpa: {atraso} amostras ({atraso / SR * 1000:.1f} ms)", flush=True)

# ---------------------------------------------------------------- diarização
trechos = json.loads(open(TRECHOS, encoding="utf-8").read())["segments"]
resultado = {"atraso_amostras": atraso}

for nome, sinal in (("cru", audio), ("limpo", limpo)):
    t = time.time()
    turnos = svc.diarize(sinal, None)
    tempo = time.time() - t

    rotulados = []
    for s in trechos:
        ini_s, fim_s = s["start_ms"] / 1000, s["end_ms"] / 1000
        rotulados.append({**s, "speaker_label": svc.speaker_of(ini_s, fim_s, turnos)})

    # Impressão vocal de cada trecho, NA VERSÃO DO ÁUDIO desta condição.
    vetores: dict[str, list[np.ndarray]] = {}
    for s in rotulados:
        i0, i1 = int(s["start_ms"] / 1000 * SR), int(s["end_ms"] / 1000 * SR)
        if (i1 - i0) / SR < svc.MIN_VOICE_SAMPLE_S:
            continue
        v = svc.voice_embedding(sinal[i0:i1])
        if v is not None:
            vetores.setdefault(s["speaker_label"], []).append(np.asarray(v))

    # Coesão: cada fala parecida com o centro do próprio falante.
    # Afastamento: os centros dos dois falantes diferentes entre si.
    centros = {k: np.mean(v, axis=0) for k, v in vetores.items() if len(v) >= 3}
    centros = {k: c / np.linalg.norm(c) for k, c in centros.items()}
    coesao = float(
        np.mean([float(np.dot(v / np.linalg.norm(v), centros[k])) for k, vs in vetores.items() if k in centros for v in vs])
    )
    rotulos = sorted(centros)
    entre = (
        float(np.dot(centros[rotulos[0]], centros[rotulos[1]])) if len(rotulos) >= 2 else float("nan")
    )

    trocas = sum(1 for p, q in zip(rotulados, rotulados[1:]) if p["speaker_label"] != q["speaker_label"])
    curtos = sum(1 for a0, a1, _ in turnos if a1 - a0 < 0.7)

    resultado[nome] = {
        "segundos": round(tempo, 1),
        "falantes": len({l for *_, l in turnos}),
        "turnos": len(turnos),
        "turnos_curtos": curtos,
        "trocas_de_falante": trocas,
        "coesao": round(coesao, 3),
        "entre_centros": round(entre, 3),
        "margem": round(coesao - entre, 3),
        "segmentos": rotulados,
    }
    print(
        f"{nome:5}: {resultado[nome]['falantes']} falantes · {len(turnos)} turnos "
        f"({curtos} curtos) · coesão {coesao:.3f} · entre centros {entre:.3f} · "
        f"margem {coesao - entre:.3f} · {tempo:.1f}s",
        flush=True,
    )

json.dump(resultado, open(SAIDA, "w", encoding="utf-8"), ensure_ascii=False)
print("FIM", flush=True)
