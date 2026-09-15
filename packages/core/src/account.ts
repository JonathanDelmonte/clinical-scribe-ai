/**
 * Cargo, plano e escolha de motor de processamento.
 *
 * Três conceitos que se confundem com facilidade e precisam ficar separados:
 *
 *   CARGO  — quem a pessoa é.      Decide o que ela PODE fazer.
 *   PLANO  — o que ela contratou.  Decide o que ela RECEBE por padrão.
 *   MOTOR  — como o áudio roda.    É consequência dos dois, ou escolha do dev.
 *
 * Misturar cargo com plano é o erro clássico: vira um enum
 * `medico_gratis | medico_pro | desenvolvedor` que explode em combinações a
 * cada plano novo, e no qual "desenvolvedor" não tem plano nenhum. Separados,
 * dois eixos independentes cobrem tudo e nada explode.
 */

/**
 * Motor de processamento.
 *
 * Nomeados pelo que SÃO, não pelo que custam. "gratuito" e "pago" descrevem a
 * fatura de hoje: no dia em que o motor local virar o padrão de todo mundo, ou
 * em que um fornecedor de nuvem ficar mais barato, o nome passa a mentir e o
 * código inteiro fica confuso.
 *
 * - `local` — Whisper + pyannote no nosso container. O áudio nunca sai dele.
 *             Custo marginal ~zero, mais lento. Motor do plano grátis.
 * - `cloud` — API comercial de ASR. Rápido, custa por minuto, e o áudio sai
 *             da nossa infraestrutura (ver §10 da documentação sobre
 *             residência de dados e subprocessadores).
 */
export type Engine = "local" | "cloud";

/**
 * Cargo — quem a pessoa é dentro do sistema.
 *
 * `professional` e não `medico`: a documentação (§4) é explícita em preferir
 * "clínico"/"profissional", porque "médico" fecha o produto numa categoria e
 * deixa de fora nutricionistas, psicólogos, fisioterapeutas e dentistas — que
 * são o mercado maior e menos disputado.
 */
export type UserRole = "professional" | "developer";

/** Plano — o que a pessoa contratou. */
export type Plan = "free" | "pro" | "clinic";

export interface Account {
  readonly role: UserRole;
  readonly plan: Plan;
  /** Preferência persistente de motor. Só tem efeito para `developer`. */
  readonly preferredEngine: Engine | null;
}

/** Qual motor cada plano recebe quando ninguém escolhe. */
export const PLAN_DEFAULT_ENGINE: Record<Plan, Engine> = {
  free: "local",
  pro: "cloud",
  clinic: "cloud",
};

/** Quota mensal em minutos de áudio. `null` = sem teto (fair use). */
export const PLAN_MONTHLY_MINUTES: Record<Plan, number | null> = {
  free: 300,
  pro: null,
  clinic: null,
};

export type EngineReason = "developer-choice" | "plan-default";

export interface EngineDecision {
  readonly engine: Engine;
  readonly reason: EngineReason;
  /**
   * Um motor foi pedido e descartado por falta de permissão.
   *
   * Não é erro — a decisão segue com o padrão do plano, que é o lado seguro.
   * Mas **registre sempre que vier preenchido**: ou é bug de interface
   * oferecendo uma opção que não existe, ou é alguém no plano grátis tentando
   * usar o motor que custa dinheiro.
   */
  readonly ignoredChoice: Engine | null;
}

/** Só desenvolvedor escolhe o motor. */
export function canChooseEngine(account: Account): boolean {
  return account.role === "developer";
}

/**
 * Decide qual motor usar.
 *
 * Precedência: escolha da sessão → preferência do dev → padrão do plano.
 *
 * A regra que importa para o caixa: quem não é desenvolvedor **não escolhe**.
 * Se alguém no plano grátis pedir `cloud`, o pedido é descartado e a decisão
 * cai no padrão do plano. Falha fechada, e o pedido descartado fica visível
 * em `ignoredChoice` em vez de sumir em silêncio.
 *
 * Esta função é pura de propósito: a regra que decide quanto o produto gasta
 * precisa ser testável sem banco, sem rede e sem sessão de usuário.
 */
export function resolveEngine(
  account: Account,
  sessionChoice: Engine | null = null,
): EngineDecision {
  const planDefault = PLAN_DEFAULT_ENGINE[account.plan];

  if (!canChooseEngine(account)) {
    return {
      engine: planDefault,
      reason: "plan-default",
      ignoredChoice: sessionChoice,
    };
  }

  const chosen = sessionChoice ?? account.preferredEngine;
  if (chosen !== null) {
    return { engine: chosen, reason: "developer-choice", ignoredChoice: null };
  }

  return { engine: planDefault, reason: "plan-default", ignoredChoice: null };
}

/**
 * Quantos minutos ainda cabem na quota do mês.
 *
 * `null` = sem teto. Nunca devolve negativo: estourou é zero.
 */
export function remainingMinutes(
  plan: Plan,
  minutesUsedThisMonth: number,
): number | null {
  const limit = PLAN_MONTHLY_MINUTES[plan];
  if (limit === null) return null;
  return Math.max(0, limit - minutesUsedThisMonth);
}

/**
 * A sessão pode ser processada?
 *
 * **Chame ANTES de processar, nunca depois.** Verificar a quota no fim é
 * descobrir que estourou quando o dinheiro já saiu — e é exatamente assim que
 * um plano grátis sangra caixa sem ninguém notar.
 *
 * Desenvolvedor não tem quota: senão você fica sem poder testar o produto que
 * está construindo, o que é uma forma boba de se bloquear.
 */
export function canProcess(
  account: Account,
  minutesUsedThisMonth: number,
  sessionMinutes: number,
): { allowed: true } | { allowed: false; reason: string } {
  if (account.role === "developer") return { allowed: true };

  const remaining = remainingMinutes(account.plan, minutesUsedThisMonth);
  if (remaining === null) return { allowed: true };

  if (sessionMinutes > remaining) {
    return {
      allowed: false,
      reason:
        `Quota do plano ${account.plan} esgotada: restam ` +
        `${Math.floor(remaining)} min e esta sessão precisa de ` +
        `${Math.ceil(sessionMinutes)} min.`,
    };
  }

  return { allowed: true };
}
