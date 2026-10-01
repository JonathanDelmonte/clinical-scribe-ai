/**
 * Consulta Viva Ajudante — o processo principal.
 *
 * Um executável, quatro jeitos de abrir:
 *
 * - **o arquivo baixado** (de qualquer pasta): abre a tela de escolha —
 *   Instalar, Reinstalar (reparar), Desinstalar — antes de fazer qualquer coisa;
 * - **instalado, pelo Menu Iniciar** (sem argumentos): liga na bandeja e avisa
 *   ao lado do relógio — ou só avisa, se já estava ligado;
 * - **instalado, com `--bandeja`** (ao ligar o Windows): só o ícone ao lado do
 *   relógio, com o motor, sem aviso;
 * - **instalado, com `--desinstalar`** (Configurações → Aplicativos): a tela
 *   abre direto na confirmação de desinstalar.
 *
 * O programa instalado roda uma cópia só; abri-lo de novo fala com a cópia que
 * já está rodando.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";

import type { ModoDaInstalacao, Resultado, Situacao } from "../compartilhado";
import { Bandeja } from "./bandeja";
import { caminhos, ID_DO_APLICATIVO } from "./caminhos";
import {
  apagarDepoisDeSair,
  desinstalar,
  ErroDeInstalacao,
  instalar,
  rodandoDoLugarInstalado,
  situacaoDaMaquina,
} from "./instalacao";
import { lerConfiguracao, Motor, motorInstalado } from "./motor";
import { registrar, ultimasLinhas } from "./registro";

const argumentos = process.argv.slice(1);
const naBandeja = argumentos.includes("--bandeja");
const paraDesinstalar = argumentos.includes("--desinstalar");
const instalado = rodandoDoLugarInstalado();
// Instalado, o ajudante mora na bandeja — menos quando abre para desinstalar.
// Em desenvolvimento, só com --bandeja; sem ele, a janela do instalador.
const moraNaBandeja = instalado ? !paraDesinstalar : naBandeja;

app.setAppUserModelId(ID_DO_APLICATIVO);

let janela: BrowserWindow | null = null;
let bandeja: Bandeja | null = null;
let motor: Motor | null = null;
let trabalhando = false;
/** Desinstalado de dentro da própria pasta: ela é apagada na saída. */
let apagarAoSair = false;
let abertaPara: Situacao["abertaPara"] = paraDesinstalar ? "desinstalar" : "escolher";

// O instalado (e o de desenvolvimento) roda uma cópia só. O arquivo baixado,
// não: ele precisa poder reinstalar POR CIMA de uma cópia que está rodando —
// a instalação a encerra antes de copiar.
const copiaUnica = instalado || !app.isPackaged;
const ehAPrimeira = !copiaUnica || app.requestSingleInstanceLock();
if (!ehAPrimeira) {
  // A cópia que já roda recebe estes argumentos (second-instance) e responde.
  // Esta sai sem tocar em nada — nem no arquivo de PID, que é da outra.
  app.quit();
} else if (copiaUnica) {
  app.on("second-instance", (_evento, argumentosNovos) => {
    if (argumentosNovos.includes("--desinstalar")) abrirJanela("desinstalar");
    else if (argumentosNovos.includes("--bandeja")) return;
    else if (bandeja !== null) bandeja.avisar(true);
    else abrirJanela("escolher");
  });
}

