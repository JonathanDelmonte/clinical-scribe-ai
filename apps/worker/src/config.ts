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

  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),

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
