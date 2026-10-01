/**
 * O motor de transcrição no computador da pessoa — ligar, vigiar, pausar.
 *
 * É o mesmo motor do Docker (`services/asr-local/app.py`), rodando num Python
 * próprio do ajudante, escondido: sem janela de comando. Duas regras:
 *
 * - **Docker ligado neste computador, ajudante em pausa.** Os dois motores
 *   disputariam a placa de vídeo. A decisão é de `logica/docker.ts`.
 * - **Sem internet para o motor.** Os modelos já estão no disco; o motor roda
 *   com `HF_HUB_OFFLINE`, e a telemetria do pyannote fica desligada. O que o
 *   motor recebe não sai daqui.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { ehNossoMotor, observar, type Vigia } from "../logica/docker";
import { caminhos, PORTA_DO_DOCKER, PORTA_DO_MOTOR, type Caminhos } from "./caminhos";
import { registrar } from "./registro";
import { encerrarArvore, encerrarPeloArquivo, IMAGEM_DO_MOTOR } from "./sistema";

export type EstadoDoMotor = "parado" | "iniciando" | "pronto" | "pausado" | "falhou";

/** O que a instalação decidiu para este computador — gravado em `estado.json`. */
export interface ConfiguracaoDoMotor {
  readonly versao: string;
  readonly dispositivo: "cuda" | "cpu";
  readonly computeType: string;
  readonly instaladoEm: string;
}

export function lerConfiguracao(c: Caminhos = caminhos()): ConfiguracaoDoMotor | null {
  try {
    return JSON.parse(readFileSync(c.estado, "utf8")) as ConfiguracaoDoMotor;
  } catch {
    return null;
  }
}

export function salvarConfiguracao(configuracao: ConfiguracaoDoMotor): void {
  const c = caminhos();
  mkdirSync(c.dados, { recursive: true });
  writeFileSync(c.estado, JSON.stringify(configuracao, null, 2), "utf8");
}

/** Python, motor e modelos no lugar. */
export function motorInstalado(c: Caminhos = caminhos()): boolean {
  return (
    existsSync(c.pythonDoMotor) &&
    existsSync(join(c.codigo, "app.py")) &&
    existsSync(join(c.whisper, "model.bin")) &&
    existsSync(c.configDaSeparacao) &&
    existsSync(join(c.impressaoVocal, "pytorch_model.bin")) &&
    lerConfiguracao(c) !== null
  );
}

