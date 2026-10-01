/**
 * Instalar, reinstalar (reparar) e desinstalar.
 *
 * O ajudante é um programa pequeno que instala um grande: o motor de
 * transcrição (Python, torch, Whisper, pyannote) e os modelos de voz — uns
 * 9 GB que o navegador não comporta. Tudo fica em pastas do usuário, e cada
 * etapa avisa a tela do seu progresso.
 *
 * Reinstalar é instalar por cima: recria o ambiente do motor (do cache, sem
 * baixar de novo o que já veio), confere os modelos, testa o motor. É também
 * como uma versão nova do ajudante entra.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, rmdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { app } from "electron";
// O Electron faz o `fs` enxergar arquivos .asar como pastas. A pasta do
// programa tem um (resources\app.asar), e copiá-la ou apagá-la pelo `fs`
// comum falha com "Invalid package". O `original-fs` é o do Node, sem isso.
import { promises as fsDoPrograma } from "original-fs";

import type { ModoDaInstalacao, Progresso } from "../compartilhado";
import { percentual, rotuloDe, tamanhoLegivel, type IdDaEtapa } from "../logica/etapas";
import { espacoNecessario, planejarMotor, type PlanoDoMotor } from "../logica/maquina";
import { caminhos, recursos } from "./caminhos";
import { Motor, salvarConfiguracao } from "./motor";
import { rodarOuFalhar } from "./processo";
import { pararDeGravar, registrar } from "./registro";
import {
  criarAtalho,
  detectarPlacas,
  encerrarPeloArquivo,
  espacoLivre,
  IMAGEM_DO_AJUDANTE,
  IMAGEM_DO_MOTOR,
  iniciarComOWindows,
  registrarNaListaDeProgramas,
  removerAtalho,
  removerDaListaDeProgramas,
} from "./sistema";

/** Erro que a pessoa lê como está — sem pilha, sem jargão. */
export class ErroDeInstalacao extends Error {
  override readonly name = "ErroDeInstalacao";
}

type Aviso = (progresso: Progresso) => void;

function avisador(aviso: Aviso) {
  return (etapa: IdDaEtapa, fracao: number, detalhe = "") =>
    aviso({
      etapa,
      rotulo: rotuloDe(etapa),
      percentual: percentual(etapa, fracao),
      detalhe,
    });
}

