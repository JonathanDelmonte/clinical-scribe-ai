"""
Mede o efeito do vocabulário do domínio sobre a transcrição da consulta real.

Três rodadas sobre o MESMO áudio, com o MESMO serviço, mudando só o vocabulário:
  A  nenhum           — linha de base
  B  clínica médica   — bate com a consulta (dor torácica): mede BENEFÍCIO
  C  nutrição         — não bate com a consulta: mede ALUCINAÇÃO INDUZIDA

Diarização desligada: ela não mexe no texto, só no falante, e custa tempo.
"""

import json
import sys
import time
import urllib.request
import uuid
from pathlib import Path

SC = Path(__file__).parent
AUDIO = Path(sys.argv[1])
URL = "http://localhost:8001/transcribe?diarize=false"
VOCAB = json.loads((SC / "vocab.json").read_text(encoding="utf-8"))

RODADAS = [
    ("A", None),
    ("B", VOCAB["clinica"]),
    ("C", VOCAB["nutricao"]),
]


def multipart(campos: dict, arquivo: Path) -> tuple[bytes, str]:
    fronteira = uuid.uuid4().hex
    partes = []
    for nome, valor in campos.items():
        partes.append(
            f'--{fronteira}\r\nContent-Disposition: form-data; name="{nome}"\r\n\r\n{valor}\r\n'.encode()
        )
    partes.append(
        (
            f'--{fronteira}\r\nContent-Disposition: form-data; name="file"; '
            f'filename="{arquivo.name}"\r\nContent-Type: application/octet-stream\r\n\r\n'
        ).encode()
        + arquivo.read_bytes()
        + b"\r\n"
    )
    partes.append(f"--{fronteira}--\r\n".encode())
    return b"".join(partes), f"multipart/form-data; boundary={fronteira}"


for rotulo, vocab in RODADAS:
    campos = {} if vocab is None else {"vocabulary": vocab}
    corpo, tipo = multipart(campos, AUDIO)
    req = urllib.request.Request(URL, data=corpo, headers={"Content-Type": tipo})
    inicio = time.time()
    with urllib.request.urlopen(req, timeout=1800) as r:
        dados = json.loads(r.read())
    dados["_segundos"] = round(time.time() - inicio, 1)
    (SC / f"rodada_{rotulo}.json").write_text(
        json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(
        f"{rotulo}: {len(dados['segments'])} trechos em {dados['_segundos']}s"
        f" | tokens do vocabulário: {dados.get('vocabulary_tokens')}"
        f" | cortado: {dados.get('vocabulary_truncated')}",
        flush=True,
    )

print("FIM", flush=True)
