import pino from "pino";

import { config } from "./config.js";

/**
 * Logger estruturado com redação obrigatória.
 *
 * Log é o vazamento de dado de saúde mais fácil de cometer e mais difícil de
 * perceber: ninguém revisa a saída do stdout, mas ela vai para um agregador,
 * fica meses retida e é lida por qualquer pessoa com acesso ao painel.
 *
 * A regra prática: registre IDs, nunca conteúdo. `sessionId` sim, o texto da
 * transcrição não. As `paths` abaixo são a rede de segurança para quando
 * alguém esquecer a regra — não substituto para segui-la.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      "*.text",
      "*.transcript",
      "*.segments",
      "*.name",
      "*.patientName",
      "*.audioPath",
      "*.content",
      "payload.text",
      "payload.transcript",
      "*.authorization",
      "*.apiKey",
      "*.password",
    ],
    censor: "[REDIGIDO]",
  },
  ...(config.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino/file",
          options: { destination: 1 },
        },
      }
    : {}),
});
