/**
 * O laço do ajudante: dar sinal ao site e pegar trabalho. Ver ADR-0005.
 *
 * A cada 15 segundos o ajudante diz ao site que está vivo, e se o motor está
 * PRONTO — em pausa (o Docker ligado neste computador) ou ainda ligando, ele
 * não pega nada, e a estação segue processando as consultas desta pessoa.
 * Pronto, ele pega os trabalhos da pessoa um de cada vez, até a fila dela
 * esvaziar.
 */

import { EventEmitter } from "node:events";

import { app } from "electron";

import { esquecerConta, lerConta } from "./conta";
import { executar } from "./executar";
import { lerConfiguracao, type Motor } from "./motor";
import { registrar } from "./registro";
import { criarSite, Desconectado } from "./site";

export type EstadoDoTrabalho =
  "desconectado" | "esperando" | "processando" | "sem_site";

export class Trabalho extends EventEmitter<{ mudou: [EstadoDoTrabalho] }> {
  estado: EstadoDoTrabalho = lerConta() === null ? "desconectado" : "esperando";
  /** De quem é a conta conectada — o site confirma a cada sinal. */
  profissional: string | null = lerConta()?.profissional ?? null;
  private relogio: NodeJS.Timeout | null = null;
  private ocupado = false;

  constructor(private readonly motor: Motor) {
    super();
    // O motor ficou pronto: não espera o próximo sinal para avisar o site.
    motor.on("mudou", (estado) => {
      if (estado === "pronto" || estado === "pausado") void this.batida();
    });
  }

  private mudar(estado: EstadoDoTrabalho): void {
    if (estado === this.estado) return;
    this.estado = estado;
    registrar(`trabalho: ${estado}`);
    this.emit("mudou", estado);
  }

  iniciar(): void {
    if (this.relogio !== null) return;
    void this.batida();
    this.relogio = setInterval(() => void this.batida(), 15_000);
  }

  parar(): void {
    if (this.relogio !== null) clearInterval(this.relogio);
    this.relogio = null;
  }

  /** A conta acabou de ser conectada: começa já. */
  conectado(): void {
    this.profissional = lerConta()?.profissional ?? null;
    this.mudar("esperando");
    void this.batida();
  }

  /** Desconecta pelo menu: avisa o site (o token deixa de valer) e esquece. */
  async desconectar(): Promise<void> {
    const conta = lerConta();
    if (conta !== null) {
      await criarSite(conta.token)
        .desconectar()
        .catch(() => undefined);
    }
    esquecerConta();
    this.profissional = null;
    this.mudar("desconectado");
  }

  /** Um sinal, e o trabalho que houver. Uma batida de cada vez. */
  async batida(): Promise<void> {
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      const conta = lerConta();
      if (conta === null) {
        this.mudar("desconectado");
        return;
      }
      const site = criarSite(conta.token);
      const pronto = this.motor.estado === "pronto";
      const resposta = await site.sinal({
        versao: app.getVersion(),
        dispositivo: lerConfiguracao()?.dispositivo ?? "cpu",
        pronto,
      });
      this.profissional = resposta?.profissional ?? this.profissional;
      if (!pronto) {
        this.mudar("esperando");
        return;
      }
      for (;;) {
        // O motor pode ter pausado (o Docker ligou) entre um trabalho e outro.
        if (this.motor.estado !== "pronto") break;
        const ordem = await site.pegar();
        if (ordem === null) break;
        this.mudar("processando");
        await executar(ordem, site);
      }
      this.mudar("esperando");
    } catch (erro) {
      if (erro instanceof Desconectado) {
        registrar("o site não reconhece mais este computador: conta esquecida");
        esquecerConta();
        this.profissional = null;
        this.mudar("desconectado");
        return;
      }
      registrar(
        `sem falar com o site: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      this.mudar("sem_site");
    } finally {
      this.ocupado = false;
    }
  }
}
