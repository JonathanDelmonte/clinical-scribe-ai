import { NextResponse, type NextRequest } from "next/server";

import { currentProfessional } from "@/lib/auth";
import { authConfig } from "@/lib/auth/config";
import { lerSessao } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Resolve o cookie que aponta para uma conta que não existe mais.
 *
 * ## O laço que isto desfaz
 *
 * O `proxy.ts` confere só a ASSINATURA do cookie — de propósito, porque roda
 * em toda requisição e uma consulta ao banco em cada uma seria cara. Então,
 * para ele, um cookie bem assinado significa "está logado", e ele manda quem
 * está em `/entrar` para `/`.
 *
 * A página, em `/`, procura a conta no banco. Se ela foi apagada, não acha, e
 * manda para `/entrar`. Que manda para `/`. Que manda para `/entrar`.
 *
 * Os dois lados estão certos isoladamente. O defeito é que ninguém apagava o
 * cookie — e é o cookie que mantém o proxy convencido. Acontece sempre que uma
 * conta some com o navegador ainda logado nela: exclusão de conta pelo próprio
 * titular (LGPD Art. 18) com a sessão aberta noutro aparelho, remoção feita
 * por quem administra, ou — o caso mais comum em desenvolvimento — recriar o
 * banco local enquanto o navegador continua aberto.
 *
 * ## Por que GET, se sair é POST
 *
 * `/api/auth/sair` é POST para que um `<img src>` num site de terceiro não
 * consiga derrubar a sessão de ninguém. Esta rota é GET porque é o destino de
 * um redirecionamento, e redirecionamento é sempre GET.
 *
 * O que a mantém segura é conferir antes de apagar: ela SÓ remove o cookie se
 * a conta realmente não existe. Disparada contra uma sessão válida, encontra a
 * conta e devolve a pessoa para o painel sem tocar em nada. O pior que um
 * terceiro consegue é apagar um cookie que já não servia para coisa alguma.
 */
export async function GET(request: NextRequest) {
  const para = (caminho: string) => new URL(caminho, request.url);

  // Sem cookie válido não há o que resolver: o proxy já cuida desse caso.
  if ((await lerSessao()) === null) {
    return NextResponse.redirect(para("/entrar"));
  }

  let conta: Awaited<ReturnType<typeof currentProfessional>>;
  try {
    conta = await currentProfessional();
  } catch {
    /**
     * Falha ao consultar NÃO é conta ausente.
     *
     * Tratar os dois igual apagaria a sessão de todo mundo a cada queda do
     * banco: um problema de infraestrutura de trinta segundos viraria "todos
     * os profissionais deslogados no meio do atendimento". O cookie fica, e a
     * pessoa tenta de novo quando o banco voltar.
     */
    return NextResponse.json(
      { error: "Não foi possível conferir a sua conta agora. Tente de novo." },
      { status: 503 },
    );
  }

  if (conta !== null) {
    return NextResponse.redirect(para(conta.onboardedAt === null ? "/bem-vindo" : "/"));
  }

  // A conta não existe. O cookie é só um bilhete para um lugar que acabou.
  const resposta = NextResponse.redirect(para("/entrar"));
  resposta.cookies.set(authConfig.cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: authConfig.secureCookie,
    path: "/",
    maxAge: 0,
  });
  return resposta;
}
