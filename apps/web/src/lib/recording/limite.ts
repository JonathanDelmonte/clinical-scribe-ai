/**
 * Os limites de uma gravação — e o que acontece em cada um.
 *
 * A gravação em si nunca trava: o navegador salva um pedaço a cada
 * `INTERVALO_DE_PEDACO_MS` no próprio aparelho, e o que foi gravado sobrevive
 * até a uma aba que cai. Os limites existem para o que vem DEPOIS — preparar,
 * enviar, guardar — e cada um é dito antes de chegar, nunca descoberto no fim.
 */

/**
 * Pedaços de 5 segundos.
 *
 * O valor decide quanto se perde no pior caso — o que ainda não foi entregue
 * ao `ondataavailable` quando a aba morre. Um segundo perderia menos e
 * escreveria no IndexedDB sessenta vezes por minuto durante uma hora, o que em
 * celular antigo compete com a própria gravação. Cinco segundos é a troca:
 * doze escritas por minuto, cinco segundos de risco.
 */
export const INTERVALO_DE_PEDACO_MS = 5000;

/**
 * Três horas.
 *
 * Nenhuma consulta chega perto, e é o que cabe, comprimido, num arquivo do
 * Supabase gratuito: 50 MB por arquivo, e o áudio guardado ocupa ~14,7 MB
 * por hora. Encerrar aqui, avisando antes, é o que impede uma consulta longa
 * de ser gravada inteira e depois recusada.
 */
export const LIMITE_GRAVACAO_S = 3 * 60 * 60;

/** O aviso aparece 15 minutos antes do fim. */
export const AVISO_ANTES_DO_LIMITE_S = 15 * 60;

export type EstadoDoLimite =
  | { readonly tipo: "normal" }
  | { readonly tipo: "aviso"; readonly minutosRestantes: number }
  | { readonly tipo: "encerrar" };

export function estadoDoLimite(segundosGravados: number): EstadoDoLimite {
  if (segundosGravados >= LIMITE_GRAVACAO_S) return { tipo: "encerrar" };
  const restantes = LIMITE_GRAVACAO_S - segundosGravados;
  if (restantes <= AVISO_ANTES_DO_LIMITE_S) {
    return { tipo: "aviso", minutosRestantes: Math.ceil(restantes / 60) };
  }
  return { tipo: "normal" };
}

// ---- onde a gravação é preparada -------------------------------------------

/**
 * Até quanto tempo o navegador prepara o áudio — decodifica, corta o
 * silêncio, reamostra para 16 kHz.
 *
 * Preparar decodifica a gravação INTEIRA na memória, com cópias: uma hora
 * passa de meio gigabyte no pico. Num computador tanto faz; num celular é o
 * que derruba a aba — e uma aba que cai não é um erro que o código consiga
 * tratar. `navigator.deviceMemory` (Chrome; arredondado, no máximo 8) diz
 * quanto o aparelho tem. Sem ele (Safari, Firefox), vale o limite cauteloso.
 *
 * Acima do limite a gravação sobe como veio — já comprimida pelo próprio
 * navegador, e menor que o WAV preparado —, e o worker cuida do resto. O que
 * se perde é só cortar o silêncio aqui.
 */
export function limiteDePreparoS(memoriaGb: number | undefined): number {
  return memoriaGb !== undefined && memoriaGb >= 8 ? 60 * 60 : 30 * 60;
}

/** Uma gravação de `pedacos` pedaços é curta o bastante para preparar aqui? */
export function prepararGravacaoNoNavegador(
  pedacos: number,
  memoriaGb?: number,
): boolean {
  return (pedacos * INTERVALO_DE_PEDACO_MS) / 1000 <= limiteDePreparoS(memoriaGb);
}

/** 128 kbps: a taxa típica de uma gravação feita no navegador. */
const BYTES_POR_SEGUNDO_TIPICOS = 16_000;

/**
 * O mesmo, para um arquivo escolhido no aparelho.
 *
 * A duração vem dos metadados (`duracaoPelosMetadados`), que o navegador lê
 * sem decodificar. Quando ela não existe — o WebM do próprio MediaRecorder não
 * a traz —, estima pelo tamanho, na taxa típica de uma gravação de navegador.
 */
export function prepararArquivoNoNavegador(
  duracaoS: number | null,
  bytes: number,
  memoriaGb?: number,
): boolean {
  const limite = limiteDePreparoS(memoriaGb);
  if (duracaoS !== null && Number.isFinite(duracaoS) && duracaoS > 0) {
    return duracaoS <= limite;
  }
  return bytes <= limite * BYTES_POR_SEGUNDO_TIPICOS;
}

export function memoriaDoAparelho(): number | undefined {
  try {
    const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return typeof memoria === "number" && memoria > 0 ? memoria : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A duração de um arquivo pelos metadados — sem decodificar o áudio.
 *
 * `null` quando o navegador não lê o formato, quando o arquivo não traz a
 * duração, ou quando ele demora a responder.
 */
export function duracaoPelosMetadados(
  arquivo: Blob,
  esperaMs = 5000,
): Promise<number | null> {
  return new Promise((resolve) => {
    let url: string;
    try {
      url = URL.createObjectURL(arquivo);
    } catch {
      resolve(null);
      return;
    }
    const audio = document.createElement("audio");
    let respondido = false;
    const responder = (duracao: number | null) => {
      if (respondido) return;
      respondido = true;
      clearTimeout(espera);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      resolve(duracao);
    };
    const espera = setTimeout(() => responder(null), esperaMs);
    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      responder(
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null,
      );
    audio.onerror = () => responder(null);
    audio.src = url;
  });
}

// ---- a aba que caiu no preparo não cai de novo -----------------------------

const PREFIXO_DA_MARCA = "consulta-viva:preparando:";

type Marcas = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function marcasDoAparelho(): Marcas | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Prepara — a não ser que a última tentativa com esta mesma gravação tenha
 * derrubado a aba. Devolve `null` quando pula.
 *
 * Um erro comum volta como erro, e quem chama sobe o original. O que nenhum
 * código trata é a aba morrer por falta de memória NO MEIO do preparo: a
 * gravação continua salva no aparelho, a pessoa recarrega, clica em "Enviar
 * agora" — e o preparo derruba a aba de novo. Para sempre. A marca gravada
 * antes de começar e apagada ao terminar quebra esse ciclo: se ela ainda está
 * lá, a última tentativa não terminou, e esta sobe o original direto.
 *
 * A marca que sobrou fica até `esquecerPreparo`, chamado quando a gravação é
 * enviada ou descartada: tentar preparar de novo entre um envio que falhou e
 * o seguinte seria arriscar a mesma queda.
 */
export async function prepararSemRepetirQueda<T>(
  chave: string,
  preparar: () => Promise<T>,
  marcas: Marcas | null = marcasDoAparelho(),
): Promise<T | null> {
  const marca = PREFIXO_DA_MARCA + chave;
  try {
    const anterior = marcas?.getItem(marca);
    if (anterior !== null && anterior !== undefined) return null;
    marcas?.setItem(marca, String(Date.now()));
  } catch {
    // Sem onde marcar (cota cheia, armazenamento bloqueado): prepara sem a
    // proteção, como antes dela.
  }
  try {
    return await preparar();
  } finally {
    try {
      marcas?.removeItem(marca);
    } catch {
      // idem
    }
  }
}

export function esquecerPreparo(
  chave: string,
  marcas: Marcas | null = marcasDoAparelho(),
): void {
  try {
    marcas?.removeItem(PREFIXO_DA_MARCA + chave);
  } catch {
    // idem
  }
}
