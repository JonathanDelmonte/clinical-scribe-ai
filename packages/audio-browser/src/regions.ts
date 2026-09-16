/**
 * Regiões de fala e o mapa de tempo que as acompanha.
 *
 * Puro de propósito: nenhuma API de navegador aqui. Detectar fala é decisão
 * sobre números, e decisão sobre números se testa em milissegundos com sinais
 * sintéticos — não abrindo um navegador e falando no microfone.
 *
 * ## O problema que o mapa resolve
 *
 * Cortar o silêncio encurta o áudio, e encurtar o áudio MOVE todos os tempos
 * depois do corte. Isso não seria um detalhe: o produto inteiro depende de
 * clicar numa frase da nota e ouvir o trecho exato que a sustenta. Um
 * deslocamento de dez segundos transforma a prova em ruído.
 *
 * A decisão aqui é que o áudio enxuto É o registro: os tempos vivem no
 * tempo enxuto, de ponta a ponta, sem conversão em lugar nenhum. O mapa fica
 * guardado para dizer quanto foi removido — e para reconstruir o tempo
 * original se algum dia for preciso.
 */

export interface SpeechRegion {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Junta regiões separadas por pausas curtas.
 *
 * Sem isto, a respiração no meio de uma frase viraria duas regiões, e o corte
 * grudaria as duas metades sem a pausa natural. O Whisper alucina justamente
 * em transições abruptas — ele foi treinado em fala contínua, não em colagem.
 */
export function mergeRegions(
  regions: readonly SpeechRegion[],
  maxGapMs: number,
): SpeechRegion[] {
  if (regions.length === 0) return [];

  const ordenadas = [...regions].sort((a, b) => a.startMs - b.startMs);
  const saida: SpeechRegion[] = [];
  let atual = ordenadas[0];
  if (atual === undefined) return [];

  for (let i = 1; i < ordenadas.length; i++) {
    const proxima = ordenadas[i];
    if (proxima === undefined) continue;

    if (proxima.startMs - atual.endMs <= maxGapMs) {
      atual = {
        startMs: atual.startMs,
        endMs: Math.max(atual.endMs, proxima.endMs),
      };
    } else {
      saida.push(atual);
      atual = proxima;
    }
  }
  saida.push(atual);
  return saida;
}

/**
 * Acrescenta uma folga antes e depois de cada região.
 *
 * Detector de fala sempre chega tarde e sai cedo: ele precisa de energia
 * acumulada para decidir, e a primeira sílaba já passou. Sem folga, o corte
 * come o começo das palavras — e "não tome" vira "tome".
 */
export function padRegions(
  regions: readonly SpeechRegion[],
  paddingMs: number,
  durationMs: number,
): SpeechRegion[] {
  return mergeRegions(
    regions.map((r) => ({
      startMs: Math.max(0, r.startMs - paddingMs),
      endMs: Math.min(durationMs, r.endMs + paddingMs),
    })),
    0,
  );
}

export function totalMs(regions: readonly SpeechRegion[]): number {
  return regions.reduce((soma, r) => soma + (r.endMs - r.startMs), 0);
}

/**
 * Converte um instante do áudio enxuto para o instante no áudio original.
 *
 * Só é necessário para relatar ou auditar: o sistema inteiro trabalha em
 * tempo enxuto. Existe porque "quanto de silêncio foi removido" é informação
 * que um registro clínico deve conseguir responder.
 */
export function toOriginalMs(
  regions: readonly SpeechRegion[],
  trimmedMs: number,
): number {
  let percorrido = 0;
  for (const r of regions) {
    const duracao = r.endMs - r.startMs;
    if (trimmedMs <= percorrido + duracao) {
      return r.startMs + (trimmedMs - percorrido);
    }
    percorrido += duracao;
  }
  // Depois do fim: devolve o fim da última região em vez de um número
  // inventado. Extrapolar aqui produziria um tempo que não existe no áudio.
  const ultima = regions[regions.length - 1];
  return ultima?.endMs ?? trimmedMs;
}

/**
 * O caminho inverso. `null` quando o instante caiu num silêncio removido —
 * que é a resposta honesta: aquele instante não existe mais no áudio enxuto.
 */
export function toTrimmedMs(
  regions: readonly SpeechRegion[],
  originalMs: number,
): number | null {
  let percorrido = 0;
  for (const r of regions) {
    if (originalMs < r.startMs) return null;
    if (originalMs <= r.endMs) return percorrido + (originalMs - r.startMs);
    percorrido += r.endMs - r.startMs;
  }
  return null;
}
