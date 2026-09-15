/**
 * Motor CLOUD — ainda não implementado, e isso é deliberado.
 *
 * O fornecedor comercial só será escolhido no Marco 1, medindo qualidade em
 * pt-BR com áudio real de consultório (ver ADR-0002, pendente). Escrever um
 * adaptador agora significaria escolher o fornecedor por leitura de site —
 * exatamente o que o spike existe para evitar — e jogar fora o trabalho se a
 * medição apontar para outro.
 *
 * Este arquivo falha alto e explica o porquê. É melhor que um adaptador
 * plausível contra um fornecedor que talvez nem seja usado.
 */

import type {
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptionResult,
} from "@scribe/core";

const PENDING =
  "Motor `cloud` ainda não implementado: o fornecedor é decidido no Marco 1 " +
  "(ver docs/PLANO-DE-DESENVOLVIMENTO.md e docs/adr/0002-fornecedor-asr.md). " +
  "Use o motor `local` até lá.";

export class CloudTranscriptionProvider implements TranscriptionProvider {
  readonly engine = "cloud" as const;

  healthy(): Promise<boolean> {
    return Promise.resolve(false);
  }

  transcribe(_input: TranscriptionInput): Promise<TranscriptionResult> {
    return Promise.reject(new Error(PENDING));
  }
}
