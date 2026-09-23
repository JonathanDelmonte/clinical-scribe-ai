"""
Compara as três rodadas: o que o vocabulário mudou, e se ele fabricou algo.
"""

import difflib
import json
import re
import unicodedata
from pathlib import Path

SC = Path(__file__).parent
VOCAB = json.loads((SC / "vocab.json").read_text(encoding="utf-8"))
R = {k: json.loads((SC / f"rodada_{k}.json").read_text(encoding="utf-8")) for k in "ABC"}


def texto(rodada: dict) -> str:
    return " ".join(s["text"].strip() for s in rodada["segments"])


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


T = {k: texto(v) for k, v in R.items()}

print("=" * 72)
print("TAMANHO E TEMPO")
for k in "ABC":
    print(
        f"  {k}: {len(R[k]['segments']):3d} trechos · {len(T[k].split()):5d} palavras · "
        f"{R[k]['_segundos']:6.1f}s · vocab {R[k].get('vocabulary_tokens')} tokens"
        f"{' CORTADO' if R[k].get('vocabulary_truncated') else ''}"
    )

# ---------------------------------------------------------------- dano
print()
print("=" * 72)
print("ALUCINAÇÃO INDUZIDA — termos do vocabulário que aparecem MAIS que na base")
for rodada, chave in (("B", "clinica"), ("C", "nutricao")):
    termos = [t.strip() for t in VOCAB[chave].split(",")]
    base, com = norm(T["A"]), norm(T[rodada])
    novos = []
    for termo in termos:
        padrao = r"\b" + re.escape(norm(termo)) + r"\b"
        a, b = len(re.findall(padrao, base)), len(re.findall(padrao, com))
        if b > a:
            novos.append((termo, a, b))
    print(f"  rodada {rodada} ({chave}): {len(novos)} termo(s) a mais")
    for termo, a, b in novos:
        print(f"      '{termo}': base {a} -> {b}")

# ---------------------------------------------------------------- o que mudou
for rodada in "BC":
    print()
    print("=" * 72)
    print(f"PALAVRAS QUE MUDARAM: A -> {rodada}")
    pa, pb = T["A"].split(), T[rodada].split()
    mudancas = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, pa, pb, autojunk=False).get_opcodes():
        if op != "equal":
            mudancas.append((" ".join(pa[i1:i2]), " ".join(pb[j1:j2])))
    print(f"  {len(mudancas)} trechos diferentes; semelhança total "
          f"{difflib.SequenceMatcher(None, pa, pb, autojunk=False).ratio():.3f}")
    for de, para in mudancas[:40]:
        print(f"    {de[:48]!r:52} -> {para[:48]!r}")