export function ambienteDoMotor(
  c: Caminhos,
  conf: ConfiguracaoDoMotor,
): NodeJS.ProcessEnv {
  // A cuDNN e a cuBLAS que o Whisper (ctranslate2) procura vêm junto com o
  // torch; no Windows, só são achadas se a pasta estiver no PATH.
  const bibliotecasDoTorch = join(c.venv, "Lib", "site-packages", "torch", "lib");
  return {
    ...process.env,
    PATH: [bibliotecasDoTorch, join(c.venv, "Scripts"), process.env["PATH"] ?? ""].join(
      ";",
    ),
    HF_HOME: c.modelos,
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    PYANNOTE_METRICS_ENABLED: "false",
    PASTA_TEMPORARIA: c.temp,
    // O motor sai junto se o ajudante for encerrado à força (ver app.py).
    AJUDANTE_PID: String(process.pid),
    // Os modelos pelos caminhos no disco; o motor informa só os nomes (no
    // /health e em cada transcrição) — o caminho tem o usuário do Windows.
    WHISPER_MODEL: c.whisper,
    WHISPER_MODEL_NAME: "large-v3",
    WHISPER_DEVICE: conf.dispositivo,
    WHISPER_COMPUTE_TYPE: conf.computeType,
    WHISPER_LANGUAGE: "pt",
    WHISPER_BEAM_SIZE: "5",
    DIARIZATION_MODEL: c.configDaSeparacao,
    EMBEDDING_MODEL: join(c.impressaoVocal, "pytorch_model.bin"),
    EMBEDDING_MODEL_NAME: "pyannote/wespeaker-voxceleb-resnet34-LM",
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

async function responde(porta: number, esperaMs: number): Promise<unknown> {
  try {
    const res = await fetch(`http://127.0.0.1:${porta}/health`, {
      signal: AbortSignal.timeout(esperaMs),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** O motor do Docker está respondendo neste computador? */
export async function dockerLigado(): Promise<boolean> {
  return ehNossoMotor(await responde(PORTA_DO_DOCKER, 2000));
}

export class Motor extends EventEmitter<{ mudou: [EstadoDoMotor] }> {
  private filho: ChildProcess | null = null;
  private vigia: Vigia = { modo: "rodando", contrarias: 0 };
  private relogio: NodeJS.Timeout | null = null;
  private desligando = false;
  private tentativas = 0;
  /** Uma batida do vigia de cada vez: ligar o motor pode levar minutos. */
  private ocupado = false;
  estado: EstadoDoMotor = "parado";

  private mudar(estado: EstadoDoMotor): void {
    if (estado === this.estado) return;
    this.estado = estado;
    registrar(`motor: ${estado}`);
    this.emit("mudou", estado);
  }

  /** Ligar leva tempo; dois pedidos seguidos não podem ligar dois motores. */
  private ligando = false;

  async iniciar(): Promise<void> {
    if (this.filho !== null || this.ligando) return;
    this.ligando = true;
    try {
      await this.ligar();
    } finally {
      this.ligando = false;
    }
  }

  private async ligar(): Promise<void> {
    const c = caminhos();
    const conf = lerConfiguracao(c);
    if (conf === null) throw new Error("o motor não está instalado");
    // Um motor que sobrou de uma queda do ajudante ainda segura a porta.
    await encerrarPeloArquivo(c.pidDoMotor, IMAGEM_DO_MOTOR);
    mkdirSync(c.temp, { recursive: true });
    mkdirSync(c.logs, { recursive: true });

    this.desligando = false;
    this.mudar("iniciando");
    const saida = createWriteStream(join(c.logs, "motor.log"), { flags: "a" });
    const filho = spawn(
      c.pythonDoMotor,
      [
        "-m",
        "uvicorn",
        "app:app",
        "--host",
        "127.0.0.1",
        "--port",
        String(PORTA_DO_MOTOR),
        "--log-level",
        "warning",
      ],
      {
        cwd: c.codigo,
        env: ambienteDoMotor(c, conf),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.filho = filho;
    filho.stdout?.pipe(saida);
    filho.stderr?.pipe(saida);
    if (filho.pid !== undefined) writeFileSync(c.pidDoMotor, String(filho.pid), "utf8");
    let codigoDeSaida: string | null = null;
    filho.on("exit", (codigo) => {
      // Quedas do Windows vêm como números enormes; em hexadecimal elas são
      // pesquisáveis (0xC0000409, 0xC0000005…).
      codigoDeSaida =
        codigo === null
          ? "?"
          : codigo > 0xffff
            ? `0x${(codigo >>> 0).toString(16).toUpperCase()}`
            : String(codigo);
      registrar(`o processo do motor terminou (código ${codigoDeSaida})`);
      if (this.filho === filho) this.filho = null;
      rmSync(c.pidDoMotor, { force: true });
      if (!this.desligando) this.mudar("falhou");
    });

    // Pronto quando responde. A primeira resposta carrega a separação de vozes
    // (alguns segundos), então a espera é generosa.
    const limite = Date.now() + 180_000;
    while (Date.now() < limite && this.filho === filho) {
      if (ehNossoMotor(await responde(PORTA_DO_MOTOR, 60_000))) {
        this.tentativas = 0;
        this.mudar("pronto");
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    // Parado de propósito no meio da partida — o Docker ligou: não é falha.
    if (this.desligando) return;
    if (codigoDeSaida !== null) {
      throw new Error(
        `o motor fechou ao ligar (código ${codigoDeSaida}) — ver logs/motor.log`,
      );
    }
    await this.parar();
    this.mudar("falhou");
    throw new Error("o motor não respondeu em 3 minutos — ver logs/motor.log");
  }

  async parar(): Promise<void> {
    this.desligando = true;
    const filho = this.filho;
    this.filho = null;
    if (filho?.pid !== undefined) await encerrarArvore(filho.pid);
    rmSync(caminhos().pidDoMotor, { force: true });
    if (this.estado !== "pausado") this.mudar("parado");
  }

  /** O teste que a instalação faz: os três modelos carregam e rodam. */
  async autoteste(): Promise<{ ok: boolean; resumo: string }> {
    const res = await fetch(`http://127.0.0.1:${PORTA_DO_MOTOR}/autoteste`, {
      method: "POST",
      signal: AbortSignal.timeout(280_000),
    });
    const corpo = (await res.json()) as Record<string, unknown>;
    registrar(`autoteste: ${JSON.stringify(corpo)}`);
    const partes = ["transcricao", "separacao_de_vozes", "impressao_vocal"]
      .map((nome) => {
        const parte = corpo[nome] as { ok?: boolean; erro?: string } | undefined;
        return parte?.ok === true ? null : `${nome}: ${parte?.erro ?? "falhou"}`;
      })
      .filter((x): x is string => x !== null);
    return { ok: corpo["ok"] === true, resumo: partes.join("; ") };
  }

  /** A cada 10 s: o Docker ligou? o motor caiu? */
  vigiar(): void {
    if (this.relogio !== null) return;
    const batida = async () => {
      if (this.ocupado) return;
      this.ocupado = true;
      try {
        await this.umaBatida();
      } finally {
        this.ocupado = false;
      }
    };
    void batida();
    this.relogio = setInterval(() => void batida(), 10_000);
  }

  private async umaBatida(): Promise<void> {
    this.vigia = observar(this.vigia, await dockerLigado());
    if (this.vigia.modo === "pausado") {
      if (this.estado !== "pausado") {
        registrar("o motor do Docker está ligado neste computador: ajudante em pausa");
        await this.parar();
        this.mudar("pausado");
      }
      return;
    }
    if (
      this.estado === "pausado" ||
      this.estado === "parado" ||
      this.estado === "falhou"
    ) {
      // Voltou do Docker, ou caiu: liga de novo. Caindo seguido, para depois
      // de três tentativas — um motor que não sobe não melhora sozinho, e
      // tentar em laço só esquenta o computador. A bandeja oferece
      // "Tentar de novo" (`tentarDeNovo`).
      if (this.estado === "falhou" && this.tentativas >= 3) return;
      this.tentativas += this.estado === "falhou" ? 1 : 0;
      await this.iniciar().catch((erro: unknown) =>
        registrar(
          `motor não ligou: ${erro instanceof Error ? erro.message : String(erro)}`,
        ),
      );
    }
  }

  /** O pedido da pessoa, pela bandeja, depois de o motor desistir. */
  async tentarDeNovo(): Promise<void> {
    this.tentativas = 0;
    await this.iniciar().catch((erro: unknown) =>
      registrar(
        `motor não ligou: ${erro instanceof Error ? erro.message : String(erro)}`,
      ),
    );
  }

  pararDeVigiar(): void {
    if (this.relogio !== null) clearInterval(this.relogio);
    this.relogio = null;
  }
}
