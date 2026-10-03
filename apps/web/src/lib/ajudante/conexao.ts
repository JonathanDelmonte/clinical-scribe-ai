/**
 * Os campos que o ajudante manda ao abrir `/ajudante/conectar`, e que a
 * página repassa ao clicar em "Conectar" — conferidos nos dois pontos.
 *
 * - `porta`: onde o ajudante escuta, no próprio computador (127.0.0.1).
 * - `estado`: um valor aleatório que o ajudante confere na volta, para só
 *   aceitar a resposta da conexão que ELE começou.
 * - `desafio`: o SHA-256 do verificador (PKCE) — o convite só abre com ele.
 * - `nome`: o nome do computador, para a pessoa ver o que está conectando.
 */
export interface PedidoDeConexao {
  readonly porta: number;
  readonly estado: string;
  readonly desafio: string;
  readonly nome: string;
}

export function lerPedidoDeConexao(dados: {
  readonly porta: unknown;
  readonly estado: unknown;
  readonly desafio: unknown;
  readonly nome: unknown;
}): PedidoDeConexao | null {
  const porta = Number(dados.porta);
  const { estado, desafio, nome } = dados;
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) return null;
  if (typeof estado !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(estado))
    return null;
  // O SHA-256 em base64url tem sempre 43 caracteres.
  if (typeof desafio !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(desafio)) return null;
  if (typeof nome !== "string" || nome.trim() === "" || nome.length > 100) return null;
  return { porta, estado, desafio, nome: nome.trim() };
}
