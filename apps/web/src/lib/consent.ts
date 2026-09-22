/**
 * O registro de ciência da gravação.
 *
 * ## Por que o texto é versionado e copiado para dentro da sessão
 *
 * A base legal do tratamento é a tutela da saúde (LGPD Art. 11, II, "f") — o
 * profissional documenta a consulta independentemente de consentimento. O que
 * é obrigatório é a **transparência**: o paciente precisa saber que está sendo
 * gravado (§10 da documentação).
 *
 * Guardar só "aceitou às 14h03" atende a metade disso. A pergunta que aparece
 * depois, se aparecer, é **com o que exatamente a pessoa concordou** — e o
 * texto da tela muda com o tempo, enquanto o que foi dito naquela consulta
 * não. Por isso cada sessão guarda uma cópia, e não um ponteiro para a versão
 * vigente.
 *
 * O `slug` da versão vai junto no texto para que uma cópia solta, num export
 * ou num relatório, ainda diga de onde veio.
 */

export const CONSENT_VERSION = "v1";

export const CONSENT_METHODS = [
  "verbal-in-person",
  "verbal-telehealth",
  "written",
] as const;

export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const CONSENT_METHOD_LABEL: Record<ConsentMethod, string> = {
  "verbal-in-person": "verbalmente, presencialmente",
  "verbal-telehealth": "verbalmente, por teleconsulta",
  written: "por escrito",
};

const TEXTOS: Record<ConsentMethod, string> = {
  "verbal-in-person":
    "O paciente foi informado presencialmente de que esta consulta será " +
    "gravada para produzir a documentação clínica, e concordou verbalmente. " +
    "A gravação é usada apenas para essa finalidade.",
  "verbal-telehealth":
    "O paciente foi informado, no início da teleconsulta, de que ela será " +
    "gravada para produzir a documentação clínica, e concordou verbalmente. " +
    "A gravação é usada apenas para essa finalidade.",
  written:
    "O paciente assinou termo de ciência de que esta consulta será gravada " +
    "para produzir a documentação clínica. A gravação é usada apenas para " +
    "essa finalidade.",
};

export function ehMetodoDeConsentimento(valor: unknown): valor is ConsentMethod {
  return (
    typeof valor === "string" && (CONSENT_METHODS as readonly string[]).includes(valor)
  );
}

/** O texto que fica gravado na sessão, com a versão embutida. */
export function textoDoConsentimento(metodo: ConsentMethod): string {
  return `[${CONSENT_VERSION}] ${TEXTOS[metodo]}`;
}

/** O texto que a tela mostra antes de habilitar a gravação. */
export function textoParaExibicao(metodo: ConsentMethod): string {
  return TEXTOS[metodo];
}
