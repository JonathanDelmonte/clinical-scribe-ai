import { NextResponse, type NextRequest } from "next/server";

import { authConfig } from "@/lib/auth/config";
import { shouldRenew, signSessionToken, verifySessionToken } from "@scribe/auth";

/**
 * Redireciona quem não entrou, e renova a sessão de quem está usando.
 *
 * ⚠️ **Isto não é a fronteira de segurança.** É navegação: manda para o login
 * quem não tem cookie válido, para que a pessoa veja uma tela de login em vez
 * de uma página vazia. Quem decide se um dado pode ser lido é a política RLS
 * no banco, com a identidade que `lib/auth.ts` resolve — e ela resolve o mesmo
 * cookie de novo, por conta própria. Uma requisição que escape daqui não ganha
 * acesso a nada.
 *
 * Por que a conferência é repetida nos dois lugares, então: aqui ela evita um
 * redirecionamento tardio (e um piscar de tela); lá ela é a que vale. Se um
 * dia divergirem, a de lá ganha.
 *
 * O `proxy.ts` do Next 16 roda no runtime Node, então o mesmo módulo puro de
 * assinatura serve aos dois lados — sem uma segunda implementação de HMAC para
 * sair de sincronia com a primeira.
 */

/** Rotas que precisam funcionar sem sessão — senão não há como criar uma. */
const PUBLICAS = [
  "/entrar",
  "/cadastrar",
  "/privacidade",
  "/termos",
  "/api/auth/",
  "/api/health",
  // O ajudante não tem cookie: cada rota dele confere o próprio token (ou a
  // assinatura do link, ou — na criação do convite — a sessão do navegador).
  "/api/ajudante/",
];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const claims = verifySessionToken(
    request.cookies.get(authConfig.cookieName)?.value,
    authConfig.secret,
  );

  const publica = PUBLICAS.some(
    (rota) => pathname === rota || pathname.startsWith(rota),
  );

  if (claims === null) {
    if (publica) return NextResponse.next();

    // As rotas de API respondem 401 em vez de um redirecionamento: quem as
    // chama é `fetch`, e um 307 para uma página de login faria a chamada
    // "dar certo" devolvendo HTML — o erro mais confuso possível de depurar.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "não autenticado" }, { status: 401 });
    }

    const destino = request.nextUrl.clone();
    destino.pathname = "/entrar";
    destino.search = "";
    // Guarda para onde a pessoa queria ir — com os parâmetros. Um clique num
    // link de sessão recebido fora do app não pode terminar no painel
    // genérico, e a conexão do ajudante (`/ajudante/conectar?porta=...`)
    // perderia no login o endereço de volta para o computador da pessoa.
    if (pathname !== "/") {
      destino.searchParams.set("de", pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(destino);
  }

  // Já entrou: as telas de login e cadastro não fazem mais sentido.
  if (pathname === "/entrar" || pathname === "/cadastrar") {
    const destino = request.nextUrl.clone();
    destino.pathname = "/";
    destino.search = "";
    return NextResponse.redirect(destino);
  }

  const resposta = NextResponse.next();

  if (shouldRenew(claims, authConfig.ttlSeconds)) {
    resposta.cookies.set(
      authConfig.cookieName,
      signSessionToken(
        {
          sub: claims.sub,
          exp: Math.floor(Date.now() / 1000) + authConfig.ttlSeconds,
        },
        authConfig.secret,
      ),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: authConfig.secureCookie,
        path: "/",
        maxAge: authConfig.ttlSeconds,
      },
    );
  }

  return resposta;
}

export const config = {
  /**
   * Tudo, menos o que o navegador busca sozinho.
   *
   * Sem esta exclusão o proxy roda em cada CSS, ícone e chunk de JavaScript —
   * e, pior, um usuário sem sessão receberia um redirecionamento no lugar do
   * arquivo, o que quebra a própria tela de login que ele precisa ver.
   *
   * `video/` entra pela mesma razão: o vídeo de fundo da tela de entrada,
   * quando servido de `public/video/`, é pedido justamente por quem ainda não
   * entrou.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icones/|video/|offline.html|manifest.webmanifest|sw.js).*)",
  ],
};
