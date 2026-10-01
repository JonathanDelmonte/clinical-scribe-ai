/**
 * Rodar programas sem janela de comando — o pedido explícito: nada de prompt
 * piscando na tela durante a instalação. Toda saída vai para o registro.
 */

import { spawn, type SpawnOptions } from "node:child_process";

import { registrar } from "./registro";

export interface OpcoesDeExecucao {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Cada linha que o programa escreve, à medida que escreve. */
  readonly aoLinha?: (linha: string) => void;
  readonly sinal?: AbortSignal;
}

/** Roda e espera. Devolve o código de saída; a saída vai para o registro. */
export function rodar(
  comando: string,
  argumentos: readonly string[],
  opcoes: OpcoesDeExecucao = {},
): Promise<number> {
  registrar(`executando: ${comando} ${argumentos.join(" ")}`);
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(comando, [...argumentos], {
      cwd: opcoes.cwd,
      env: opcoes.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal: opcoes.sinal,
    } satisfies SpawnOptions);

    const porLinha = (bloco: Buffer, sobra: { texto: string }) => {
      sobra.texto += bloco.toString("utf8");
      const linhas = sobra.texto.split(/\r?\n|\r/);
      sobra.texto = linhas.pop() ?? "";
      for (const linha of linhas) {
        if (linha.trim() === "") continue;
        registrar(`  ${linha}`);
        opcoes.aoLinha?.(linha);
      }
    };
    const sobraSaida = { texto: "" };
    const sobraErro = { texto: "" };
    filho.stdout?.on("data", (bloco: Buffer) => porLinha(bloco, sobraSaida));
    filho.stderr?.on("data", (bloco: Buffer) => porLinha(bloco, sobraErro));
    filho.on("error", rejeitar);
    filho.on("close", (codigo) => {
      for (const sobra of [sobraSaida, sobraErro]) {
        if (sobra.texto.trim() !== "") {
          registrar(`  ${sobra.texto}`);
          opcoes.aoLinha?.(sobra.texto);
        }
      }
      registrar(`terminou com código ${codigo ?? "?"}`);
      resolver(codigo ?? -1);
    });
  });
}

/** Roda e devolve o que o programa escreveu; código diferente de 0 vira erro. */
export async function rodarELer(
  comando: string,
  argumentos: readonly string[],
  opcoes: Omit<OpcoesDeExecucao, "aoLinha"> = {},
): Promise<string> {
  const linhas: string[] = [];
  const codigo = await rodar(comando, argumentos, {
    ...opcoes,
    aoLinha: (linha) => linhas.push(linha),
  });
  if (codigo !== 0) {
    throw new Error(
      `${comando} terminou com código ${codigo}: ${linhas.slice(-5).join(" | ")}`,
    );
  }
  return linhas.join("\n");
}

/** Roda e exige sucesso — o passo de instalação que falha para tudo. */
export async function rodarOuFalhar(
  comando: string,
  argumentos: readonly string[],
  opcoes: OpcoesDeExecucao = {},
): Promise<void> {
  const ultimas: string[] = [];
  const codigo = await rodar(comando, argumentos, {
    ...opcoes,
    aoLinha: (linha) => {
      ultimas.push(linha);
      if (ultimas.length > 8) ultimas.shift();
      opcoes.aoLinha?.(linha);
    },
  });
  if (codigo !== 0) {
    throw new Error(`${comando} terminou com código ${codigo}:\n${ultimas.join("\n")}`);
  }
}
