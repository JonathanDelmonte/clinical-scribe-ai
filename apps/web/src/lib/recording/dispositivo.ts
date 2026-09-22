/**
 * O que o aparelho pode fazer com a gravação sem avisar ninguém.
 *
 * Três coisas acontecem no celular real e nenhuma delas dá erro:
 *
 * 1. **A permissão de microfone já foi negada.** O botão de gravar parece
 *    normal, e a falha só aparece quando a consulta já deveria estar gravando.
 * 2. **A tela apaga.** Em alguns aparelhos isso suspende a aba e a gravação
 *    para no meio — sem mensagem, sem erro.
 * 3. **O microfone é tomado.** Uma ligação, outro aplicativo, o fone que
 *    desconecta: a trilha termina e o `MediaRecorder` segue "gravando"
 *    silêncio até o fim.
 *
 * As três são detectáveis antes ou no instante em que acontecem, e é isso que
 * este módulo faz. Nenhuma API aqui existe em todos os navegadores, então tudo
 * degrada para "não sei" em vez de quebrar.
 */

export type EstadoDaPermissao = "concedida" | "negada" | "perguntar" | "desconhecida";

export async function permissaoDeMicrofone(): Promise<EstadoDaPermissao> {
  try {
    if (typeof navigator === "undefined" || navigator.permissions === undefined) {
      return "desconhecida";
    }
    // `microphone` não faz parte do conjunto de nomes que o TypeScript conhece
    // em todo lib.dom, e o Firefox lança para nomes que não suporta.
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    if (status.state === "granted") return "concedida";
    if (status.state === "denied") return "negada";
    return "perguntar";
  } catch {
    return "desconhecida";
  }
}

export interface NivelDeBateria {
  /** 0 a 1. */
  readonly nivel: number;
  readonly carregando: boolean;
}

/** Abaixo disto, uma consulta longa pode não caber no que resta de bateria. */
export const BATERIA_BAIXA = 0.2;

export async function bateria(): Promise<NivelDeBateria | null> {
  try {
    const n = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    };
    if (n.getBattery === undefined) return null;
    const b = await n.getBattery();
    return { nivel: b.level, carregando: b.charging };
  } catch {
    return null;
  }
}

/**
 * Impede a tela de apagar enquanto a consulta é gravada.
 *
 * Devolve uma função que solta a trava. O `WakeLock` some sozinho quando a aba
 * vai para segundo plano, e por isso ele é re-adquirido ao voltar: sem isso, a
 * proteção vale só até a primeira troca de aplicativo — que é exatamente
 * quando ela seria necessária.
 */
export async function manterTelaAcesa(): Promise<() => void> {
  interface Sentinel {
    release: () => Promise<void>;
    addEventListener: (tipo: string, ouvinte: () => void) => void;
  }
  const wakeLock = (
    navigator as Navigator & {
      wakeLock?: { request: (tipo: "screen") => Promise<Sentinel> };
    }
  ).wakeLock;

  if (wakeLock === undefined) return () => undefined;

  let trava: Sentinel | null = null;
  let ativo = true;

  const adquirir = async () => {
    if (!ativo || document.visibilityState !== "visible") return;
    try {
      trava = await wakeLock.request("screen");
    } catch {
      // Bateria baixa faz o navegador recusar. Não é erro que interrompa nada.
    }
  };

  const aoVoltar = () => void adquirir();
  document.addEventListener("visibilitychange", aoVoltar);
  await adquirir();

  return () => {
    ativo = false;
    document.removeEventListener("visibilitychange", aoVoltar);
    void trava?.release().catch(() => undefined);
    trava = null;
  };
}

/**
 * Avisa quando o microfone é tomado no meio da gravação.
 *
 * O `MediaRecorder` não reclama: ele continua produzindo pedaços, agora de
 * silêncio. O sintoma é uma consulta gravada pela metade que só é descoberta
 * quando a transcrição volta vazia — depois de o paciente ter ido embora.
 */
export function vigiarMicrofone(fluxo: MediaStream, aoPerder: () => void): () => void {
  const trilhas = fluxo.getAudioTracks();
  const ouvinte = () => aoPerder();
  for (const t of trilhas) t.addEventListener("ended", ouvinte);
  return () => {
    for (const t of trilhas) t.removeEventListener("ended", ouvinte);
  };
}
