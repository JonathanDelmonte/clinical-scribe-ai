"""
Prepara os modelos do motor no computador da pessoa. O ajudante chama este
script na instalação, com o Python do motor.

- Whisper large-v3 (Systran/faster-whisper-large-v3, MIT) e impressão vocal
  (pyannote/wespeaker-voxceleb-resnet34-LM, CC-BY-4.0): abertos no Hugging
  Face, baixados daqui, sem token.
- Separação de vozes (pyannote/speaker-diarization-3.1 e segmentation-3.0,
  MIT): vêm DENTRO do ajudante. No Hugging Face eles são fechados por um
  formulário, e a licença MIT permite levá-los junto — ninguém precisa criar
  conta lá. Aqui eles só são copiados, e o config.yaml passa a apontar para
  os arquivos locais.

Cada modelo vai para uma pasta própria, como arquivos comuns. O cache do
Hugging Face, não: no Windows ele liga os arquivos por links simbólicos, que
sem o Modo de desenvolvedor falham ("o cliente não tem o privilégio
necessário"). O ajudante escolhe as pastas e as passa aqui e ao motor.

A impressão vocal fica DENTRO da pasta do pyannote de propósito: o pyannote
decide como carregar um modelo pelo nome, e um caminho sem "pyannote" mas
com "wespeaker" seria carregado como outro tipo de modelo (ONNX).

Escreve o progresso em linhas JSON — {"baixado": n, "total": m} — que o
ajudante lê para a barra. O resto da saída vai só para o registro.

    python preparar_modelos.py --levado <pyannote que veio no ajudante>
        --separacao <pasta> --whisper <pasta> --impressao <pasta>
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import threading
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download

WHISPER = "Systran/faster-whisper-large-v3"
IMPRESSAO = "pyannote/wespeaker-voxceleb-resnet34-LM"


def tamanho_da_pasta(pasta: Path) -> int:
    total = 0
    for raiz, _, arquivos in os.walk(pasta):
        for arquivo in arquivos:
            try:
                total += os.path.getsize(os.path.join(raiz, arquivo))
            except OSError:
                pass
    return total


def baixar(destinos: dict[str, Path]) -> None:
    api = HfApi()
    total = sum(
        sum((s.size or 0) for s in api.model_info(repo, files_metadata=True).siblings or [])
        for repo in destinos
    )
    terminou = threading.Event()

    def relatar() -> None:
        # O tamanho das pastas de destino — com os .incomplete do que está
        # chegando, que o Hugging Face guarda ali dentro. Funciona igual no
        # download e no reparo (que só confere o que já está lá).
        while not terminou.is_set():
            presente = sum(tamanho_da_pasta(pasta) for pasta in destinos.values())
            print(json.dumps({"baixado": min(total, presente), "total": total}), flush=True)
            terminou.wait(1.0)

    relator = threading.Thread(target=relatar, daemon=True)
    relator.start()
    try:
        for repo, pasta in destinos.items():
            print(f"baixando {repo}", flush=True)
            snapshot_download(repo, local_dir=str(pasta))
    finally:
        terminou.set()
        relator.join(timeout=2)
    print(json.dumps({"baixado": total, "total": total}), flush=True)


def preparar_separacao(levado: Path, separacao: Path, impressao: Path) -> None:
    """Copia o pyannote levado e aponta o config.yaml para os arquivos locais."""
    segmentacao = separacao / "segmentation-3.0" / "pytorch_model.bin"
    segmentacao.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(levado / "segmentation-3.0" / "pytorch_model.bin", segmentacao)
    if (levado / "LICENCA.txt").exists():
        shutil.copyfile(levado / "LICENCA.txt", separacao / "LICENCA.txt")

    # Entre aspas (uma string JSON é YAML válido): o caminho tem o nome do
    # usuário do Windows, que pode ter espaço, acento ou "#". Barras normais,
    # que o Windows aceita e o YAML não precisa escapar.
    trocas = {
        "segmentation: pyannote/segmentation-3.0": (
            f"segmentation: {json.dumps(segmentacao.as_posix(), ensure_ascii=False)}"
        ),
        "embedding: pyannote/wespeaker-voxceleb-resnet34-LM": (
            "embedding: "
            + json.dumps((impressao / "pytorch_model.bin").as_posix(), ensure_ascii=False)
        ),
    }
    config = (levado / "config.yaml").read_text(encoding="utf-8")
    for de, para in trocas.items():
        if de not in config:
            raise SystemExit(f"config.yaml do pyannote em formato inesperado (sem '{de}')")
        config = config.replace(de, para)
    (separacao / "config.yaml").write_text(config, encoding="utf-8")
    print("separação de vozes preparada", flush=True)


def main() -> None:
    argumentos = argparse.ArgumentParser()
    argumentos.add_argument("--levado", required=True, type=Path)
    argumentos.add_argument("--separacao", required=True, type=Path)
    argumentos.add_argument("--whisper", required=True, type=Path)
    argumentos.add_argument("--impressao", required=True, type=Path)
    a = argumentos.parse_args()

    preparar_separacao(a.levado, a.separacao, a.impressao)
    baixar({WHISPER: a.whisper, IMPRESSAO: a.impressao})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — o ajudante mostra a mensagem
        print(f"falhou: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
