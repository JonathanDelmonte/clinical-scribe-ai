/**
 * Reatribuir quem falou, a partir dos turnos de dois microfones.
 *
 * A diarização por canal chega DEPOIS da transcrição: o profissional grava,
 * a consulta é transcrita, e só então ele envia a medida do segundo aparelho.
 * Refazer a transcrição do zero seria o caminho simples, e destruiria três
 * coisas — ver `reatribuirPorCanais`.
 *
 * ## Quem é o profissional: dito, não adivinhado
 *
 * Os turnos dizem de que LADO a fala veio — do aparelho que gravou a sessão
 * ou do segundo microfone. Quem estava de cada lado não se adivinha: a pessoa
 * que posicionou os aparelhos sabe, e diz ao enviar. Com isso o papel sai de
 * um fato físico declarado, e não de uma heurística.
 *
 * O conteúdo da conversa — o mesmo classificador de sempre — vira conferência:
 * se ele discorda com segurança do que foi declarado, a confiança cai e a tela
 * pede revisão. Esquecer onde o celular ficou é um erro humano plausível, e o
 * resultado dele seria a transcrição inteira com os papéis trocados.
 */

import type { SpeakerRole, SpeakerRoleSource } from "./domain";
import type { SpeakerAssignment } from "./roles";

/**
 * Os rótulos dos turnos — os MESMOS de `canais.py`, no motor.
 *
 * Não são os do pyannote (SPEAKER_00...): um trecho que o segundo microfone
 * não cobriu pode ficar com o rótulo antigo, e o mesmo nome em dois grupos
 * diferentes misturaria as pessoas.
 */
export const ROTULO_PRINCIPAL = "CANAL_00";
export const ROTULO_SEGUNDO = "CANAL_01";

/** Quem estava perto do segundo microfone. */
export type LadoDoSegundo = "patient" | "professional";

export interface TurnoDeCanal {
  readonly inicioS: number;
  readonly fimS: number;
  readonly falante: string;
}

/**
 * O falante cujo turno mais se sobrepõe ao trecho. `null` quando nenhum toca.
 *
 * Maioria por sobreposição, e não "quem falou no início do trecho": trechos
 * começam com um pouco de silêncio ou com o fim da fala anterior, e decidir
 * pelo primeiro instante atribuiria a primeira sílaba de cada resposta a quem
 * perguntou.
 */
export function falantePorSobreposicao(
  inicioMs: number,
  fimMs: number,
  turnos: readonly TurnoDeCanal[],
): string | null {
  const ini = inicioMs / 1000;
  const fim = fimMs / 1000;
  let melhor: string | null = null;
  let maior = 0;
  for (const t of turnos) {
    const sobreposicao = Math.min(fim, t.fimS) - Math.max(ini, t.inicioS);
    if (sobreposicao > maior) {
      maior = sobreposicao;
      melhor = t.falante;
    }
  }
  return melhor;
}

/** O papel de cada lado, a partir de onde o segundo microfone ficou. */
export function papeisDosCanais(
  segundoPerto: LadoDoSegundo,
): Record<string, SpeakerRole> {
  return {
    [ROTULO_PRINCIPAL]: segundoPerto === "patient" ? "professional" : "patient",
    [ROTULO_SEGUNDO]: segundoPerto,
  };
}

