/**
 * O ícone ao lado do relógio — a "setinha" do Windows.
 *
 * Estado sempre em palavras: um ícone sozinho não diz se o ajudante está
 * processando, em pausa por causa do Docker, ou parado.
 */

import { join } from "node:path";

import { Menu, nativeImage, shell, Tray, type NativeImage } from "electron";

import { caminhos, recursos, SITE } from "./caminhos";
import type { EstadoDoMotor, Motor } from "./motor";
import { registrar } from "./registro";
import { iniciaComOWindows, iniciarComOWindows } from "./sistema";

const FRASES: Record<EstadoDoMotor, string> = {
  pronto: "Pronto: as consultas são processadas aqui",
  iniciando: "Ligando o motor",
  pausado: "Em pausa: o Docker está ligado neste computador",
  parado: "Motor desligado",
  falhou: "O motor parou",
};

function iconeOriginal(): NativeImage {
  return nativeImage.createFromPath(join(recursos(), "icones", "icone.png"));
}

function icone(): NativeImage {
  const original = iconeOriginal();
  const imagem = nativeImage.createEmpty();
  for (const escala of [1, 1.5, 2]) {
    const lado = Math.round(16 * escala);
    imagem.addRepresentation({
      scaleFactor: escala,
      width: lado,
      height: lado,
      buffer: original.resize({ width: lado, height: lado, quality: "best" }).toPNG(),
    });
  }
  return imagem;
}

export class Bandeja {
  private readonly tray: Tray;

  constructor(
    private readonly motor: Motor,
    private readonly abrirJanela: () => void,
    private readonly sair: () => void,
  ) {
    this.tray = new Tray(icone());
    this.tray.on("click", () => this.tray.popUpContextMenu());
    motor.on("mudou", () => this.atualizar());
    this.atualizar();
  }

  atualizar(): void {
    const estado = this.motor.estado;
    const exe = caminhos().executavelInstalado;
    this.tray.setToolTip(`Consulta Viva Ajudante\n${FRASES[estado]}`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: FRASES[estado], enabled: false },
        ...(estado === "falhou"
          ? [{ label: "Tentar de novo", click: () => void this.motor.tentarDeNovo() }]
          : []),
        { type: "separator" },
        { label: "Abrir o Consulta Viva", click: () => void shell.openExternal(SITE) },
        { label: "Reinstalar ou desinstalar…", click: () => this.abrirJanela() },
        {
          label: "Iniciar com o Windows",
          type: "checkbox",
          checked: iniciaComOWindows(exe),
          click: (item) => iniciarComOWindows(item.checked, exe),
        },
        { type: "separator" },
        { label: "Sair do ajudante", click: () => this.sair() },
      ]),
    );
  }

  /**
   * Um aviso ao lado do relógio, para quem abriu o ajudante pelo Menu Iniciar:
   * sem janela, é a única resposta visível de que ele ligou (ou já estava).
   */
  avisar(jaEstavaLigado: boolean): void {
    const titulo = jaEstavaLigado
      ? "O ajudante já está ligado"
      : "O ajudante está ligado";
    registrar(`aviso ao lado do relógio: ${titulo}`);
    this.tray.displayBalloon({
      title: titulo,
      content: `${FRASES[this.motor.estado]}. Para ver as opções, clique no ícone ao lado do relógio.`,
      icon: iconeOriginal().resize({ width: 64, height: 64, quality: "best" }),
      noSound: true,
      respectQuietTime: true,
    });
  }

  destruir(): void {
    this.tray.destroy();
  }
}
