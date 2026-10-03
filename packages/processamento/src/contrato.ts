/**
 * O contrato entre o site e o ajudante — o que um manda e o outro responde.
 * Ver ADR-0005.
 *
 * O site conduz as etapas da transcrição (`transcricao.ts`) e manda ao
 * ajudante só o que ele precisa para a parte pesada: links para baixar o
 * áudio e enviar a cópia guardada, e os parâmetros do motor. O ajudante
 * devolve o que o motor respondeu. Nada aqui carrega credencial.
 *
 * Os tipos servem aos dois lados; os esquemas, ao site, que confere tudo o que
 * chega de um computador que não é nosso.
 */

import { z } from "zod";

/** O trabalho que o site entrega ao ajudante. */
export type OrdemDeServico =
  | {
      readonly id: string;
      readonly tipo: "transcrever";
      readonly sessao: string;
      /** Links para baixar o áudio: um arquivo, ou os pedaços em ordem. */
      readonly audio: { readonly nome: string; readonly partes: readonly string[] };
      /**
       * Retomada: faltando pedaço, transcreve-se este arquivo já guardado. O
       * nome vai junto porque é a extensão dele que diz ao motor o formato.
       */
      readonly reserva: { readonly url: string; readonly nome: string } | null;
      /** Quando a sessão precisa de um arquivo novo guardado (ver `Guarda`). */
      readonly guarda: {
        readonly wavDoNavegador: boolean;
        readonly limiteBytes: number;
        /** Links para enviar a cópia, conforme o formato escolhido. */
        readonly envioWav: string;
        readonly envioM4a: string;
        readonly obrigatoria: boolean;
      } | null;
      readonly motor: {
        readonly idioma: string;
        readonly impressaoVocal: readonly number[] | null;
        readonly vocabulario: string | null;
        readonly duracaoMs: number | null;
      };
    }
  | {
      readonly id: string;
      readonly tipo: "voz";
      /** Link para baixar a amostra de voz. */
      readonly amostra: string;
      readonly nome: string;
    };

/** O sinal de vida do ajudante. */
export const esquemaDoSinal = z.object({
  versao: z.string().max(40),
  dispositivo: z.enum(["cuda", "cpu"]),
  /** O motor está ligado e aceita trabalho (e não em pausa pelo Docker). */
  pronto: z.boolean(),
});
export type Sinal = z.infer<typeof esquemaDoSinal>;

/** A cópia que o ajudante guardou (ou nenhuma), antes de transcrever. */
export const esquemaDoAvisoDeAudio = z.object({
  guardado: z
    .object({
      formato: z.enum(["wav", "m4a"]),
      duracaoMs: z.number().int().min(0).nullable(),
    })
    .nullable(),
  usouReserva: z.boolean(),
});
export type AvisoDeAudio = z.infer<typeof esquemaDoAvisoDeAudio>;

export interface RespostaDoAudio {
  /** `false`: a sessão não segue (sem quota) — o job já terminou. */
  readonly seguir: boolean;
}

/** O andamento do motor — e, de quebra, a concessão renovada. */
export const esquemaDoAndamento = z.object({
  percent: z.number().min(0).max(100).optional(),
  fase: z.string().max(80).optional(),
  etaS: z.number().min(0).nullable().optional(),
  previa: z.string().max(500).nullable().optional(),
});
export type Andamento = z.infer<typeof esquemaDoAndamento>;

/** O que o motor respondeu. */
export const esquemaDaEntrega = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("transcricao"),
    /** Conferido à parte, por `lerResultado` — que devolve o tipo exato. */
    resultado: z.unknown(),
    usouReserva: z.boolean(),
  }),
  z.object({
    tipo: z.literal("voz"),
    impressao: z.array(z.number().finite()).length(256),
    duracaoS: z.number().min(0),
  }),
]);
export type Entrega = z.infer<typeof esquemaDaEntrega>;

/**
 * Por que o ajudante não terminou. Cada tipo tem um destino diferente:
 *
 * - `erro`: algo passageiro (motor reiniciando, rede). A fila tenta de novo.
 * - `pedaco_faltando`: um pedaço da gravação não existe — e não havia
 *   reserva. A consulta está incompleta; o site confere e encerra.
 * - `audio_recusado`: o motor recusou o arquivo ao converter (415/413).
 * - `voz_curta`: a amostra de voz não deu para reconhecer.
 */
export const esquemaDaFalha = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("erro"), mensagem: z.string().max(2000) }),
  z.object({ tipo: z.literal("pedaco_faltando"), indice: z.number().int().min(0) }),
  z.object({
    tipo: z.literal("audio_recusado"),
    status: z.union([z.literal(413), z.literal(415)]),
    motivo: z.string().max(500),
  }),
  z.object({ tipo: z.literal("voz_curta") }),
]);
export type Falha = z.infer<typeof esquemaDaFalha>;
