/**
 * Limitador de taxa — balde de fichas, em memória.
 *
 * ## O que ele protege, e de quê
 *
 * Três coisas diferentes, com números diferentes:
 *
 * - **Login**: força bruta. Cada tentativa custa ~50 ms de scrypt ao servidor
 *   e nada a quem tenta; sem teto, uma lista de senhas comuns roda a noite
 *   inteira contra uma conta.
 * - **Processamento**: dinheiro. Enviar áudio e pedir geração de nota são as
 *   duas operações que custam por uso.
 * - **Exportação**: banco. Exportar todos os dados lê seis tabelas inteiras.
 *
 * ## Por que balde de fichas, e não janela fixa
 *
 * Janela fixa tem um defeito conhecido na fronteira: com "10 por minuto", dá
 * para fazer 10 no último segundo de um minuto e mais 10 no primeiro segundo
 * do seguinte — 20 em dois segundos, que é justamente o que o limite deveria
 * impedir. O balde não tem fronteira: ele enche devagar e esvazia conforme o
 * uso.
 *
 * ## ⚠️ O limite desta implementação
 *
 * O estado vive **na memória deste processo**. Com mais de uma instância da
 * aplicação, cada uma tem o próprio balde, e o limite efetivo é multiplicado
 * pelo número de instâncias.
 *
 * Isso é suficiente e honesto para o desenho de hoje — um processo web, um
 * worker, um servidor. Quando houver mais de uma instância, a implementação em
 * Postgres entra atrás desta mesma interface. O que **não** é aceitável é não
 * ter limite nenhum: "vamos fazer certo depois" costuma significar "a porta
 * ficou aberta", e esta porta dá para uma conta de paciente.
 */

export interface Politica {
  /** Quantas fichas o balde comporta — o pico permitido. */
  readonly capacidade: number;
  /** Em quanto tempo o balde enche do zero. */
  readonly recargaMs: number;
}

export interface Veredito {
  readonly permitido: boolean;
  /** Fichas restantes depois desta tentativa. */
  readonly restantes: number;
  /** Segundos até a próxima ficha, quando negado. */
  readonly esperarSegundos: number;
}

interface Balde {
  fichas: number;
  atualizadoEm: number;
}

export class Limitador {
  readonly #baldes = new Map<string, Balde>();
  readonly #politica: Politica;
  readonly #agora: () => number;

  constructor(politica: Politica, agora: () => number = Date.now) {
    this.#politica = politica;
    this.#agora = agora;
  }

  /** Consome uma ficha. */
  consumir(chave: string): Veredito {
    const agora = this.#agora();
    const { capacidade, recargaMs } = this.#politica;
    const porMs = capacidade / recargaMs;

    const balde = this.#baldes.get(chave) ?? {
      fichas: capacidade,
      atualizadoEm: agora,
    };

    const recarregado = Math.min(
      capacidade,
      balde.fichas + (agora - balde.atualizadoEm) * porMs,
    );

    if (recarregado < 1) {
      // Não consome: uma tentativa negada não pode empurrar o relógio para
      // frente, senão quem insiste sem parar nunca sai do bloqueio.
      this.#baldes.set(chave, { fichas: recarregado, atualizadoEm: agora });
      return {
        permitido: false,
        restantes: 0,
        esperarSegundos: Math.max(1, Math.ceil((1 - recarregado) / porMs / 1000)),
      };
    }

    const restantes = recarregado - 1;
    this.#baldes.set(chave, { fichas: restantes, atualizadoEm: agora });
    return { permitido: true, restantes: Math.floor(restantes), esperarSegundos: 0 };
  }

  /**
   * Remove baldes que já encheram de novo.
   *
   * Sem isto, o `Map` cresce com uma entrada por IP visto — e um pico de
   * tráfego, legítimo ou não, vira memória que não volta. Um balde cheio não
   * carrega informação nenhuma: recriá-lo dá exatamente o mesmo resultado.
   */
  limpar(): number {
    const agora = this.#agora();
    const { capacidade, recargaMs } = this.#politica;
    let removidos = 0;

    for (const [chave, balde] of this.#baldes) {
      const cheio =
        balde.fichas + (agora - balde.atualizadoEm) * (capacidade / recargaMs) >=
        capacidade;
      if (cheio) {
        this.#baldes.delete(chave);
        removidos += 1;
      }
    }
    return removidos;
  }

  get tamanho(): number {
    return this.#baldes.size;
  }
}

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

/**
 * As políticas, e o raciocínio de cada número.
 *
 * Todos generosos para uso humano e apertados para uso automatizado — é essa a
 * linha que se quer traçar. Um limite que incomoda quem está trabalhando é um
 * limite que vai ser afrouxado até não valer nada.
 */
export const POLITICAS = {
  /**
   * Login: 8 tentativas, recarregando em 15 minutos.
   *
   * Quem digita errado tenta três ou quatro vezes e resolve. Uma lista de
   * senhas comuns tem milhares de entradas e morre em 8.
   */
  login: { capacidade: 8, recargaMs: 15 * MINUTO },

  /** Cadastro: 5 por hora por IP. Cria conta de verdade, não em série. */
  cadastro: { capacidade: 5, recargaMs: HORA },

  /**
   * Envio de áudio: 40 por hora.
   *
   * Uma agenda cheia tem o quê, 12 consultas? O teto está muito acima do uso
   * real e muito abaixo de um laço enviando arquivos.
   */
  upload: { capacidade: 40, recargaMs: HORA },

  /**
   * Pedaços de upload: 600 por hora.
   *
   * Uma consulta de 30 minutos são ~10 pedaços. 600 cobre um dia inteiro de
   * agenda com reenvios, e ainda barra um laço.
   */
  pedaco: { capacidade: 600, recargaMs: HORA },

  /** Geração de nota e objetivo: custa LLM por chamada. */
  geracao: { capacidade: 30, recargaMs: HORA },

  /** Exportar um documento: barato, mas não de graça. */
  exportacao: { capacidade: 60, recargaMs: HORA },

  /** Exportar TODOS os dados: lê seis tabelas inteiras. */
  exportacaoTotal: { capacidade: 5, recargaMs: HORA },
} as const satisfies Record<string, Politica>;