function abrirJanela(para: Situacao["abertaPara"] = "escolher"): void {
  abertaPara = para;
  if (janela !== null) {
    if (janela.isMinimized()) janela.restore();
    janela.show();
    janela.focus();
    // Recarrega a situação — a não ser que haja uma instalação no meio.
    if (!trabalhando) janela.webContents.reload();
    return;
  }
  janela = new BrowserWindow({
    width: 760,
    height: 640,
    resizable: false,
    maximizable: false,
    show: false,
    title: "Consulta Viva Ajudante",
    backgroundColor: "#F2F5F6",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#F2F5F6", symbolColor: "#0F1B24", height: 40 },
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  janela.setMenu(null);
  void janela.loadFile(join(__dirname, "ui", "index.html"));
  janela.once("ready-to-show", () => {
    janela?.show();
    // Teste automatizado: com AJUDANTE_ACAO, a ação começa como se a pessoa
    // tivesse escolhido e clicado. Quem usa o ajudante nunca define isso.
    const acao = process.env["AJUDANTE_ACAO"];
    if (acao === "instalar" || acao === "reinstalar" || acao === "desinstalar") {
      registrar(`teste automatizado: ${acao}`);
      janela?.webContents.send("pedido", acao);
    }
  });
  janela.on("close", (evento) => {
    if (!trabalhando || janela === null) return;
    evento.preventDefault();
    void dialog.showMessageBox(janela, {
      type: "info",
      title: "Consulta Viva Ajudante",
      message: "A instalação está em andamento.",
      detail: "Espere terminar: fechar agora deixaria o motor pela metade.",
    });
  });
  janela.on("closed", () => {
    janela = null;
  });
}

function iniciarBandeja(): void {
  if (bandeja !== null || !motorInstalado()) return;
  motor ??= new Motor();
  bandeja = new Bandeja(
    motor,
    () => abrirJanela("escolher"),
    () => app.quit(),
  );
  motor.vigiar();
}

async function situacao(): Promise<Situacao> {
  const { plano, livre, necessario } = await situacaoDaMaquina();
  const conf = lerConfiguracao();
  return {
    instalado: conf !== null,
    versaoInstalada: conf?.versao ?? null,
    versaoDestePrograma: app.getVersion(),
    motorPronto: motorInstalado(),
    placa: { dispositivo: plano.dispositivo, explicacao: plano.explicacao },
    espacoLivre: livre,
    espacoNecessario: necessario,
    abertaPara,
  };
}

function falha(erro: unknown): Resultado {
  registrar(
    `ERRO: ${erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}`,
  );
  return {
    ok: false,
    mensagem:
      erro instanceof ErroDeInstalacao
        ? erro.message
        : "Algo saiu diferente do esperado durante a instalação.",
    detalhes: ultimasLinhas(),
  };
}

ipcMain.handle("situacao", () => situacao());

ipcMain.handle(
  "instalar",
  async (_evento, modo: ModoDaInstalacao): Promise<Resultado> => {
    trabalhando = true;
    try {
      // A bandeja desta cópia (se houver) solta o motor e o ícone: a instalação
      // vai recriar o ambiente debaixo deles.
      motor?.pararDeVigiar();
      bandeja?.destruir();
      bandeja = null;
      await instalar(modo, (p) => janela?.webContents.send("progresso", p), motor);
      return { ok: true };
    } catch (erro) {
      return falha(erro);
    } finally {
      trabalhando = false;
    }
  },
);

ipcMain.handle("desinstalar", async (): Promise<Resultado> => {
  trabalhando = true;
  try {
    bandeja?.destruir();
    bandeja = null;
    apagarAoSair = await desinstalar(
      (p) => janela?.webContents.send("progresso", p),
      motor,
    );
    motor = null;
    return { ok: true };
  } catch (erro) {
    return falha(erro);
  } finally {
    trabalhando = false;
  }
});

ipcMain.on("concluir", () => {
  if (app.isPackaged && !instalado) {
    // O arquivo baixado terminou o trabalho: quem fica na bandeja é o
    // programa instalado, que liga sozinho e independente deste — e, aberto
    // sem argumentos, avisa ao lado do relógio que está ligado.
    spawn(caminhos().executavelInstalado, [], {
      detached: true,
      stdio: "ignore",
    }).unref();
    app.quit();
    return;
  }
  janela?.close();
  iniciarBandeja();
  bandeja?.avisar(false);
});

ipcMain.on("sair", () => app.quit());
ipcMain.on("copiar", (_evento, texto: string) => clipboard.writeText(texto));

app.whenReady().then(() => {
  if (!ehAPrimeira) return;
  registrar(
    `ajudante v${app.getVersion()} aberto (${instalado ? "instalado" : "instalador"}` +
      `${naBandeja ? ", bandeja" : ""}${paraDesinstalar ? ", para desinstalar" : ""})`,
  );
  if (instalado) {
    const c = caminhos();
    mkdirSync(c.dados, { recursive: true });
    writeFileSync(c.pidDoAjudante, String(process.pid), "utf8");
  }
  if (moraNaBandeja && motorInstalado()) {
    iniciarBandeja();
    // Aberto pelo Menu Iniciar não há janela: o aviso é a resposta visível.
    if (!naBandeja) bandeja?.avisar(false);
    return;
  }
  // O arquivo baixado; o instalado aberto para desinstalar; ou um instalado
  // sem motor (instalação interrompida) — a janela, para escolher ou reparar.
  abrirJanela(abertaPara);
});

// Sem bandeja (o instalador), fechar a janela encerra o programa; com ela,
// o ajudante continua ao lado do relógio.
app.on("window-all-closed", () => {
  if (bandeja === null) app.quit();
});

// No Windows, um processo filho não morre junto com o pai: sair sem esperar
// o motor parar deixaria um Python órfão segurando a porta e a placa de vídeo.
let saindo = false;
app.on("before-quit", (evento) => {
  if (saindo || !ehAPrimeira) return;
  saindo = true;
  if (instalado) rmSync(caminhos().pidDoAjudante, { force: true });
  if (motor === null) return;
  evento.preventDefault();
  motor.pararDeVigiar();
  void motor.parar().finally(() => app.quit());
});

app.on("will-quit", () => {
  if (apagarAoSair) apagarDepoisDeSair(caminhos().programa);
});
