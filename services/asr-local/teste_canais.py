"""
Teste da diarização por canal, com uma resposta CONHECIDA.

Não há gravação de consulta com dois microfones e gabarito de quem falou
quando. Então este teste FABRICA uma, com fala de verdade: pedaços de duas
gravações de um falante só, intercalados numa conversa cujo roteiro — quem
falou em cada instante — é sabido por construção.

Os dois "aparelhos" recebem todos os defeitos de um consultório de verdade, de
propósito e em valores conhecidos:

  - vazamento: cada microfone ouve também a outra pessoa, 12 dB mais baixo
  - ganho: o segundo aparelho grava 6 dB mais baixo que o primeiro
  - deslocamento: o segundo aparelho começou a gravar 3,7 s depois
  - deriva: o relógio do segundo aparelho anda 120 partes por milhão mais rápido
  - ruído de fundo, diferente em cada canal
  - o navegador cortou o silêncio do primeiro canal (tempo enxuto)

E o segundo canal passa pelo caminho de produção inteiro: vira envelope,
é codificado como o navegador codifica, decodificado como o motor decodifica,
e só então entra em `diarizar_sessao` — a mesma função que o endpoint chama.

O algoritmo precisa devolver o deslocamento, a deriva, e quem falou quando.

    docker exec scribe-asr-local python3 /app/teste_canais.py <voz_x> <voz_y> [<voz_y2>]
"""

from __future__ import annotations

import sys

import numpy as np

sys.path.insert(0, "/app")
import canais  # noqa: E402
from faster_whisper.audio import decode_audio  # noqa: E402

SR = canais.SR
rng = np.random.default_rng(7)

VAZAMENTO = 10 ** (-12 / 20)
GANHO_B = 10 ** (-6 / 20)
DESLOCAMENTO_S = 3.7
DERIVA = 120e-6


def carregar(caminhos: list[str]) -> np.ndarray:
    return np.concatenate([decode_audio(c, sampling_rate=SR).astype(np.float32) for c in caminhos])


def db_por_quadro(sinal: np.ndarray) -> np.ndarray:
    return canais.para_db(canais.energia_por_passo(sinal, canais.QUADRO))


def pedacos_com_fala(voz: np.ndarray, quantos: int) -> list[np.ndarray]:
    """Pedaços de 1,5 a 5 s tirados de onde há fala — silêncio não serve de turno."""
    env = db_por_quadro(voz)
    limiar = np.percentile(env, 40)
    saida: list[np.ndarray] = []
    tentativas = 0
    while len(saida) < quantos and tentativas < quantos * 50:
        tentativas += 1
        dur = int(rng.uniform(1.5, 5.0) * SR)
        ini = int(rng.integers(0, max(1, len(voz) - dur)))
        q0, q1 = ini // canais.QUADRO, (ini + dur) // canais.QUADRO
        if q1 > len(env) or (env[q0:q1] > limiar).mean() < 0.6:
            continue
        saida.append(voz[ini : ini + dur])
    return saida


