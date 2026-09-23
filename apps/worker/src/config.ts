import { z } from "zod";

/**
 * Configuração validada na partida.
 *
 * Falhar aqui, alto e cedo, é muito melhor que descobrir uma variável ausente
 * no meio do processamento de uma consulta — quando já existe áudio de
 * paciente em trânsito e um job pela metade.
 *
 * Dividida em duas partes de propósito. Ferramentas que só transcrevem um
 * arquivo (`pnpm asr:try`) não deveriam exigir banco de dados: configuração
 * obrigatória que a tarefa não usa é fricção que faz a ferramenta parecer
 * quebrada quando está inteira.
 */
const schema = z.object({
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Serviço Whisper + pyannote de `services/asr-local`. Motor do plano grátis. */
  ASR_LOCAL_URL: z.string().url().default("http://localhost:8001"),

  /**
   * Raiz do armazenamento de audio. Precisa ser a MESMA da aplicacao web:
   * a web escreve o arquivo, o worker le. Caminhos divergentes produzem
   * "arquivo nao encontrado" num caminho que nenhum dos dois lados testa
   * sozinho.
   */
  STORAGE_ROOT: z.string().default(".storage"),

  /**
   * Dias de retenção do áudio da consulta. `0` apaga assim que a sessão chega
   * a um estado terminal.
   *
   * Minimização de dado pessoal (LGPD Art. 6º) — e a defesa mais barata que
   * existe, porque dado apagado não vaza. Negativo desliga a varredura, o que
   * é útil em desenvolvimento e **não** deve existir com paciente real.
   */
  AUDIO_RETENTION_DAYS: z.coerce.number().int().default(30),

  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),

  /**
   * Chave do Google AI Studio — https://aistudio.google.com/apikey
   * Nível gratuito, sem cartão. Ver a política de dados logo abaixo.
   */
  GOOGLE_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  /**
   * Nome exato do modelo, nunca um apelido como `gemini-flash-latest`.
   *
   * A tabela `documents` grava `model` em cada nota para que uma regressão de
   * qualidade possa ser investigada depois. Um apelido que aponta sempre para
   * o mais novo transforma esse registro em mentira: duas notas gravadas com o
   * mesmo nome podem ter saído de modelos diferentes.
   *
   * Este padrão envelhece — catálogos mudam e modelos são aposentados. Rode
   * `pnpm llm:models` para ver o que a sua chave acessa hoje.
   */
  LLM_MODEL: z.string().default("gemini-3.8-flash"),

  /**
   * O piso de tratamento de dados que ESTE ambiente aceita.
   *
   * O padrão é `contractual` de propósito, e o padrão é a decisão importante
   * aqui: um ambiente novo — um deploy, a máquina do outro desenvolvedor, o
   * servidor de produção — nasce recusando fornecedor que treina com os
   * prompts. Para usar o nível gratuito é preciso dizer isso em voz alta.
   *
   * O inverso (padrão `training`, "lembrar de trocar antes de produção")
   * funciona até o dia em que ninguém lembra. E o dia em que ninguém lembra é
   * o dia em que consulta de paciente real vira dado de treino de terceiro.
   */
  LLM_DATA_POLICY: z.enum(["training", "contractual"]).default("contractual"),

  /**
   * Manda o vocabulário da especialidade para o Whisper. DESLIGADO — medido.
   *
   * Transcrevendo a mesma consulta real, sem vocabulário, duas vezes: 1.000 de
   * semelhança, zero diferenças. Com vocabulário: 0.674 (25 termos) e 0.716
   * (3 termos). Corrigiu um erro conhecido e, em troca, apagou "churrasco" e
   * "Sou médico", inventou "xarope", entrou em laço repetindo "emagrecimento"
   * e fabricou "me sinto inútil" — nada disso foi dito. Com três termos, perdeu
   * "eletrocardiograma", que saía certo SEM ajuda.
   *
   * O motivo é o mecanismo, não o tamanho da lista: `hotwords` ocupa o espaço
   * de "texto anterior" em cada janela, o que equivale a um
   * `condition_on_previous_text` com contexto falso — exatamente o que foi
   * desligado por truncar e alucinar. Ver ADR-0002.
   *
   * Fica como chave, e não apagado, para que alguém possa repetir a medição
   * com uma versão nova do modelo sem mexer em código.
   */
  ASR_VOCABULARY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /** Opcional aqui; obrigatório no worker — ver `requireDatabaseUrl()`. */
  DATABASE_URL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Configuração inválida:\n${issues}`);
}

export const config = parsed.data;

/**
 * Exige `DATABASE_URL` no ponto em que ela é de fato necessária.
 *
 * O worker não roda sem banco; a CLI de transcrição roda. Cobrar no lugar
 * certo é a diferença entre um erro que ensina e um que só atrapalha.
 */
export function requireDatabaseUrl(): string {
  const url = config.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL não definida. Copie .env.example para .env e preencha, " +
        "ou suba o banco local com `pnpm db:up`.",
    );
  }
  return url;
}
