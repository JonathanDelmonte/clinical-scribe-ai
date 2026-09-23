"""Limpeza BRANDA: subtração espectral do ruído estacionário. Sem rede neural."""
import sys, time
import numpy as np
sys.path.insert(0, "/app")
import app as svc
import noisereduce as nr

audio = svc.decode_audio(sys.argv[1], sampling_rate=svc.SAMPLE_RATE).astype(np.float32)
t = time.time()
# `stationary=True`: estima o ruído de fundo constante (zumbido, chiado do
# celular) e o subtrai. `prop_decrease` < 1 deixa parte do ruído — a intenção é
# mexer o MÍNIMO possível na voz, ao contrário do limpador neural.
limpo = nr.reduce_noise(y=audio, sr=svc.SAMPLE_RATE, stationary=True, prop_decrease=0.8)
limpo = limpo[: len(audio)].astype(np.float32)
np.save(sys.argv[2], limpo)
print(f"limpo (brando): {len(limpo)/svc.SAMPLE_RATE:.1f}s em {time.time()-t:.1f}s", flush=True)
