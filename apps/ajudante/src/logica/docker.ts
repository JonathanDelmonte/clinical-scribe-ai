/**
 * O ajudante e o Docker no mesmo computador: um ou outro, nunca os dois.
 *
 * Os dois motores disputariam a mesma placa de vídeo, e o Docker é a estação
 * de quem opera o sistema — quando ele liga, o ajudante entra em pausa; quando
 * ele desliga, o ajudante volta. A decisão pede duas observações seguidas
 * iguais antes de mudar, para um Docker reiniciando não fazer o ajudante ligar
 * e desligar o motor (que leva segundos para carregar) a cada batida.
 */

export type ModoDoMotor = "rodando" | "pausado";

export interface Vigia {
  readonly modo: ModoDoMotor;
  /** Quantas observações seguidas contradizem o modo atual. */
  readonly contrarias: number;
}

export const OBSERVACOES_PARA_MUDAR = 2;

export function observar(vigia: Vigia, dockerLigado: boolean): Vigia {
  const contradiz =
    (vigia.modo === "rodando" && dockerLigado) ||
    (vigia.modo === "pausado" && !dockerLigado);
  if (!contradiz) return { modo: vigia.modo, contrarias: 0 };

  const contrarias = vigia.contrarias + 1;
  if (contrarias < OBSERVACOES_PARA_MUDAR) return { modo: vigia.modo, contrarias };
  return { modo: dockerLigado ? "pausado" : "rodando", contrarias: 0 };
}

/**
 * A resposta de `/health` é a do NOSSO motor? Qualquer coisa pode estar na
 * porta 8001 de um computador; só pausamos pelo motor do Consulta Viva.
 */
export function ehNossoMotor(corpo: unknown): boolean {
  return (
    typeof corpo === "object" &&
    corpo !== null &&
    "engine" in corpo &&
    (corpo as { engine: unknown }).engine === "local" &&
    "model" in corpo
  );
}
