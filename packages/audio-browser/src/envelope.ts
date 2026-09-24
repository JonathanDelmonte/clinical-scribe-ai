/**
 * O segundo microfone, medido no próprio aparelho.
 *
 * Para saber quem falou com dois microfones, o motor não precisa da gravação
 * do segundo — só da ENERGIA dela a cada 5 ms: qual dos dois microfones ouviu
 * mais alto em cada instante. Então o navegador mede isso e manda só a medida.
 * A gravação do lado do paciente nunca sai do aparelho de quem a fez.
 *
 *     gravação do celular, 30 min (~30 MB)  ──►  energia a cada 5 ms  ──►  ~0,7 MB
 *
 * Uma energia a cada 5 ms não contém palavras: é o contorno do volume. E o
 * tamanho resolve um segundo problema de graça — acima de 10 MB o Next CORTA
 * o corpo da requisição sem avisar (ver `src/lib/audio.ts` na web), e a
 * gravação de um celular passaria disso com folga.
 *
 * ## O formato é um contrato
 *
 * `canais.py`, no motor, lê o que `codificarEnvelope` escreve. Mudança aqui
 * precisa da mudança espelho lá — e o cabeçalho existe para que uma
 * divergência seja recusada na porta, em vez de virar um alinhamento plausível
 * e errado.
 *
 *     0   "CVE1"          mágica: Consulta Viva Envelope, versão 1
 *     4   uint32          taxa de amostragem (16000)
 *     8   uint16          passo em amostras (80 = 5 ms)
 *     10  uint16          reservado (0)
 *     12  uint32          quantos passos
 *     16  int16 × passos  energia de cada passo, em centésimos de dB
 *
 * Tudo little-endian.
 */

export const TAXA_ENVELOPE = 16_000;
/** 5 ms a 16 kHz. */
export const PASSO_ENVELOPE = 80;
export const CABECALHO_ENVELOPE = 16;
/**
 * Quatro horas. Nenhuma consulta chega perto, e o envelope inteiro (5,8 MB)
 * ainda cabe abaixo do teto de 10 MB do corpo de requisição.
 */
export const MAX_PASSOS_ENVELOPE = (4 * 3600 * TAXA_ENVELOPE) / PASSO_ENVELOPE;
export const MAX_BYTES_ENVELOPE = CABECALHO_ENVELOPE + 2 * MAX_PASSOS_ENVELOPE;

const MAGICA = "CVE1";

/**
 * Energia média (quadrática) a cada `passo` amostras, da mistura dos canais.
 *
 * A mesma definição de `energia_por_passo` no motor — os dois lados precisam
 * concordar nela. A mistura é a média dos canais, como em `prepare.ts`, e é
 * feita amostra a amostra dentro do laço: montar a versão mono antes dobraria
 * a memória de uma gravação que, decodificada, já passa de 200 MB por hora.
 */
export function energiaPorPasso(
  canais: readonly Float32Array[],
  passo: number = PASSO_ENVELOPE,
): Float64Array {
  const n = canais.length === 0 ? 0 : Math.min(...canais.map((c) => c.length));
  const passos = Math.floor(n / passo);
  const saida = new Float64Array(passos);
  const [a, b] = canais;

  if (canais.length === 1 && a !== undefined) {
    for (let p = 0; p < passos; p++) {
      let soma = 0;
      for (let i = p * passo, fim = i + passo; i < fim; i++) {
        const v = a[i] ?? 0;
        soma += v * v;
      }
      saida[p] = soma / passo;
    }
    return saida;
  }

  if (canais.length === 2 && a !== undefined && b !== undefined) {
    for (let p = 0; p < passos; p++) {
      let soma = 0;
      for (let i = p * passo, fim = i + passo; i < fim; i++) {
        const v = ((a[i] ?? 0) + (b[i] ?? 0)) / 2;
        soma += v * v;
      }
      saida[p] = soma / passo;
    }
    return saida;
  }

  const k = canais.length;
  for (let p = 0; p < passos; p++) {
    let soma = 0;
    for (let i = p * passo, fim = i + passo; i < fim; i++) {
      let v = 0;
      for (const c of canais) v += c[i] ?? 0;
      v /= k;
      soma += v * v;
    }
    saida[p] = soma / passo;
  }
  return saida;
}

/**
 * Energia linear por passo → o formato que o motor lê.
 *
 * Centésimos de dB em 16 bits: resolução de 0,01 dB, de -327 a +327 dB. O
 * piso (-100 dB, energia 1e-10 — silêncio digital) e o teto de uma onda cheia
 * (0 dB) cabem com folga, na metade dos bytes de um float.
 */
