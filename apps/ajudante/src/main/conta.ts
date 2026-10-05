/**
 * A conta a que este computador está conectado — e como ele se conecta.
 * Ver ADR-0005 e `packages/auth/src/ajudante.ts` para o desenho inteiro.
 *
 * O ajudante nunca vê a senha da pessoa. Ele abre o navegador no site, onde
 * ela já entrou; ela confirma; o site devolve um convite pelo endereço local
 * deste computador (127.0.0.1), e o ajudante o troca por um token — provando,
 * com um segredo que nunca saiu daqui (PKCE), que foi ele quem pediu.
 *
 * O token fica num arquivo cifrado pelo próprio Windows (DPAPI, via
 * `safeStorage`): outro usuário do computador, ou o arquivo copiado para
 * outra máquina, não o abre.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { hostname } from "node:os";

import { safeStorage, shell } from "electron";

import { caminhos, enderecoDoSite } from "./caminhos";
import { registrar } from "./registro";

export interface Conta {
  readonly token: string;
  /** O nome de quem conectou — "Conectado como …". */
  readonly profissional: string;
  readonly email: string | null;
  readonly conectadoEm: string;
}

export function lerConta(): Conta | null {
  const { conta } = caminhos();
  if (!existsSync(conta) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(conta))) as Conta;
  } catch {
    return null;
  }
}

function guardarConta(conta: Conta): void {
  const c = caminhos();
  mkdirSync(c.dados, { recursive: true });
  writeFileSync(c.conta, safeStorage.encryptString(JSON.stringify(conta)));
}

/** Esquece a conta neste computador (o token deixa de existir aqui). */
export function esquecerConta(): void {
  rmSync(caminhos().conta, { force: true });
}

/** Dez minutos para a pessoa entrar no site e confirmar. */
const PRAZO_DA_CONEXAO_MS = 10 * 60 * 1000;

let conexaoEmCurso: Promise<Conta> | null = null;

/**
 * Conecta este computador a uma conta: abre o navegador e espera a volta.
 * Pedir de novo, com uma conexão já em curso, devolve a mesma.
 */
export function conectar(versao: string, dispositivo: "cuda" | "cpu"): Promise<Conta> {
  conexaoEmCurso ??= conectarDeVerdade(versao, dispositivo).finally(() => {
    conexaoEmCurso = null;
  });
  return conexaoEmCurso;
}

function conectarDeVerdade(
  versao: string,
  dispositivo: "cuda" | "cpu",
): Promise<Conta> {
  const site = enderecoDoSite();
  const verificador = randomBytes(32).toString("base64url");
  const desafio = createHash("sha256").update(verificador).digest("base64url");
  const estado = randomBytes(24).toString("base64url");
  const nome = (hostname() || "Este computador").slice(0, 100);

  return new Promise<Conta>((resolver, rejeitar) => {
    let terminou = false;
    const servidor = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/conectado") {
        res.writeHead(404).end();
        return;
      }
      // Só a volta da conexão que ESTE ajudante começou.
      if (url.searchParams.get("estado") !== estado) {
        responder(res, 400, "Esta resposta não é da conexão que o ajudante começou.");
        return;
      }
      void (async () => {
        try {
          const resposta = await fetch(`${site}/api/ajudante/conectar`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              codigo: url.searchParams.get("codigo") ?? "",
              verificador,
              versao,
              dispositivo,
            }),
            signal: AbortSignal.timeout(30_000),
          });
          const corpo = (await resposta.json().catch(() => null)) as {
            token?: string;
            profissional?: string;
            email?: string | null;
            erro?: string;
          } | null;
          if (!resposta.ok || typeof corpo?.token !== "string") {
            throw new Error(corpo?.erro ?? `o site respondeu ${resposta.status}`);
          }
          const conta: Conta = {
            token: corpo.token,
            profissional: corpo.profissional ?? "",
            email: corpo.email ?? null,
            conectadoEm: new Date().toISOString(),
          };
          guardarConta(conta);
          registrar(`conectado à conta de ${conta.profissional}`);
          responder(
            res,
            200,
            `Pronto. Este computador está conectado à conta de ${conta.profissional}. Pode fechar esta aba.`,
            "Computador conectado",
          );
          encerrar();
          resolver(conta);
        } catch (erro) {
          const mensagem = erro instanceof Error ? erro.message : String(erro);
          registrar(`conexão recusada: ${mensagem}`);
          responder(res, 500, `Não deu para conectar: ${mensagem}`);
          encerrar();
          rejeitar(new Error(mensagem));
        }
      })();
    });

    const limite = setTimeout(() => {
      encerrar();
      rejeitar(new Error("A conexão não foi confirmada no navegador a tempo."));
    }, PRAZO_DA_CONEXAO_MS);

    function encerrar(): void {
      if (terminou) return;
      terminou = true;
      clearTimeout(limite);
      // Fecha depois de a resposta sair: a aba precisa da página de volta.
      setTimeout(() => servidor.close(), 500);
    }

    servidor.on("error", (erro) => {
      encerrar();
      rejeitar(erro);
    });
    // Porta escolhida pelo Windows, e só no endereço local: nada de fora
    // deste computador alcança este servidor.
    servidor.listen(0, "127.0.0.1", () => {
      const porta = (servidor.address() as AddressInfo).port;
      const pagina = new URL("/ajudante/conectar", site);
      pagina.searchParams.set("porta", String(porta));
      pagina.searchParams.set("estado", estado);
      pagina.searchParams.set("desafio", desafio);
      pagina.searchParams.set("nome", nome);
      // Teste automatizado (`AJUDANTE_NAVEGADOR=nenhum`): o link vai só para o
      // registro, e quem o abre é o teste, num navegador já dentro da conta de
      // teste. Quem usa o ajudante nunca define isso.
      if (process.env["AJUDANTE_NAVEGADOR"] === "nenhum") {
        registrar(`conexão (teste): abra ${pagina.toString()}`);
        return;
      }
      registrar(`conexão: navegador aberto, esperando na porta ${porta}`);
      void shell.openExternal(pagina.toString());
    });
  });
}

/** A página que a aba do navegador mostra ao voltar para o ajudante. */
function responder(
  res: ServerResponse,
  status: number,
  texto: string,
  titulo = "Consulta Viva Ajudante",
): void {
  const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(titulo)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F5F6;color:#0F1B24;
       font-family:"Host Grotesk","Segoe UI",system-ui,sans-serif}
  main{max-width:440px;margin:24px;padding:32px;border-radius:28px;background:rgba(255,255,255,.72);
       box-shadow:inset 0 1px 0 #fff,0 30px 60px -40px rgba(22,52,70,.4)}
  .orbe{width:44px;height:44px;border-radius:50%;margin-bottom:18px;
        background:radial-gradient(circle at 35% 30%,#fff,#A8EEE2 45%,#2BB5AC)}
  h1{font-size:26px;font-weight:400;letter-spacing:-.02em;margin:0 0 10px}
  p{font-size:15.5px;line-height:1.55;color:#445561;margin:0}
</style></head>
<body><main><div class="orbe"></div><h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p></main></body></html>`);
}
