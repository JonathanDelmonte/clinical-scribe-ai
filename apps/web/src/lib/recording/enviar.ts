import {
  esperaDeTentativa,
  partesFaltando,
  planejarPartes,
  TAMANHO_DA_PARTE,
  type Parte,
} from "./partes";

/**
 * Envio do áudio em pedaços, com retomada.
 *
 * O que ele resolve é uma falha só, e é a mais comum do consultório real: a
 * rede cai no meio do envio. Sem isto, uma consulta de 30 minutos que falha
 * aos 90% recomeça do zero — e falha de novo, porque a rede que derrubou os
 * primeiros 4 MB derruba os próximos 4 MB.
 *
 * As dependências de rede e de tempo entram por parâmetro para que o laço de
 * tentativas possa ser testado sem servidor e sem esperar oito segundos.
 */

export interface ProgressoDeEnvio {
  readonly enviadas: number;
  readonly total: number;
  readonly bytesEnviados: number;
  readonly bytesTotais: number;
}

export interface OpcoesDeEnvio {
  readonly sessionId: string;
  readonly arquivo: Blob;
  readonly tamanhoDaParte?: number;
  readonly maxTentativas?: number;
  readonly onProgresso?: (p: ProgressoDeEnvio) => void;
  readonly fetchImpl?: typeof fetch;
  readonly dormir?: (ms: number) => Promise<void>;
  readonly aleatorio?: () => number;
  /** Aborta o envio inteiro; o que já subiu permanece no servidor. */
  readonly signal?: AbortSignal;
  /**
   * Para onde vão os pedaços. O padrão é o áudio da sessão; o segundo
   * microfone, quando o navegador não lê o formato, usa a rota dele.
   */
  readonly rota?: string;
}

export class EnvioInterrompido extends Error {
  constructor(
    message: string,
    /** Quais índices já estão no servidor — o envio continua daqui. */
    readonly partesEnviadas: number[],
  ) {
    super(message);
    this.name = "EnvioInterrompido";
  }
}

const dormirPadrao = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sobe o arquivo e devolve quantas partes ele tem.
 *
 * Não finaliza: quem chama decide quando declarar o áudio completo, porque a
 * finalização é o momento em que a quota é conferida e o trabalho entra na
 * fila — e isso carrega mais informação do que o envio conhece.
 */
export async function enviarEmPartes(opcoes: OpcoesDeEnvio): Promise<number> {
  const {
    sessionId,
    arquivo,
    tamanhoDaParte = TAMANHO_DA_PARTE,
    maxTentativas = 4,
    onProgresso,
    fetchImpl = fetch,
    dormir = dormirPadrao,
    aleatorio = Math.random,
    signal,
    rota,
  } = opcoes;

  const plano = planejarPartes(arquivo.size, tamanhoDaParte);
  if (plano.length === 0) throw new Error("arquivo vazio");

  const base = rota ?? `/api/sessions/${sessionId}/audio/partes`;

  /**
   * Pergunta o que já chegou ANTES de começar.
   *
   * É o que torna a retomada barata de verdade: numa segunda tentativa, depois
   * de a aba ter morrido, o cliente não sabe o que subiu — só o servidor sabe.
   * Uma falha aqui não impede o envio; significa começar do zero, que é o
   * comportamento antigo.
   */
  let jaNoServidor: number[] = [];
  try {
    const resposta = await fetchImpl(base, { method: "GET", signal: signal ?? null });
    if (resposta.ok) {
      const corpo = (await resposta.json()) as { partes?: unknown };
      if (Array.isArray(corpo.partes)) {
        jaNoServidor = corpo.partes.filter((n): n is number => typeof n === "number");
      }
    }
  } catch {
    // segue com a lista vazia
  }

  const enviadas = new Set(jaNoServidor.filter((i) => i < plano.length));
  const relatar = () => {
    onProgresso?.({
      enviadas: enviadas.size,
      total: plano.length,
      bytesEnviados: Math.min(enviadas.size * tamanhoDaParte, arquivo.size),
      bytesTotais: arquivo.size,
    });
  };
  relatar();

  for (const parte of partesFaltando(plano, [...enviadas])) {
    await enviarUmaParte(parte);
    enviadas.add(parte.indice);
    relatar();
  }

  return plano.length;

  async function enviarUmaParte(parte: Parte): Promise<void> {
    let ultimoErro: unknown = null;

    for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
      if (signal?.aborted === true) {
        throw new EnvioInterrompido("envio cancelado", [...enviadas]);
      }

      if (tentativa > 0) await dormir(esperaDeTentativa(tentativa - 1, aleatorio));

      try {
        const resposta = await fetchImpl(`${base}/${parte.indice}`, {
          method: "PUT",
          body: arquivo.slice(parte.inicio, parte.fim),
          signal: signal ?? null,
        });

        if (resposta.ok) return;

        /**
         * 4xx não é problema de rede: o pedido está errado, e repeti-lo
         * quatro vezes só atrasa a mensagem de erro. 408 e 429 são a
         * exceção — os dois dizem "tente de novo", e é o que fazemos.
         */
        if (
          resposta.status >= 400 &&
          resposta.status < 500 &&
          resposta.status !== 408 &&
          resposta.status !== 429
        ) {
          const corpo: unknown = await resposta.json().catch(() => null);
          throw new EnvioInterrompido(
            typeof corpo === "object" && corpo !== null && "error" in corpo
              ? String((corpo as { error: unknown }).error)
              : `envio recusado (${resposta.status})`,
            [...enviadas],
          );
        }

        ultimoErro = new Error(`servidor respondeu ${resposta.status}`);
      } catch (erro) {
        if (erro instanceof EnvioInterrompido) throw erro;
        ultimoErro = erro;
      }
    }

    throw new EnvioInterrompido(
      `não foi possível enviar o pedaço ${parte.indice + 1} de ${plano.length}: ` +
        (ultimoErro instanceof Error ? ultimoErro.message : "rede indisponível"),
      [...enviadas],
    );
  }
}

export interface DadosDeFinalizacao {
  readonly total: number;
  readonly extensao: string;
  readonly durationMs: number | null;
  readonly removedMs: number | null;
  readonly regions: unknown;
}

export interface RespostaDeFinalizacao {
  readonly ok: boolean;
  readonly status: number;
  readonly erro: string | null;
}

export async function finalizarEnvio(
  sessionId: string,
  dados: DadosDeFinalizacao,
  fetchImpl: typeof fetch = fetch,
): Promise<RespostaDeFinalizacao> {
  const resposta = await fetchImpl(`/api/sessions/${sessionId}/audio/finalizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });

  if (resposta.ok) return { ok: true, status: resposta.status, erro: null };

  const corpo: unknown = await resposta.json().catch(() => null);
  return {
    ok: false,
    status: resposta.status,
    erro:
      typeof corpo === "object" && corpo !== null && "error" in corpo
        ? String((corpo as { error: unknown }).error)
        : "falha ao concluir o envio",
  };
}
