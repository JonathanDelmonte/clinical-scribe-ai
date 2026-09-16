/**
 * Contrato do modelo de linguagem — e a política de dados que ele carrega.
 *
 * Existe pelo mesmo motivo que `TranscriptionProvider`: trocar de fornecedor
 * deve ser configuração, não reescrita. Mas aqui há uma segunda razão, que não
 * existe na transcrição.
 *
 * A TRANSCRIÇÃO roda no nosso servidor. O áudio não sai. A NOTA, não: o texto
 * da consulta — o dado mais sensível do sistema — é enviado para um terceiro.
 * E nem todo terceiro trata esse texto do mesmo jeito.
 *
 * Níveis gratuitos (Google AI Studio, OpenRouter `:free`) costumam ser
 * gratuitos justamente porque registram os prompts e treinam com eles. Mandar
 * uma consulta para lá é uso secundário de dado sensível de saúde sem base
 * legal — a §10 da documentação exige consentimento específico para isso, e
 * ninguém coleta esse consentimento.
 *
 * A saída NÃO é proibir o nível grátis: ele é perfeito para desenvolver e
 * testar com áudio simulado. A saída é tornar a política **explícita,
 * conferida na partida e gravada em cada nota** — para que a migração para o
 * modelo pago não dependa de alguém lembrar.
 */

/**
 * O que o fornecedor faz com o texto que recebe.
 *
 * - `training`   — pode registrar e treinar. Só para desenvolvimento e teste.
 * - `contractual` — termos de não-treinamento. Único aceitável para paciente real.
 */
export type LlmDataPolicy = "training" | "contractual";

export interface LlmUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export interface LlmCompletion {
  readonly text: string;
  readonly model: string;
  readonly usage: LlmUsage;
  /** Por que o modelo parou. "STOP" é o normal; qualquer outro merece atenção. */
  readonly finishReason: string | null;
}

export interface LlmProvider {
  /** Nome do fornecedor, para log e para a nota gravada. */
  readonly name: string;
  readonly model: string;
  readonly dataPolicy: LlmDataPolicy;
  /** Responde? Usado na partida, para falhar antes de haver job na mão. */
  healthy(): Promise<boolean>;
  complete(prompt: string): Promise<LlmCompletion>;
}

/**
 * A política do fornecedor atende ao que este ambiente aceita?
 *
 * `accepted` é o PISO que o operador tolera, não o que ele tem. Um ambiente
 * que aceita `contractual` recusa um fornecedor `training`; um ambiente de
 * desenvolvimento que aceita `training` aceita os dois — quem tem termos
 * contratuais também serve para testar.
 *
 * Devolve motivo em vez de lançar: quem chama decide se isso derruba a partida
 * (worker) ou vira aviso na tela (interface).
 */
export function checkDataPolicy(
  provider: Pick<LlmProvider, "name" | "dataPolicy">,
  accepted: LlmDataPolicy,
): { allowed: true } | { allowed: false; reason: string } {
  if (accepted === "training") return { allowed: true };
  if (provider.dataPolicy === "contractual") return { allowed: true };

  return {
    allowed: false,
    reason:
      `O fornecedor "${provider.name}" opera sob política \`training\`: os ` +
      `prompts enviados podem ser registrados e usados para treinar. Este ` +
      `ambiente exige \`contractual\`.\n\n` +
      `Transcrição de consulta é dado sensível de saúde (LGPD Art. 11). ` +
      `Enviá-la para um fornecedor que treina com ela é uso secundário sem ` +
      `base legal.\n\n` +
      `Para DESENVOLVER com áudio simulado, defina LLM_DATA_POLICY="training". ` +
      `Para dado real, use um fornecedor com termos de não-treinamento.`,
  };
}

/** Texto curto para marcar visivelmente uma nota gerada no nível grátis. */
export function dataPolicyLabel(policy: LlmDataPolicy): string {
  return policy === "training"
    ? "gerada com modelo de nível gratuito — não use com paciente real"
    : "gerada com modelo sob termos de não-treinamento";
}