/** Tamanho de uma pasta, somando os arquivos — para a barra do download. */
async function tamanhoDaPasta(pasta: string): Promise<number> {
  let total = 0;
  let entradas;
  try {
    entradas = await readdir(pasta, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entrada of entradas) {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) total += await tamanhoDaPasta(caminho);
    else if (entrada.isFile())
      total += (await stat(caminho).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/**
 * O `python.exe` que o uv instalou, pelo caminho real — a pasta com o número
 * completo da versão (cpython-3.10.21-…), nunca o atalho de versão
 * (cpython-3.10-…). Havendo mais de uma, a de correção mais nova.
 */
async function pythonInstalado(pasta: string): Promise<string | null> {
  const nomes = await readdir(pasta).catch(() => [] as string[]);
  const candidatos = nomes
    .map((nome) => ({
      nome,
      correcao: /^cpython-3\.10\.(\d+)-windows-x86_64-none$/.exec(nome)?.[1],
    }))
    .filter((c): c is { nome: string; correcao: string } => c.correcao !== undefined)
    .sort((a, b) => Number(b.correcao) - Number(a.correcao));
  for (const { nome } of candidatos) {
    const executavel = join(pasta, nome, "python.exe");
    if (existsSync(executavel)) return executavel;
  }
  return null;
}

/** A pasta de onde ESTE executável roda — a do instalador, ou a do programa instalado. */
function pastaDesteExecutavel(): string {
  return resolve(dirname(process.execPath));
}

export function rodandoDoLugarInstalado(): boolean {
  return app.isPackaged && pastaDesteExecutavel() === resolve(caminhos().programa);
}

export async function situacaoDaMaquina(): Promise<{
  plano: PlanoDoMotor;
  livre: number;
  necessario: number;
}> {
  const plano = planejarMotor(await detectarPlacas());
  const c = caminhos();
  return {
    plano,
    livre: await espacoLivre(c.dados),
    necessario: espacoNecessario(plano),
  };
}

export async function instalar(
  modo: ModoDaInstalacao,
  aviso: Aviso,
  motorDestaInstancia: Motor | null,
): Promise<void> {
  const etapa = avisador(aviso);
  const c = caminhos();
  const r = recursos();
  const versao = app.getVersion();
  registrar(`=== ${modo} v${versao} (de ${pastaDesteExecutavel()})`);

  // ---- conferir ------------------------------------------------------------
  etapa("conferir", 0, "Olhando a placa de vídeo e o espaço em disco");
  const { plano, livre, necessario } = await situacaoDaMaquina();
  registrar(
    `plano: ${JSON.stringify(plano)}; livre ${livre}; necessário ${necessario}`,
  );
  if (livre < necessario) {
    throw new ErroDeInstalacao(
      `Falta espaço no disco: a instalação precisa de ${tamanhoLegivel(necessario)} ` +
        `livres, e há ${tamanhoLegivel(livre)}. Libere espaço e tente de novo.`,
    );
  }
  etapa("conferir", 1, plano.explicacao);

  // ---- programa ------------------------------------------------------------
  etapa("programa", 0, "Fechando o ajudante que estava aberto");
  await motorDestaInstancia?.parar();
  await encerrarPeloArquivo(c.pidDoAjudante, IMAGEM_DO_AJUDANTE);
  await encerrarPeloArquivo(c.pidDoMotor, IMAGEM_DO_MOTOR);
  if (app.isPackaged && !rodandoDoLugarInstalado()) {
    etapa("programa", 0.3, "Copiando o programa");
    await fsDoPrograma.rm(c.programa, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 500,
    });
    await fsDoPrograma.cp(pastaDesteExecutavel(), c.programa, { recursive: true });
  }
  etapa("programa", 1);

  // ---- python --------------------------------------------------------------
  const uv = join(r, "uv", "uv.exe");
  const ambiente: NodeJS.ProcessEnv = {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: c.python,
    UV_CACHE_DIR: c.cache,
    UV_NO_PROGRESS: "1",
    // O cache guarda o torch para reparar sem baixar de novo; o ambiente do
    // motor aponta para os mesmos arquivos (hardlinks), em vez de copiá-los.
    // Copiando, eram duas cópias do torch: 13 GB no disco em vez de 8. Se o
    // disco não aceitar hardlinks, o uv copia sozinho.
    UV_LINK_MODE: "hardlink",
    UV_PYTHON_PREFERENCE: "only-managed",
  };
  etapa("python", 0.1, "Baixando o Python");
  // Um Python SÓ do ajudante. Por padrão o uv também põe um `python3.10.exe`
  // na pasta global do usuário (~/.local/bin) e registra o Python no
  // Windows — e a primeira versão desta instalação fez isso no computador de
  // quem testou. O ajudante não mexe em nada fora das pastas dele.
  try {
    await rodarOuFalhar(
      uv,
      ["python", "install", "3.10", "--no-bin", "--no-registry"],
      {
        env: ambiente,
      },
    );
  } catch (erro) {
    // Depois de pôr o Python no lugar, o uv cria um atalho de versão
    // (cpython-3.10 -> cpython-3.10.21), que é uma junção do Windows. Há
    // ambientes em que junções não se resolvem — pastas virtualizadas de
    // programas empacotados, alguns antivírus — e o uv acusa erro com o
    // Python já inteiro. O ajudante não usa o atalho: segue pelo caminho real.
    if (
      !/minor version link/i.test(String(erro)) ||
      (await pythonInstalado(c.python)) === null
    ) {
      throw erro;
    }
    registrar(
      "aviso: o atalho de versão do Python não se resolve aqui; seguindo pelo caminho real",
    );
  }
  const python = await pythonInstalado(c.python);
  if (python === null) {
    throw new Error(`o uv terminou sem erro, mas não há Python 3.10 em ${c.python}`);
  }
  if (modo === "reinstalar") {
    etapa("python", 0.5, "Apagando o ambiente antigo");
    await rm(c.venv, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
  etapa("python", 0.7, "Criando o ambiente do motor");
  if (!existsSync(c.pythonDoMotor)) {
    await rodarOuFalhar(uv, ["venv", c.venv, "--python", python], { env: ambiente });
  }
  etapa("python", 1);

  // ---- motor ---------------------------------------------------------------
  // O progresso do download é o crescimento do cache do uv: ele não mostra
  // barra quando não há terminal, e é no cache que o que chega é guardado.
  const antes = await tamanhoDaPasta(c.cache);
  let medindo = false;
  const relogio = setInterval(() => {
    if (medindo) return;
    medindo = true;
    void tamanhoDaPasta(c.cache)
      .then((agora) => {
        const baixado = Math.max(0, agora - antes);
        etapa(
          "motor",
          Math.min(0.92, baixado / plano.bytesDoMotor),
          `${tamanhoLegivel(baixado)} de cerca de ${tamanhoLegivel(plano.bytesDoMotor)}`,
        );
      })
      .finally(() => {
        medindo = false;
      });
  }, 2000);
  try {
    etapa(
      "motor",
      0,
      plano.dispositivo === "cuda"
        ? "Motor para placa de vídeo"
        : "Motor para processador",
    );
    await rodarOuFalhar(
      uv,
      [
        "pip",
        "install",
        "--python",
        c.pythonDoMotor,
        "torch==2.5.1",
        "torchaudio==2.5.1",
        "--index-url",
        plano.indiceDoTorch,
      ],
      { env: ambiente },
    );
    await rodarOuFalhar(
      uv,
      [
        "pip",
        "install",
        "--python",
        c.pythonDoMotor,
        "-r",
        join(r, "motor", "requirements.txt"),
      ],
      { env: ambiente },
    );
  } finally {
    clearInterval(relogio);
  }
  if (plano.dispositivo === "cuda") {
    // O ctranslate2 (o Whisper) traz só a peça de entrada da cuDNN, na 9.10, e
    // a carrega ao ser importado; o torch traz a cuDNN inteira, na 9.1. No
    // mesmo processo, a peça 9.10 procura nas bibliotecas 9.1 uma função que
    // elas não têm, e o motor cai ao usar a placa ("Could not load symbol
    // cudnnGetLibConfig"). Fica uma versão só, a do torch, como no Docker.
    // Apaga antes de copiar: o arquivo é um hardlink para o cache, e escrever
    // por cima dele mudaria também a cópia guardada lá.
    const pacotes = join(c.venv, "Lib", "site-packages");
    const destino = join(pacotes, "ctranslate2", "cudnn64_9.dll");
    await rm(destino, { force: true });
    await copyFile(join(pacotes, "torch", "lib", "cudnn64_9.dll"), destino);
  }
  await mkdir(c.codigo, { recursive: true });
  for (const arquivo of ["app.py", "canais.py"]) {
    await copyFile(join(r, "motor", arquivo), join(c.codigo, arquivo));
  }
  etapa("motor", 1);

  // ---- modelos -------------------------------------------------------------
  etapa("modelos", 0, "Começando o download");
  await rodarOuFalhar(
    c.pythonDoMotor,
    [
      join(r, "motor", "preparar_modelos.py"),
      ["--levado", join(r, "modelos", "pyannote")],
      ["--separacao", c.separacao],
      ["--whisper", c.whisper],
      ["--impressao", c.impressaoVocal],
    ].flat(),
    {
      env: {
        ...process.env,
        HF_HOME: c.modelos,
        HF_HUB_DISABLE_TELEMETRY: "1",
        PYTHONIOENCODING: "utf-8",
      },
      aoLinha: (linha) => {
        try {
          const p = JSON.parse(linha) as { baixado?: number; total?: number };
          if (
            typeof p.baixado === "number" &&
            typeof p.total === "number" &&
            p.total > 0
          ) {
            etapa(
              "modelos",
              p.baixado / p.total,
              `${tamanhoLegivel(p.baixado)} de ${tamanhoLegivel(p.total)}`,
            );
          }
        } catch {
          // linha de texto comum: vai só para o registro
        }
      },
    },
  );
  etapa("modelos", 1);

  // ---- testar --------------------------------------------------------------
  salvarConfiguracao({
    versao,
    dispositivo: plano.dispositivo,
    computeType: plano.computeType,
    instaladoEm: new Date().toISOString(),
  });
  // O tamanho da instalação, para Configurações → Aplicativos, é medido
  // enquanto o motor liga e se testa: são dezenas de milhares de arquivos, e
  // medir no fim deixava a tela parada uns 15 segundos. O cache fica de fora:
  // os arquivos dele são os mesmos do ambiente do motor (hardlinks).
  const medida = app.isPackaged
    ? Promise.all(
        [c.python, c.venv, c.codigo, c.modelos, c.programa].map(tamanhoDaPasta),
      ).then((partes) => partes.reduce((soma, parte) => soma + parte, 0))
    : Promise.resolve(0);
  etapa("testar", 0.1, "Ligando o motor");
  const motor = new Motor();
  try {
    await motor.iniciar();
    etapa(
      "testar",
      0.4,
      plano.dispositivo === "cuda"
        ? "Carregando os modelos na placa de vídeo"
        : "Carregando os modelos",
    );
    const teste = await motor.autoteste();
    if (!teste.ok) {
      throw new ErroDeInstalacao(
        `O motor foi instalado, mas não passou no teste (${teste.resumo}).`,
      );
    }
  } finally {
    await motor.parar();
  }
  etapa("testar", 1, "Os três modelos carregaram e responderam");

  // ---- concluir ------------------------------------------------------------
  etapa("concluir", 0.2, "Atalho, lista de programas e início com o Windows");
  if (app.isPackaged) {
    const exe = c.executavelInstalado;
    criarAtalho(exe);
    await registrarNaListaDeProgramas(
      exe,
      c.programa,
      versao,
      Math.round((await medida) / 1024),
    );
    iniciarComOWindows(true, exe);
  } else {
    registrar(
      "modo de desenvolvimento: sem atalho, sem lista de programas, sem início com o Windows",
    );
  }
  etapa("concluir", 1, "Pronto");
  registrar(`=== ${modo}: concluído`);
}

/**
 * Remove tudo: programa, motor, modelos, atalho, início com o Windows e a
 * entrada em Aplicativos. Devolve `true` quando a pasta do programa só pode
 * sair depois de este processo terminar — ele está rodando de dentro dela, e
 * quem chama agenda a limpeza para a saída (`apagarDepoisDeSair`).
 */
export async function desinstalar(
  aviso: Aviso,
  motorDestaInstancia: Motor | null,
): Promise<boolean> {
  const c = caminhos();
  const informar = (fracao: number, detalhe: string) =>
    aviso({
      etapa: "concluir",
      rotulo: "Desinstalando",
      percentual: Math.round(fracao * 100),
      detalhe,
    });
  registrar("=== desinstalar");

  informar(0.1, "Fechando o ajudante e o motor");
  motorDestaInstancia?.pararDeVigiar();
  await motorDestaInstancia?.parar();
  await encerrarPeloArquivo(c.pidDoAjudante, IMAGEM_DO_AJUDANTE);
  await encerrarPeloArquivo(c.pidDoMotor, IMAGEM_DO_MOTOR);

  informar(0.3, "Tirando do início do Windows e da lista de programas");
  if (app.isPackaged) {
    iniciarComOWindows(false, c.executavelInstalado);
    removerAtalho();
    await removerDaListaDeProgramas();
  }

  informar(0.5, "Apagando o motor e os modelos");
  registrar("=== desinstalar: apagando os dados (o registro termina aqui)");
  pararDeGravar();
  await rm(c.dados, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  // A pasta "ConsultaViva" sai junto, se ficou vazia.
  await rmdir(dirname(c.dados)).catch(() => undefined);

  informar(0.9, "Apagando o programa");
  const daquiDeDentro = rodandoDoLugarInstalado();
  if (!daquiDeDentro) {
    await fsDoPrograma.rm(c.programa, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500,
    });
  }
  informar(1, "Pronto");
  return daquiDeDentro;
}

/**
 * Apaga a pasta do programa depois que este processo sair: um programa não
 * apaga a própria pasta enquanto roda. Chamado na saída — não ao fim da
 * desinstalação, quando a pessoa ainda pode ficar minutos na tela final.
 * Um comando à parte, sem janela, espera e apaga; e tenta de novo, porque os
 * processos auxiliares do Electron saem um pouco depois do principal.
 */
export function apagarDepoisDeSair(pasta: string): void {
  const esperar = "ping 127.0.0.1 -n 4 >nul";
  const apagar = `rmdir /s /q "${pasta}" 2>nul`;
  // /s /c "…" com os argumentos como estão: o jeito que o próprio Node chama o
  // cmd. Sem isso, as aspas do caminho chegam escapadas com barra, que o cmd
  // não entende.
  spawn(
    "cmd.exe",
    ["/d", "/s", "/c", `"${esperar} & ${apagar} & ${esperar} & ${apagar}"`],
    {
      detached: true,
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: "ignore",
    },
  ).unref();
}
