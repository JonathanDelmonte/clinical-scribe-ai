"""
Suavização de falantes — casos com resposta CONHECIDA.

A suavização decide o falante de cada palavra depois do pyannote, e um erro
nela não aparece como erro: aparece como uma fala inteira atribuída à pessoa
errada. Já aconteceu — ver ADR-0002, "Suavização de falantes": uma regra de
"troca sem pausa não é troca" derrubava o acerto por palavra de 100% para 70%
com os turnos do próprio gabarito. Estes casos existem para ela não voltar.

    docker exec scribe-asr-local python3 /app/teste_suavizacao.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from types import SimpleNamespace

# Uma pasta só deste teste: importar o motor dentro do contêiner em uso não
# pode encostar nos temporários das consultas em andamento.
os.environ["PASTA_TEMPORARIA"] = tempfile.mkdtemp(prefix="teste-suavizacao-")
sys.path.insert(0, "/app")
import app  # noqa: E402


def palavras(*itens: tuple[float, float, str]) -> list[SimpleNamespace]:
    return [SimpleNamespace(start=a, end=b, word=w, probability=1.0) for a, b, w in itens]


def seguidas(n: int, passo: float = 0.3) -> list[SimpleNamespace]:
    """`n` palavras coladas, sem pausa entre elas — como o Whisper costuma marcar."""
    return palavras(*[(i * passo, (i + 1) * passo, f" p{i}") for i in range(n)])


def confere(nome: str, obtido: list[str], esperado: list[str]) -> None:
    assert obtido == esperado, f"{nome}: esperado {esperado}, veio {obtido}"
    print(f"ok  {nome}")


# A troca de verdade SEM pausa entre as palavras. O Whisper quase nunca marca
# pausa entre a última palavra de uma pessoa e a primeira da outra; a regra
# antiga via isso como "troca impossível" e levava a fala inteira da segunda
# pessoa para a primeira.
falantes = ["A"] * 4 + ["B"] * 6
confere(
    "troca sem pausa sobrevive — e não arrasta a fala seguinte",
    app.smooth_speakers(seguidas(10), falantes),
    falantes,
)

# Meia palavra do outro no meio de uma fala: ruído do pyannote, absorvido.
confere(
    "bloco curto entre falas da MESMA pessoa é absorvido",
    app.smooth_speakers(seguidas(9), ["A"] * 4 + ["B"] + ["A"] * 4),
    ["A"] * 9,
)

# A→B→C: o bloco do meio pode ser uma resposta curta de verdade.
falantes = ["A"] * 4 + ["B"] + ["C"] * 4
confere(
    "bloco curto entre pessoas DIFERENTES fica",
    app.smooth_speakers(seguidas(9), falantes),
    falantes,
)

# Curto em palavras, mas longo no tempo: não é meia palavra, é uma fala.
lento = palavras(
    (0.0, 0.3, " a"), (0.3, 0.6, " b"),
    (0.6, 1.1, " uma"), (1.1, 1.6, " pausa"),
    (1.6, 1.9, " c"), (1.9, 2.2, " d"),
)
falantes = ["A", "A", "B", "B", "A", "A"]
confere(
    "bloco com mais de MIN_TURN_S fica, mesmo curto em palavras",
    app.smooth_speakers(lento, falantes),
    falantes,
)

print("suavização: todos os casos ok")
