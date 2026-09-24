"""
Diarização por canal — dois microfones, um perto de cada pessoa.

A diarização por voz (pyannote) tenta descobrir QUEM falou pelo timbre. Com
máscara e microfone de celular, as duas vozes ficam parecidas demais: a
separação medida caiu para 0,17, e nem limpeza de áudio nem vocabulário
ajudaram (ver ADR-0002).

Dois microfones trocam a pergunta. Em vez de "que voz é esta?", perguntam "qual
microfone ouviu mais alto?". Cada pessoa fala perto do seu, e o canal mais alto
naquele instante é de quem está falando. Isso não usa o timbre de ninguém — e
por isso funciona exatamente onde o timbre falhou.

## Os dois aparelhos não concordam sobre o tempo

O caso que isto atende é o mais barato: o app gravando num aparelho e o
gravador nativo de um celular perto do paciente. Os dois começam em instantes
diferentes (deslocamento) e os relógios de áudio andam em velocidades um pouco
diferentes (deriva — dezenas de partes por milhão, o que dá dezenas de
milissegundos numa consulta). Alinhar é a primeira coisa, e a mais delicada:
um canal fora do tempo atribui cada fala a quem falou um instante antes.

Mesmo sem timbre em comum, os dois microfones ouvem as MESMAS falas, só que em
volumes diferentes. O padrão de "tem alguém falando agora" é o mesmo nos dois.
É ele que se alinha: correlação dos envelopes de energia, não das ondas — a
onda muda com a posição do microfone e o eco da sala; o envelope não.

## O segundo canal chega como envelope, não como áudio

Nada aqui usa a ONDA do segundo microfone — só a energia dele a cada 5 ms.
Por isso quem mede o segundo canal é o navegador, e ele manda só essa medida:
a gravação do lado do paciente nunca chega ao servidor. Uma energia a cada
5 ms não contém palavras. O formato é o contrato entre os dois lados:
`codificarEnvelope`, em @scribe/audio-browser, escreve o que
`decodificar_envelope` lê.

## Tempo enxuto

O navegador corta o silêncio do áudio da sessão antes de enviar (ver
`prepare.ts`), então ele está comprimido no tempo e a gravação do celular não.
As regiões de fala guardadas na sessão permitem pôr o silêncio de volta,
alinhar no relógio real, e depois levar o segundo canal ao tempo enxuto pelo
mesmo mapa.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Any, Sequence

import numpy as np
from scipy.signal import fftconvolve

SR = 16_000

# O passo do envelope: 5 ms. É a unidade de tudo aqui — o navegador mede o
# segundo microfone nele, o alinhamento correlaciona nele, e a diarização junta
# seis dele num quadro.
PASSO = 80

# Quadro da diarização: 30 ms, o mesmo do detector de fala do navegador.
QUADRO = 480
PASSOS_POR_QUADRO = QUADRO // PASSO

# Os rótulos dos turnos. NÃO são os do pyannote (SPEAKER_00, SPEAKER_01): um
# trecho que o segundo microfone não cobriu pode continuar com o rótulo antigo,
# e o mesmo nome em dois grupos diferentes misturaria as pessoas.
#
# O significado é físico e é o que permite decidir o papel sem adivinhar: o 00
# é quem fala perto do aparelho que gravou a sessão; o 01, quem fala perto do
# segundo microfone. O profissional diz onde deixou o segundo aparelho.
ROTULO_PRINCIPAL = "CANAL_00"
ROTULO_SEGUNDO = "CANAL_01"

# Abaixo disto os dois microfones não estão separando as pessoas — os dois
# ouvem todo mundo igual. Calibrado pela física: celulares a ~50 cm de cada
# pessoa, pessoas a ~1 m uma da outra, dão ~7 dB de diferença.
SEPARACAO_MINIMA_DB = 5.0

# Nenhum dos dois grupos pode ser quase vazio. Um grupo com 3% das falas é o
# sinal de que só uma pessoa falou, ou de que um microfone estava mudo — e aí o
# agrupamento em dois inventa uma segunda pessoa a partir de flutuação.
FRACAO_MINIMA_POR_CANAL = 0.05

# Os dois microfones precisam ter ouvido a MESMA conversa: os envelopes de
# energia sobem e descem juntos, porque as mesmas falas chegam aos dois. Abaixo
# disto, um deles não gravou nada útil — mudo, desligado, ou outro arquivo.
CORRELACAO_MINIMA = 0.25

# Faixa entre o silêncio e a fala no segundo canal. Um microfone vivo numa
# conversa passa facilmente de 15 dB; um mudo só mostra a variação do ruído.
FAIXA_MINIMA_DB = 10.0

# O segundo aparelho precisa ter gravado a maior parte da consulta. Menos que
# isto e a correção vale para um pedaço só — o resto fica como estava, e o
# resultado passa a ser uma colcha que ninguém consegue avaliar.
COBERTURA_MINIMA = 0.5

MAX_DESLOCAMENTO_S = 120.0
TURNO_MINIMO_S = 0.5


@dataclass
class Alinhamento:
    deslocamento_s: float
    deriva_ppm: float
    # Correlação no pico, normalizada. Perto de zero: os canais não têm nada a
    # ver um com o outro — arquivo errado, ou outra consulta.
    qualidade: float
    medicoes: list[tuple[float, float]] = field(default_factory=list)


@dataclass
class DiarizacaoPorCanal:
    turnos: list[tuple[float, float, str]]
    separacao_db: float
    fracao_canal_a: float
    # Fração do áudio da sessão que o segundo microfone também gravou.
    cobertura: float
    confiavel: bool
    motivo: str | None


# ---------------------------------------------------------------------------
# o envelope que o navegador manda

# "Consulta Viva Envelope", versão 1. O arquivo se descreve sozinho: o que fica
# guardado continua legível mesmo que o passo mude numa versão futura, e um
# arquivo de outra coisa é recusado na porta em vez de virar números.
MAGICA = b"CVE1"
_CABECALHO = struct.Struct("<4sIHHI")  # mágica, taxa, passo, reservado, passos

# Quatro horas de segundo microfone. Nenhuma consulta chega perto, e o envelope
# de quatro horas (5,8 MB) ainda cabe abaixo do limite de corpo de requisição
# da web, que é de 10 MB — acima dele o corpo é CORTADO, sem erro.
MAX_PASSOS = 4 * 3600 * SR // PASSO


class EnvelopeInvalido(ValueError):
    """O arquivo não é um envelope que este motor sabe ler."""


def codificar_envelope(energia: np.ndarray) -> bytes:
    """Energia linear → o formato do navegador. Espelho de `codificarEnvelope`.

    Centésimos de dB em 16 bits: resolução de 0,01 dB, de -327 a +327 dB. O
    piso (-100 dB, energia 1e-10) e o teto de uma onda cheia (0 dB) cabem com
    folga, na metade dos bytes de um float. Existe aqui para o teste.
    """
    centesimos = np.clip(np.round(para_db(energia) * 100), -32768, 32767).astype("<i2")
    return _CABECALHO.pack(MAGICA, SR, PASSO, 0, len(centesimos)) + centesimos.tobytes()


def decodificar_envelope(dados: bytes) -> np.ndarray:
    """O formato do navegador → energia linear por passo. Recusa o que não entende.

    Cada recusa evita o mesmo desastre silencioso: um envelope lido com o passo
    errado, ou pela metade, não dá erro na correlação — dá um alinhamento
    plausível e errado, e cada fala atribuída a quem falou um instante antes.
    """
    if len(dados) < _CABECALHO.size:
        raise EnvelopeInvalido("envelope vazio, ou cortado antes do cabeçalho")
    magica, taxa, passo, _reservado, passos = _CABECALHO.unpack_from(dados)
    if magica != MAGICA:
        raise EnvelopeInvalido("o arquivo não é um envelope de segundo microfone")
    if taxa != SR or passo != PASSO:
        raise EnvelopeInvalido(
            f"envelope medido a {taxa} Hz em passos de {passo} amostras; "
            f"o motor espera {SR} Hz e {PASSO}"
        )
    if passos > MAX_PASSOS:
        raise EnvelopeInvalido("gravação do segundo microfone longa demais")
    esperado = _CABECALHO.size + 2 * passos
    if len(dados) != esperado:
        raise EnvelopeInvalido(
            f"envelope com {len(dados)} bytes, e o cabeçalho anuncia {esperado} — chegou cortado"
        )
    centesimos = np.frombuffer(dados, dtype="<i2", count=passos, offset=_CABECALHO.size)
    # dB = centésimos / 100; energia = 10^(dB / 10).
    return np.power(10.0, centesimos.astype(np.float64) / 1000.0)


# ---------------------------------------------------------------------------
# energia


def energia_por_passo(sinal: np.ndarray, passo: int = PASSO) -> np.ndarray:
    """Energia média (quadrática, linear) a cada `passo` amostras.

    É a mesma definição de `energiaPorPasso` no navegador. Os dois lados
    precisam concordar nela, ou o canal B chegaria numa escala diferente da do
    A.
    """
    n = len(sinal) // passo
    if n == 0:
        return np.zeros(0)
    return (sinal[: n * passo].astype(np.float64).reshape(n, passo) ** 2).mean(axis=1)


def para_db(energia: np.ndarray) -> np.ndarray:
    return 10.0 * np.log10(np.asarray(energia, dtype=np.float64) + 1e-10)


def agregar(energia: np.ndarray, fator: int) -> np.ndarray:
    """Junta `fator` passos em um, pela média — 5 ms para 30 ms.

    Média de energia LINEAR, e não de dB: é a energia do quadro inteiro, a
    mesma que se mediria direto nos 30 ms. NaN num passo contamina o quadro, de
    propósito — um quadro meio medido não é medido.
    """
    n = len(energia) // fator
    return np.asarray(energia[: n * fator], dtype=np.float64).reshape(n, fator).mean(axis=1)


def _amostrar(energia: np.ndarray, posicao: np.ndarray) -> np.ndarray:
    """Energia em posições fracionárias, em passos. NaN onde não há medida.

    Interpolar a energia linear entre dois passos vizinhos é a média ponderada
    pela sobreposição — exatamente o que um passo deslocado conteria.
    """
    if len(energia) == 0:
        return np.full(len(posicao), np.nan)
    saida = np.interp(posicao, np.arange(len(energia)), energia)
    saida[(posicao < 0) | (posicao > len(energia) - 1)] = np.nan
    return saida


# ---------------------------------------------------------------------------
# tempo enxuto <-> tempo original


def _regioes_em_amostras(
    regioes: Sequence[dict], total: int, tamanho_enxuto: int
) -> list[tuple[int, int, int]]:
    """(início no original, início no enxuto, amostras) de cada região de fala.

    As mesmas contas que o navegador fez para cortar (`concatenar`, em
    prepare.ts): arredondar o milissegundo para a amostra, sem passar do fim.
    Uma conta diferente aqui deslocaria todo o resto da consulta.
    """
    saida: list[tuple[int, int, int]] = []
    lido = 0
    for r in regioes:
        i0 = int(round(r["startMs"] / 1000 * SR))
        i1 = min(total, int(round(r["endMs"] / 1000 * SR)))
        n = max(0, min(i1 - i0, tamanho_enxuto - lido))
        if n > 0:
            saida.append((i0, lido, n))
        lido += n
    return saida


def energia_no_tempo_original(
    enxuto: np.ndarray, regioes: Sequence[dict], duracao_original_s: float
) -> np.ndarray:
    """A energia por passo do áudio da sessão, com o silêncio de volta no lugar.

    O mesmo que reinserir o silêncio na onda e medir — sem montar na memória a
    onda de uma consulta inteira: cada região soma a sua energia direto nos
    passos do relógio real. Onde o navegador cortou, a energia é zero.
    """
    total = int(round(duracao_original_s * SR))
    passos = total // PASSO
    soma = np.zeros(passos)
    for inicio, lido, n in _regioes_em_amostras(regioes, total, len(enxuto)):
        quadrados = enxuto[lido : lido + n].astype(np.float64) ** 2
        passo_de_cada = (inicio + np.arange(n)) // PASSO
        primeiro = int(passo_de_cada[0])
        parcial = np.bincount(passo_de_cada - primeiro, weights=quadrados)
        fim = min(passos, primeiro + len(parcial))
        if fim > primeiro:
            soma[primeiro:fim] += parcial[: fim - primeiro]
    return soma / PASSO


def envelope_no_tempo_enxuto(
    energia_real: np.ndarray,
    regioes: Sequence[dict],
    duracao_original_s: float,
    tamanho_enxuto: int,
) -> np.ndarray:
    """Um envelope no relógio real, levado ao tempo enxuto do áudio da sessão.

    Não se corta região por região arredondando para o passo: cada
    arredondamento erraria até meio passo, e o erro ACUMULA — cinquenta regiões
    dariam 125 ms de desalinhamento no fim da consulta. Aqui cada passo do
    tempo enxuto é mapeado para a posição exata, em amostras, no tempo real.
    """
    total = int(round(duracao_original_s * SR))
    mapa = _regioes_em_amostras(regioes, total, tamanho_enxuto)
    passos = tamanho_enxuto // PASSO
    if not mapa:
        return np.full(passos, np.nan)
    inicio_real = np.array([m[0] for m in mapa], dtype=np.int64)
    inicio_enxuto = np.array([m[1] for m in mapa], dtype=np.int64)
    amostra = np.arange(passos, dtype=np.int64) * PASSO
    regiao = np.clip(np.searchsorted(inicio_enxuto, amostra, side="right") - 1, 0, len(mapa) - 1)
    posicao = (inicio_real[regiao] + (amostra - inicio_enxuto[regiao])) / PASSO
    return _amostrar(energia_real, posicao)


# ---------------------------------------------------------------------------
# alinhamento


def _correlacao(a: np.ndarray, b: np.ndarray, lag_min: int, lag_max: int) -> int:
    """Lag k, dentro de [lag_min, lag_max], que maximiza soma(a[t+k] * b[t]).

    k positivo: o que acontece em b[t] acontece em a[t+k] — b começou depois.

    O intervalo é explícito, e não simétrico em torno de zero, porque nem sempre
    o encaixe esperado está no zero. Um intervalo simétrico colocaria o valor
    esperado na borda da busca, e qualquer desvio para fora dela faria o
    algoritmo escolher, sem aviso, o melhor pico ERRADO de dentro.
    """
    a = a - a.mean()
    b = b - b.mean()
    corr = fftconvolve(a, b[::-1], mode="full")
    lags = np.arange(-(len(b) - 1), len(a))
    dentro = (lags >= lag_min) & (lags <= lag_max)
    if not dentro.any():
        return 0
    return int(lags[int(np.argmax(np.where(dentro, corr, -np.inf)))])


def _pearson_sobreposto(a: np.ndarray, b: np.ndarray, lag: int) -> float:
    """Correlação só no trecho em que os dois canais se sobrepõem.

    Normalizar pela energia inteira de cada canal subestimaria a qualidade
    sempre que um aparelho gravou mais tempo que o outro — que é o normal.
    """
    ini_a, ini_b = max(0, lag), max(0, -lag)
    n = min(len(a) - ini_a, len(b) - ini_b)
    if n < 100:
        return 0.0
    x, y = a[ini_a : ini_a + n], b[ini_b : ini_b + n]
    if x.std() == 0 or y.std() == 0:
        return 0.0
    return float(np.corrcoef(x, y)[0, 1])


def alinhar_envelopes(ea: np.ndarray, eb: np.ndarray, janelas: int = 6) -> Alinhamento:
    """Deslocamento e deriva do canal B em relação ao A, pelos envelopes em dB.

    Primeiro o deslocamento global, pelos envelopes inteiros. Depois o mesmo
    em várias janelas ao longo da gravação: se o deslocamento cresce com o
    tempo, os relógios andam em ritmos diferentes, e a inclinação da reta é a
    deriva.
    """
    max_lag = int(MAX_DESLOCAMENTO_S * SR / PASSO)
    lag = _correlacao(ea, eb, -max_lag, max_lag)
    qualidade = _pearson_sobreposto(ea, eb, lag)

    # Deriva: janelas de ~30 s no segundo canal, procuradas numa vizinhança de
    # ±1 s do deslocamento global na referência.
    tam = int(30 * SR / PASSO)
    folga = int(1.0 * SR / PASSO)
    medicoes: list[tuple[float, float]] = []
    if len(eb) > tam * 2:
        for inicio in np.linspace(0, len(eb) - tam, janelas).astype(int):
            trecho = eb[inicio : inicio + tam]
            ref_ini = inicio + lag - folga
            ref_fim = inicio + lag + tam + folga
            if ref_ini < 0 or ref_fim > len(ea):
                continue
            # O encaixe esperado é k = folga (a janela da referência começa uma
            # folga antes). A busca vai de 0 a 2*folga: o esperado no MEIO.
            k = _correlacao(ea[ref_ini:ref_fim], trecho, 0, 2 * folga)
            q = _pearson_sobreposto(ea[ref_ini:ref_fim], trecho, k)
            if q > 0.3:
                # posição do trecho no tempo do outro canal, e o deslocamento local
                medicoes.append(((inicio * PASSO) / SR, (lag + k - folga) * PASSO / SR))

    deriva = 0.0
    deslocamento = lag * PASSO / SR
    if len(medicoes) >= 3:
        t = np.array([m[0] for m in medicoes])
        d = np.array([m[1] for m in medicoes])
        inclinacao, intercepto = np.polyfit(t, d, 1)
        deriva = float(inclinacao)
        deslocamento = float(intercepto)

    return Alinhamento(
        deslocamento_s=deslocamento,
        deriva_ppm=deriva * 1e6,
        qualidade=qualidade,
        medicoes=medicoes,
    )


def envelope_para_referencia(
    energia_b: np.ndarray, alinhamento: Alinhamento, passos: int
) -> np.ndarray:
    """O envelope do canal B no relógio do A. NaN onde B não gravou.

    O passo i do A começa na amostra i·PASSO; no relógio do B, essa amostra é
    (i·PASSO − deslocamento) / (1 + deriva). Uma interpolação resolve
    deslocamento e deriva de uma vez.

    Fora do trecho que o segundo aparelho gravou — começou depois, parou antes
    — não há medida, e NaN diz isso. Zero diria "silêncio do lado do segundo
    microfone", e a diarização entregaria toda fala dali ao lado do principal.
    """
    r = alinhamento.deriva_ppm / 1e6
    i = np.arange(passos, dtype=np.float64)
    posicao = (i * PASSO - alinhamento.deslocamento_s * SR) / ((1.0 + r) * PASSO)
    return _amostrar(energia_b, posicao)


# ---------------------------------------------------------------------------
# diarização


def diarizar_por_envelopes(energia_a: np.ndarray, energia_b: np.ndarray) -> DiarizacaoPorCanal:
    """Turnos pela dominância de energia entre dois canais já alinhados.

    Recebe a energia linear a cada 5 ms dos dois canais, no mesmo tempo. NaN no
    canal B marca onde o segundo microfone não gravou: ali nada é decidido.

    Quem é o profissional NÃO é decidido aqui. Os rótulos dizem de que lado a
    fala veio — ver `ROTULO_PRINCIPAL` —, e quem sabe quem estava de cada lado
    é quem posicionou os aparelhos.
    """
    n = min(len(energia_a), len(energia_b))
    ea = para_db(agregar(energia_a[:n], PASSOS_POR_QUADRO))
    eb_linear = agregar(energia_b[:n], PASSOS_POR_QUADRO)
    coberto = np.isfinite(eb_linear)
    eb = para_db(np.where(coberto, eb_linear, 0.0))
    quadros = len(ea)
    cobertura = float(coberto.mean()) if quadros > 0 else 0.0

    def recusa(motivo: str) -> DiarizacaoPorCanal:
        return DiarizacaoPorCanal([], 0.0, 0.0, cobertura, False, motivo)

    if coberto.sum() < 50:
        return recusa("áudio curto demais")
    if cobertura < COBERTURA_MINIMA:
        return recusa(
            f"o segundo microfone gravou só {cobertura:.0%} desta consulta — começou "
            f"depois ou parou antes. Grave do começo ao fim."
        )

    ea_c, eb_c = ea[coberto], eb[coberto]

    # Os dois microfones ouviram a mesma conversa?
    #
    # Sem esta checagem, um segundo microfone MUDO passa: o primeiro canal
    # sozinho tem duas populações de fala — a pessoa perto dele, alta, e a
    # outra vazando de longe, mais baixa — e o agrupamento as separa com folga.
    # Seria diarização por volume num microfone só, fingindo ser por canal, e
    # volume engana: basta alguém falar mais alto do outro lado da sala. O
    # profissional acharia que os dois microfones funcionaram.
    faixa_b = float(np.percentile(eb_c, 95) - np.percentile(eb_c, 10))
    if faixa_b < FAIXA_MINIMA_DB:
        return recusa(
            f"o segundo microfone quase não captou som ({faixa_b:.0f} dB entre silêncio "
            f"e fala; o mínimo é {FAIXA_MINIMA_DB:.0f}). Pode ter ficado mudo ou longe demais."
        )
    if np.std(ea_c) > 0 and np.std(eb_c) > 0:
        juntos = float(np.corrcoef(ea_c, eb_c)[0, 1])
        if juntos < CORRELACAO_MINIMA:
            return recusa(
                "os dois microfones não parecem ter gravado a mesma conversa. Confira se o "
                "arquivo é desta consulta."
            )

    # Tem alguém falando? O canal mais alto acima do próprio piso de ruído.
    alto = np.maximum(ea, eb)
    piso, topo = np.percentile(alto[coberto], 10), np.percentile(alto[coberto], 95)
    fala = (alto > piso + 0.35 * (topo - piso)) & coberto
    if fala.sum() < 30:
        return recusa("quase nenhuma fala detectada")

    # Diferença entre os canais, em dB. Os aparelhos têm ganhos diferentes, então
    # zero NÃO é a fronteira: ela é achada pelos próprios dados, separando os
    # quadros em dois grupos (quando A fala; quando B fala) e tomando o meio.
    razao = ea - eb
    r = razao[fala]
    alto_c, baixo_c = float(np.percentile(r, 75)), float(np.percentile(r, 25))
    for _ in range(30):
        meio = (alto_c + baixo_c) / 2
        g_alto, g_baixo = r[r > meio], r[r <= meio]
        if len(g_alto) == 0 or len(g_baixo) == 0:
            break
        alto_c, baixo_c = float(g_alto.mean()), float(g_baixo.mean())
    meio = (alto_c + baixo_c) / 2
    separacao = alto_c - baixo_c
    fracao_a = float((r > meio).mean())

    motivo = None
    if separacao < SEPARACAO_MINIMA_DB:
        motivo = (
            f"os dois microfones ouvem todos quase igual ({separacao:.1f} dB de "
            f"diferença; o mínimo é {SEPARACAO_MINIMA_DB:.0f}). Ficaram longe das pessoas "
            f"ou perto demais um do outro."
        )
    elif min(fracao_a, 1 - fracao_a) < FRACAO_MINIMA_POR_CANAL:
        motivo = (
            "quase toda a fala saiu de um canal só — um microfone pode ter ficado "
            "mudo, ou só uma pessoa falou."
        )

    # 0 = o canal A domina = o lado do aparelho principal.
    rotulo = np.where(razao > meio, 0, 1)

    # Suavização: maioria numa janela de 210 ms, só entre quadros com fala. Tira
    # as trocas de um quadro só — um estalo, uma sílaba mais alta — que não são
    # troca de pessoa.
    meia = 3
    suave = rotulo.copy()
    idx = np.flatnonzero(fala)
    for j, i in enumerate(idx):
        viz = rotulo[idx[max(0, j - meia) : j + meia + 1]]
        suave[i] = 1 if viz.sum() * 2 > len(viz) else 0

    rotulos = (ROTULO_PRINCIPAL, ROTULO_SEGUNDO)

    # Turnos: sequências do mesmo rótulo; silêncio curto no meio não quebra.
    turnos: list[list] = []
    silencio_max = int(0.3 * SR / QUADRO)
    ultimo_fala = -10**9
    for i in range(quadros):
        if not fala[i]:
            continue
        ini, fim = i * QUADRO / SR, (i + 1) * QUADRO / SR
        falante = rotulos[suave[i]]
        if turnos and turnos[-1][2] == falante and i - ultimo_fala <= silencio_max + 1:
            turnos[-1][1] = fim
        else:
            turnos.append([ini, fim, falante])
        ultimo_fala = i

    # Turno curtíssimo entre dois do MESMO falante é quase sempre vazamento do
    # outro microfone, não uma interrupção real: incorpora ao redor.
    mesclados: list[list] = []
    for t in turnos:
        if (
            mesclados
            and t[1] - t[0] < TURNO_MINIMO_S
            and mesclados[-1][2] != t[2]
        ):
            continue
        if mesclados and mesclados[-1][2] == t[2]:
            mesclados[-1][1] = t[1]
        else:
            mesclados.append(t)

    return DiarizacaoPorCanal(
        turnos=[(float(s), float(e), str(f)) for s, e, f in mesclados],
        separacao_db=float(separacao),
        fracao_canal_a=fracao_a,
        cobertura=cobertura,
        confiavel=motivo is None,
        motivo=motivo,
    )


# ---------------------------------------------------------------------------
# a sessão inteira


def diarizar_sessao(
    principal: np.ndarray,
    energia_b: np.ndarray,
    regioes: Sequence[dict],
    duracao_original_s: float,
) -> dict[str, Any]:
    """Tudo o que o endpoint faz, numa função que o teste chama do mesmo jeito.

    `principal` é o áudio da sessão, enxuto se o navegador cortou o silêncio;
    `energia_b`, o envelope decodificado do segundo microfone, no relógio dele.
    Os turnos voltam no tempo do áudio PRINCIPAL — o mesmo dos trechos já
    transcritos. `confiavel: False` não é erro: é a resposta honesta de que os
    dois microfones não separaram as pessoas.
    """
    ea_enxuta = energia_por_passo(principal)
    if regioes:
        fim_mapa = max(r["endMs"] for r in regioes) / 1000
        duracao = max(duracao_original_s, fim_mapa)
        ea_real = energia_no_tempo_original(principal, regioes, duracao)
    else:
        duracao = len(principal) / SR
        ea_real = ea_enxuta

    al = alinhar_envelopes(para_db(ea_real), para_db(energia_b))
    medido = {
        "deslocamento_s": round(al.deslocamento_s, 4),
        "deriva_ppm": round(al.deriva_ppm, 1),
        "qualidade": round(al.qualidade, 3),
        "janelas": len(al.medicoes),
    }

    if al.qualidade < CORRELACAO_MINIMA:
        return {
            "confiavel": False,
            "motivo": (
                "os dois arquivos não parecem ser da mesma consulta — não foi possível "
                "alinhá-los. Confira se a gravação do segundo microfone é desta consulta."
            ),
            "turnos": [],
            "alinhamento": medido,
        }

    eb_real = envelope_para_referencia(energia_b, al, len(ea_real))
    eb = (
        envelope_no_tempo_enxuto(eb_real, regioes, duracao, len(principal))
        if regioes
        else eb_real
    )
    d = diarizar_por_envelopes(ea_enxuta, eb)
    return {
        "confiavel": d.confiavel,
        "motivo": d.motivo,
        "turnos": [[round(s, 3), round(e, 3), f] for s, e, f in d.turnos],
        "alinhamento": medido,
        "separacao_db": round(d.separacao_db, 1),
        "fracao_canal_a": round(d.fracao_canal_a, 3),
        "cobertura": round(d.cobertura, 3),
    }
