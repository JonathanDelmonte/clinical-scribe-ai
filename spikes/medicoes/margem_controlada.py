"""Mesma divisão de falantes (a do áudio cru); só muda de onde sai a impressão vocal."""
import json, sys
import numpy as np
sys.path.insert(0, "/app")
import app as svc
SR = svc.SAMPLE_RATE
cru = svc.decode_audio("/tmp/consulta.mp3", sampling_rate=SR).astype(np.float32)
sinais = {"cru": cru, "brando": np.load("/tmp/brando.npy"), "neural": np.load("/tmp/limpo.npy")}
rotulos = json.load(open("/tmp/limpeza.json", encoding="utf-8"))["cru"]["segmentos"]  # FIXO

for nome, sinal in sinais.items():
    vet = {}
    for s in rotulos:
        i0, i1 = int(s["start_ms"] / 1000 * SR), int(s["end_ms"] / 1000 * SR)
        if (i1 - i0) / SR < svc.MIN_VOICE_SAMPLE_S:
            continue
        v = svc.voice_embedding(sinal[i0:i1])
        if v is not None:
            v = np.asarray(v); vet.setdefault(s["speaker_label"], []).append(v / np.linalg.norm(v))
    c = {k: np.mean(v, axis=0) for k, v in vet.items()}
    c = {k: x / np.linalg.norm(x) for k, x in c.items()}
    coesao = np.mean([float(v @ c[k]) for k, vs in vet.items() for v in vs])
    a, b = sorted(c)
    entre = float(c[a] @ c[b])
    # Quantas falas ficam mais perto do PRÓPRIO centro do que do outro: é a
    # pergunta que a camada de voz faz de verdade, fala por fala.
    acertos = sum(1 for k, vs in vet.items() for v in vs
                  if float(v @ c[k]) > float(v @ c[b if k == a else a]))
    n = sum(len(vs) for vs in vet.values())
    print(f"{nome:6}: coesão {coesao:.3f} · entre {entre:.3f} · margem {coesao - entre:.3f} · "
          f"falas mais perto do próprio falante: {acertos}/{n} ({acertos/n:.0%})", flush=True)