def montar_conversa(x: np.ndarray, y: np.ndarray):
    """Intercala X e Y. Devolve as duas fontes separadas e o roteiro."""
    px, py = pedacos_com_fala(x, 28), pedacos_com_fala(y, 28)
    fonte_x, fonte_y, roteiro = [], [], []
    t = 0
    for i in range(min(len(px), len(py)) * 2):
        quem = "X" if i % 2 == 0 else "Y"
        pedaco = (px if quem == "X" else py)[i // 2]
        # Pausa entre falas; às vezes longa, para o navegador ter o que cortar.
        pausa = int(rng.uniform(2.0, 4.0) * SR) if rng.random() < 0.25 else int(rng.uniform(0.2, 0.8) * SR)
        for f in (fonte_x, fonte_y):
            f.append(np.zeros(pausa, dtype=np.float32))
        t += pausa
        silencio = np.zeros(len(pedaco), dtype=np.float32)
        fonte_x.append(pedaco if quem == "X" else silencio)
        fonte_y.append(pedaco if quem == "Y" else silencio)
        roteiro.append((t / SR, (t + len(pedaco)) / SR, quem))
        t += len(pedaco)
    return np.concatenate(fonte_x), np.concatenate(fonte_y), roteiro


def ruido(n: int, nivel: float) -> np.ndarray:
    return (rng.standard_normal(n) * nivel).astype(np.float32)


def cortar_com_regioes(original: np.ndarray, regioes: list[dict]) -> np.ndarray:
    """O corte que o NAVEGADOR faz no áudio da sessão (`concatenar`, prepare.ts)."""
    partes = [
        original[int(round(r["startMs"] / 1000 * SR)) : int(round(r["endMs"] / 1000 * SR))]
        for r in regioes
    ]
    return np.concatenate(partes) if partes else np.zeros(0, dtype=np.float32)


def envelope_do_navegador(canal: np.ndarray) -> np.ndarray:
    """Ida e volta pelo formato: o que o navegador manda, como o motor lê."""
    return canais.decodificar_envelope(canais.codificar_envelope(canais.energia_por_passo(canal)))


def acerto(turnos, roteiro, fonte_x, fonte_y) -> tuple[float, float, str]:
    """Precisão e alcance da atribuição, contra o roteiro.

    Duas perguntas separadas, porque o algoritmo pode, de propósito, NÃO
    atribuir: onde o segundo microfone não gravou, ele não decide nada.
    Misturar as duas numa taxa só puniria essa recusa como se fosse erro — e
    premiaria o palpite, que acertava por sorte quando quem falava ali era do
    lado do principal.

      precisão: da fala que ele atribuiu, quanto está certo
      alcance:  da fala que existe, quanto ele atribuiu

    Só conta quadro em que a fonte de quem está falando tem energia: a pausa
    dentro de uma frase não é de ninguém.

    Devolve também QUAL rótulo ficou com X. Não basta acertar o agrupamento: o
    rótulo tem significado físico — o 00 é o lado do aparelho principal, e é
    por ele que o papel é decidido.
    """
    n = min(len(fonte_x), len(fonte_y)) // canais.QUADRO
    ex, ey = db_por_quadro(fonte_x)[:n], db_por_quadro(fonte_y)[:n]
    limiar = np.percentile(np.maximum(ex, ey), 60)
    verdade = np.full(n, "", dtype=object)
    for ini, fim, quem in roteiro:
        a, b = int(ini * SR) // canais.QUADRO, int(fim * SR) // canais.QUADRO
        for q in range(a, min(b, n)):
            if (ex[q] if quem == "X" else ey[q]) > limiar:
                verdade[q] = quem
    previsto = np.full(n, "", dtype=object)
    for ini, fim, falante in turnos:
        a, b = int(ini * SR) // canais.QUADRO, int(fim * SR) // canais.QUADRO
        previsto[a : min(b, n)] = falante
    falada = verdade != ""
    avaliados = falada & (previsto != "")
    alcance = float(avaliados.sum() / max(1, falada.sum()))
    melhor, mapa = 0.0, ""
    p, s = canais.ROTULO_PRINCIPAL, canais.ROTULO_SEGUNDO
    for m in ({p: "X", s: "Y"}, {p: "Y", s: "X"}):
        traduzido = np.array([m.get(r, "") for r in previsto], dtype=object)
        taxa = float((traduzido[avaliados] == verdade[avaliados]).mean()) if avaliados.any() else 0.0
        if taxa > melhor:
            melhor, mapa = taxa, f"principal={m[p]}"
    return melhor, alcance, mapa


def principal() -> None:
    x = carregar([sys.argv[1]])
    y = carregar(sys.argv[2:])
    fx, fy, roteiro = montar_conversa(x, y)
    n = len(fx)
    print(f"conversa sintética: {n / SR:.1f}s, {len(roteiro)} turnos, fala real das duas gravações")

    # ---------------------------------------------------------- os aparelhos
    # X fala perto do aparelho principal (canal A); Y, perto do segundo (B).
    canal_a = fx + VAZAMENTO * fy + ruido(n, 0.003)
    b_verdadeiro = GANHO_B * (VAZAMENTO * fx + fy) + ruido(n, 0.002)
    # Deriva: o relógio rápido gera mais amostras para o mesmo tempo real.
    esticado = np.interp(
        np.arange(int(n * (1 + DERIVA))) / (1 + DERIVA), np.arange(n), b_verdadeiro
    ).astype(np.float32)
    # Deslocamento: começou depois. Termina 2 s depois do primeiro.
    corte = int(DESLOCAMENTO_S * SR * (1 + DERIVA))
    canal_b = np.concatenate([esticado[corte:], ruido(2 * SR, 0.002)])
    env_b = envelope_do_navegador(canal_b)

    falhas: list[str] = []

    # ---------------------------------------------------------- sessão sem corte
    r = canais.diarizar_sessao(canal_a, env_b, [], n / SR)
    al = r["alinhamento"]
    print(
        f"alinhamento: deslocamento {al['deslocamento_s']:.3f}s (real {DESLOCAMENTO_S})  ·  "
        f"deriva {al['deriva_ppm']:+.0f} ppm (real {-DERIVA * 1e6:+.0f})  ·  "
        f"qualidade {al['qualidade']:.2f}  ·  {al['janelas']} janelas"
    )
    if abs(al["deslocamento_s"] - DESLOCAMENTO_S) > 0.02:
        falhas.append("deslocamento errado em mais de 20 ms")
    if abs(al["deriva_ppm"] - (-DERIVA * 1e6)) > 40:
        falhas.append("deriva errada em mais de 40 ppm")

    taxa, alcance, mapa = acerto(r["turnos"], roteiro, fx, fy)
    print(
        f"por canal:   precisão {taxa:.1%}  ·  alcance {alcance:.1%}  ·  separação {r['separacao_db']:.1f} dB  ·  "
        f"cobertura {r['cobertura']:.1%}  ·  {len(r['turnos'])} turnos  ·  "
        f"confiável: {r['confiavel']}  ({mapa})"
    )
    if taxa < 0.97:
        falhas.append(f"precisão {taxa:.1%} abaixo de 97%")
    if alcance < 0.9:
        falhas.append(f"alcance {alcance:.1%} abaixo de 90%")
    if mapa != "principal=X":
        falhas.append("o rótulo do aparelho principal ficou com quem falava longe dele")
    if not r["confiavel"]:
        falhas.append(f"marcou como não confiável: {r['motivo']}")
    # O segundo aparelho começou 3,7 s depois: o começo NÃO pode ter turno.
    if r["turnos"] and r["turnos"][0][0] < DESLOCAMENTO_S:
        falhas.append("inventou turno antes de o segundo microfone começar a gravar")

    # Sem corrigir a deriva: quanto ela custaria?
    ea = canais.energia_por_passo(canal_a)
    completo = canais.alinhar_envelopes(canais.para_db(ea), canais.para_db(env_b))
    sem_deriva = canais.Alinhamento(completo.deslocamento_s, 0.0, completo.qualidade)
    d0 = canais.diarizar_por_envelopes(ea, canais.envelope_para_referencia(env_b, sem_deriva, len(ea)))
    taxa0, _, _ = acerto(d0.turnos, roteiro, fx, fy)
    print(f"sem corrigir a deriva: precisão {taxa0:.1%}")

    # ---------------------------------------------------------- tempo enxuto
    # O caminho de produção de verdade: o navegador cortou o silêncio do canal
    # A. Regiões = o roteiro com folga, em milissegundos inteiros como o
    # detector de fala entrega.
    regioes: list[dict] = []
    for ini, fim, _ in roteiro:
        r0 = round(max(0.0, ini - 0.2) * 1000)
        r1 = round(min(n / SR, fim + 0.2) * 1000)
        if regioes and r0 <= regioes[-1]["endMs"]:
            regioes[-1]["endMs"] = r1
        else:
            regioes.append({"startMs": r0, "endMs": r1})
    a_enxuto = cortar_com_regioes(canal_a, regioes)
    r_e = canais.diarizar_sessao(a_enxuto, env_b, regioes, n / SR)
    # O roteiro também precisa ir para o tempo enxuto, para comparar.
    fx_e, fy_e = cortar_com_regioes(fx, regioes), cortar_com_regioes(fy, regioes)
    roteiro_e = []
    for ini, fim, quem in roteiro:
        antes = 0.0
        for reg in regioes:
            if reg["endMs"] / 1000 <= ini:
                antes += (reg["endMs"] - reg["startMs"]) / 1000
            elif reg["startMs"] / 1000 <= ini:
                deslocado = antes + ini - reg["startMs"] / 1000
                roteiro_e.append((deslocado, deslocado + (fim - ini), quem))
                break
    taxa_e, alcance_e, mapa_e = acerto(r_e["turnos"], roteiro_e, fx_e, fy_e)
    print(
        f"tempo enxuto: {len(a_enxuto) / SR:.1f}s de {n / SR:.1f}s  ·  "
        f"deslocamento {r_e['alinhamento']['deslocamento_s']:.3f}s  ·  "
        f"precisão {taxa_e:.1%}  ·  alcance {alcance_e:.1%}  ({mapa_e})"
    )
    if taxa_e < 0.97:
        falhas.append(f"no tempo enxuto, precisão {taxa_e:.1%} abaixo de 97%")
    if alcance_e < 0.9:
        falhas.append(f"no tempo enxuto, alcance {alcance_e:.1%} abaixo de 90%")
    if not r_e["confiavel"]:
        falhas.append(f"no tempo enxuto, marcou como não confiável: {r_e['motivo']}")

    # ---------------------------------------------------------- cobertura parcial
    # O segundo aparelho parou no meio da consulta.
    metade = canais.decodificar_envelope(
        canais.codificar_envelope(canais.energia_por_passo(canal_b[: len(canal_b) // 3]))
    )
    r_p = canais.diarizar_sessao(canal_a, metade, [], n / SR)
    print(f"segundo microfone parou a 1/3 → confiável: {r_p['confiavel']}  ({r_p['motivo']})")
    if r_p["confiavel"]:
        falhas.append("aceitou um segundo microfone que gravou só um terço da consulta")

    # ---------------------------------------------------------- casos que devem ser RECUSADOS
    mudo = canais.diarizar_por_envelopes(ea, canais.energia_por_passo(ruido(n, 0.002)))
    print(f"segundo microfone mudo → confiável: {mudo.confiavel}  ({mudo.motivo})")
    if mudo.confiavel:
        falhas.append("aceitou um segundo microfone mudo")

    mesmo_lugar = canais.diarizar_sessao(
        canal_a, envelope_do_navegador(canal_a * 0.8 + ruido(n, 0.002)), [], n / SR
    )
    print(f"os dois microfones no mesmo lugar → confiável: {mesmo_lugar['confiavel']}")
    if mesmo_lugar["confiavel"]:
        falhas.append("aceitou dois microfones no mesmo lugar")

    outra = canais.diarizar_sessao(canal_a, envelope_do_navegador(ruido(n, 0.01)), [], n / SR)
    print(
        f"arquivo sem relação com a consulta → qualidade {outra['alinhamento']['qualidade']:.2f}, "
        f"confiável: {outra['confiavel']}"
    )
    if outra["confiavel"] or outra["alinhamento"]["qualidade"] > 0.2:
        falhas.append("alinhamento achou relação onde não havia")

    # ---------------------------------------------------------- o formato
    bom = canais.codificar_envelope(canais.energia_por_passo(canal_b[: SR * 10]))
    ruins = {
        "cortado no meio": bom[:-7],
        "outra mágica": b"XXXX" + bom[4:],
        "outro passo": bom[:8] + (160).to_bytes(2, "little") + bom[10:],
        "vazio": b"",
    }
    for nome, dados in ruins.items():
        try:
            canais.decodificar_envelope(dados)
            falhas.append(f"aceitou um envelope {nome}")
        except canais.EnvelopeInvalido:
            pass
    volta = canais.decodificar_envelope(bom)
    esperado = canais.energia_por_passo(canal_b[: SR * 10])
    erro_db = float(np.max(np.abs(canais.para_db(volta) - canais.para_db(esperado))))
    print(f"formato: 4 envelopes defeituosos recusados · ida e volta erra no máximo {erro_db:.3f} dB")
    if erro_db > 0.01:
        falhas.append(f"a codificação perde {erro_db:.3f} dB")

    print()
    print("FALHAS:" if falhas else "TUDO CERTO", *falhas, sep="\n  ")
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    principal()
