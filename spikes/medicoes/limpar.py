"""Limpa o áudio com DeepFilterNet e salva. Roda com CUDA_VISIBLE_DEVICES vazio."""
import sys, time
import numpy as np
import torch, torchaudio
sys.path.insert(0, "/app")
import app as svc
import df.utils
df.utils.get_git_root = lambda: None   # a biblioteca quebra sem git, só para o log
from df.enhance import enhance, init_df

audio = svc.decode_audio(sys.argv[1], sampling_rate=svc.SAMPLE_RATE).astype(np.float32)
t = time.time()
modelo, estado, _ = init_df(log_file=None)
print("dispositivo:", next(modelo.parameters()).device, flush=True)
x48 = torchaudio.functional.resample(torch.from_numpy(audio).unsqueeze(0), svc.SAMPLE_RATE, estado.sr())
limpo48 = enhance(modelo, estado, x48, pad=True)
limpo = torchaudio.functional.resample(limpo48, estado.sr(), svc.SAMPLE_RATE).squeeze(0).numpy()
limpo = np.pad(limpo, (0, max(0, len(audio) - len(limpo))))[: len(audio)].astype(np.float32)
np.save(sys.argv[2], limpo)
print(f"limpo: {len(limpo)/svc.SAMPLE_RATE:.1f}s em {time.time()-t:.1f}s", flush=True)