export interface TrechoParaReatribuir {
  readonly id: string;
  readonly speakerLabel: string;
  readonly role: SpeakerRole;
  readonly roleSource: SpeakerRoleSource;
  /** Quando alguém corrigiu este trecho à mão; `null` se ninguém corrigiu. */
  readonly correctedAt: Date | string | null;
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * O papel DESTE trecho foi decidido por uma pessoa, trecho a trecho?
 *
 * `roleSource: "manual"` sozinho não basta. A inversão de papéis ("trocar",
 * na barra Quem é quem) também grava `manual` — em todos os trechos de uma
 * vez, e sem `correctedAt`. Ela corrige a LEITURA da diarização antiga ("o
 * grupo 1 é o paciente, não o profissional"), não afirma nada sobre cada fala;
 * tratá-la como correção trecho a trecho congelaria a transcrição inteira, e o
 * segundo microfone não conseguiria consertar justamente as sessões em que a
 * separação por voz mais errou.
 */
export function papelConferidoAMao(t: TrechoParaReatribuir): boolean {
  return t.roleSource === "manual" && t.correctedAt !== null;
}

export interface Reatribuicao {
  readonly id: string;
  readonly speakerLabel: string;
  readonly role: SpeakerRole;
  readonly roleSource: SpeakerRoleSource;
  /**
   * - `medido`: os dois microfones decidiram este trecho.
   * - `preservado`: decidiriam, mas alguém já tinha corrigido o papel à mão.
   * - `sem_medida`: nenhum turno o cobre — o segundo aparelho não gravou
   *   aquele instante, ou ninguém falou alto o bastante. Fica como estava.
   */
  readonly origem: "medido" | "preservado" | "sem_medida";
}

/**
 * Novos rótulos e papéis para os trechos existentes.
 *
 * ## O que NÃO acontece, e por quê
 *
 * Os trechos não são recriados. Cada um mantém o ID e o texto:
 *
 *  1. **As citações da nota continuam valendo.** A nota cita trechos por ID;
 *     trechos novos deixariam cada afirmação apontando para o nada.
 *  2. **As correções de texto sobrevivem.** O profissional pode ter consertado
 *     "azar" para "arder"; refazer a transcrição traria o "azar" de volta.
 *  3. **As correções de falante sobrevivem** — e esta é a regra sem exceção:
 *     trecho cujo papel alguém corrigiu à mão (`papelConferidoAMao`) não tem o
 *     papel tocado. A correção humana vale mais que qualquer algoritmo, este
 *     incluído. Se os dois discordam, quem sabe é quem estava na sala.
 *
 * O preço é a granularidade: um trecho que atravessa uma troca de falante fica
 * inteiro com quem falou a maior parte dele. Os trechos já são quebrados em
 * pausas e fins de frase, então isso é raro — e é um preço menor que
 * qualquer um dos três acima.
 *
 * ## Trecho sem medida
 *
 * Mantém o papel e ganha o rótulo do lado que TEM esse papel. Mantê-lo com o
 * rótulo do pyannote misturaria dois vocabulários na mesma tela: "Voz 1" de um
 * sistema ao lado de "Voz 1" do outro, pessoas diferentes com o mesmo nome.
 * Papel desconhecido não tem lado, e aí o rótulo antigo fica.
 */
export function reatribuirPorCanais(
  trechos: readonly TrechoParaReatribuir[],
  turnos: readonly TurnoDeCanal[],
  segundoPerto: LadoDoSegundo,
): Reatribuicao[] {
  const papelDoCanal = papeisDosCanais(segundoPerto);
  const canalDoPapel = new Map(
    Object.entries(papelDoCanal).map(([rotulo, papel]) => [papel, rotulo] as const),
  );

  return trechos.map((t) => {
    const falante = falantePorSobreposicao(t.startMs, t.endMs, turnos);
    const papel = falante === null ? undefined : papelDoCanal[falante];

    if (falante === null || papel === undefined) {
      return {
        id: t.id,
        speakerLabel: canalDoPapel.get(t.role) ?? t.speakerLabel,
        role: t.role,
        roleSource: t.roleSource,
        origem: "sem_medida",
      };
    }
    if (papelConferidoAMao(t)) {
      // O rótulo acústico pode mudar; o papel, não.
      return {
        id: t.id,
        speakerLabel: falante,
        role: t.role,
        roleSource: t.roleSource,
        origem: "preservado",
      };
    }
    return {
      id: t.id,
      speakerLabel: falante,
      role: papel,
      roleSource: "channel",
      origem: "medido",
    };
  });
}

/**
 * A barra "Quem é quem" depois dos dois microfones.
 *
 * O papel vem da posição declarada. `porConteudo` é o classificador de sempre,
 * rodado sobre os rótulos NOVOS — ele entra como conferência e como as
 * evidências que a tela mostra em "por quê?".
 *
 * Confiança 1 quando o conteúdo concorda ou não tem opinião: o papel é um fato
 * declarado por quem posicionou os aparelhos, com o mesmo peso da inversão
 * manual. Quando o conteúdo discorda COM segurança, a confiança vira o
 * complemento da dele — e a tela, que já pede revisão abaixo de 50%, pede.
 */
export function atribuicaoDosCanais(
  segundoPerto: LadoDoSegundo,
  porConteudo: readonly SpeakerAssignment[],
): { atribuicao: SpeakerAssignment[]; conteudoDiscorda: boolean } {
  const papelDoCanal = papeisDosCanais(segundoPerto);
  // Só existe papel "professional" no resultado do conteúdo quando ele passou
  // do próprio limiar de confiança; abaixo disso ele devolve `unknown`.
  const profissionalPeloConteudo = porConteudo.find((a) => a.role === "professional");
  const conteudoDiscorda =
    profissionalPeloConteudo !== undefined &&
    papelDoCanal[profissionalPeloConteudo.speakerLabel] !== "professional";

  const confianca = conteudoDiscorda
    ? Math.max(0, Math.min(1, 1 - (profissionalPeloConteudo?.confidence ?? 0)))
    : 1;

  const atribuicao = [ROTULO_PRINCIPAL, ROTULO_SEGUNDO].map((rotulo) => ({
    speakerLabel: rotulo,
    role: papelDoCanal[rotulo] ?? ("unknown" as const),
    confidence: confianca,
    evidence: porConteudo.find((a) => a.speakerLabel === rotulo)?.evidence ?? [],
  }));

  return { atribuicao, conteudoDiscorda };
}

// -----------------------------------------------------------------------------
// O estado guardado na sessão
// -----------------------------------------------------------------------------

/**
 * O que `sessions.channel_diarization` guarda: o pedido e, depois, o resultado.
 *
 * - `na_fila`: a medida chegou; o worker ainda não processou.
 * - `aplicado`: os dois microfones refizeram quem falou.
 * - `recusado`: o motor mediu e concluiu que não dava — `motivo` diz por quê.
 *   Nada mudou nos trechos.
 */
export interface EstadoDoSegundoMicrofone {
  readonly estado: "na_fila" | "aplicado" | "recusado";
  readonly segundoPerto: LadoDoSegundo;
  readonly enviadoEm: string;
  /** Duração da gravação do segundo aparelho, pelo envelope. */
  readonly duracaoS: number;
  readonly motivo?: string | null;
  readonly deslocamentoS?: number;
  readonly derivaPpm?: number;
  readonly qualidade?: number;
  readonly separacaoDb?: number | null;
  readonly cobertura?: number | null;
  readonly medidos?: number;
  readonly preservados?: number;
  readonly semMedida?: number;
  readonly conteudoDiscorda?: boolean;
  readonly processadoEm?: string;
}

const ESTADOS = new Set(["na_fila", "aplicado", "recusado"]);
const LADOS = new Set(["patient", "professional"]);

/**
 * Lê o `jsonb` da sessão, ou `null` se ele não tem a forma esperada.
 *
 * Conferido campo a campo porque o tipo é uma afirmação sobre o que está
 * gravado, não uma verificação: uma linha escrita por outra versão passa pelo
 * banco e quebraria quem confiasse cegamente nela. O worker decide o papel de
 * cada fala por `segundoPerto` — lido errado, a transcrição inteira sairia com
 * os papéis trocados.
 */
export function lerEstadoDoSegundoMicrofone(
  json: unknown,
): EstadoDoSegundoMicrofone | null {
  if (typeof json !== "object" || json === null) return null;
  const e = json as Record<string, unknown>;
  if (typeof e["estado"] !== "string" || !ESTADOS.has(e["estado"])) return null;
  if (typeof e["segundoPerto"] !== "string" || !LADOS.has(e["segundoPerto"]))
    return null;
  if (typeof e["enviadoEm"] !== "string") return null;
  if (typeof e["duracaoS"] !== "number" || !Number.isFinite(e["duracaoS"])) return null;
  return json as EstadoDoSegundoMicrofone;
}