export function codificarEnvelope(energia: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  const passos = energia.length;
  if (passos > MAX_PASSOS_ENVELOPE) {
    throw new Error("gravação longa demais: o segundo microfone aceita até 4 horas");
  }
  const buffer = new ArrayBuffer(CABECALHO_ENVELOPE + 2 * passos);
  const view = new DataView(buffer);
  for (let i = 0; i < MAGICA.length; i++) view.setUint8(i, MAGICA.charCodeAt(i));
  view.setUint32(4, TAXA_ENVELOPE, true);
  view.setUint16(8, PASSO_ENVELOPE, true);
  view.setUint16(10, 0, true);
  view.setUint32(12, passos, true);
  for (let i = 0; i < passos; i++) {
    const db = 10 * Math.log10((energia[i] ?? 0) + 1e-10);
    const centesimos = Math.max(-32768, Math.min(32767, Math.round(db * 100)));
    view.setInt16(CABECALHO_ENVELOPE + 2 * i, centesimos, true);
  }
  return new Uint8Array(buffer);
}

export type LeituraDoEnvelope =
  | { readonly ok: true; readonly passos: number; readonly duracaoS: number }
  | { readonly ok: false; readonly erro: string };

/**
 * Confere o cabeçalho. É o que a rota da web faz antes de guardar qualquer
 * coisa — a mesma recusa que o motor faria, dita na hora do envio, e não num
 * job que falha minutos depois.
 *
 * O tamanho exato é a conferência que importa: um corpo cortado no caminho
 * chega com o cabeçalho intacto e menos passos do que anuncia.
 */
export function lerCabecalhoDoEnvelope(bytes: Uint8Array): LeituraDoEnvelope {
  if (bytes.byteLength < CABECALHO_ENVELOPE) {
    return { ok: false, erro: "a medida do segundo microfone chegou vazia" };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let magica = "";
  for (let i = 0; i < MAGICA.length; i++)
    magica += String.fromCharCode(view.getUint8(i));
  if (magica !== MAGICA) {
    return {
      ok: false,
      erro: "o arquivo enviado não é uma medida de segundo microfone",
    };
  }
  const taxa = view.getUint32(4, true);
  const passo = view.getUint16(8, true);
  const passos = view.getUint32(12, true);
  if (taxa !== TAXA_ENVELOPE || passo !== PASSO_ENVELOPE) {
    return {
      ok: false,
      erro: `medida feita a ${taxa} Hz em passos de ${passo}; o esperado é ${TAXA_ENVELOPE} Hz e ${PASSO_ENVELOPE}`,
    };
  }
  if (passos > MAX_PASSOS_ENVELOPE) {
    return {
      ok: false,
      erro: "gravação longa demais: o segundo microfone aceita até 4 horas",
    };
  }
  if (bytes.byteLength !== CABECALHO_ENVELOPE + 2 * passos) {
    return {
      ok: false,
      erro: "a medida do segundo microfone chegou cortada — envie de novo",
    };
  }
  return { ok: true, passos, duracaoS: (passos * PASSO_ENVELOPE) / TAXA_ENVELOPE };
}

export interface MedidaDoSegundoMicrofone {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly passos: number;
  readonly duracaoS: number;
}

/**
 * Decodifica a gravação do segundo aparelho e devolve só a medida.
 *
 * Só roda no navegador. `decodeAudioData` de um `OfflineAudioContext` a
 * 16 kHz já reamostra, como em `prepare.ts` — a mesma taxa em que o motor
 * mede o áudio da sessão.
 *
 * Formato que o navegador não decodifica (AMR, o `.3gp` de gravadores antigos
 * de Android) lança aqui, antes de qualquer envio.
 */
export async function medirSegundoMicrofone(
  blob: Blob,
): Promise<MedidaDoSegundoMicrofone> {
  const bruto = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, TAXA_ENVELOPE);
  const decodificado = await ctx.decodeAudioData(bruto);
  const canais = Array.from({ length: decodificado.numberOfChannels }, (_, c) =>
    decodificado.getChannelData(c),
  );
  const energia = energiaPorPasso(canais);
  return {
    bytes: codificarEnvelope(energia),
    passos: energia.length,
    duracaoS: (energia.length * PASSO_ENVELOPE) / TAXA_ENVELOPE,
  };
}
