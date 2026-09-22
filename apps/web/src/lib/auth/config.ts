/**
 * Configuração da autenticação — lida uma vez, na partida.
 *
 * Segredo ausente é erro de ambiente, não de requisição: descobri-lo aqui
 * coloca a mensagem na primeira tela de quem rodou `pnpm dev`; descobri-lo no
 * primeiro login coloca a mesma mensagem num log, depois de alguém ter tentado
 * entrar. É a mesma disciplina que o worker usa com a chave do LLM.
 */

export type AuthProvider = "password" | "supabase";

const PRODUCAO = process.env["NODE_ENV"] === "production";

/**
 * Segredo de desenvolvimento, fixo e público.
 *
 * Existe porque a partida de um clone limpo precisa funcionar com
 * `cp .env.example .env` e nada mais — é a promessa do `atalhos/iniciar.bat`.
 * Um segredo aleatório por processo pareceria mais seguro e seria pior: todo
 * reinício do `next dev` deslogaria quem estava testando, e reinício em
 * desenvolvimento acontece a cada arquivo salvo.
 *
 * Em produção, a ausência de `AUTH_SECRET` derruba a partida. Um cookie de
 * sessão assinado com um segredo que está no Git é um cookie que qualquer um
 * assina.
 */
const SEGREDO_DE_DESENVOLVIMENTO = "consulta-viva-desenvolvimento-nao-use-em-producao";

function lerSegredo(): string {
  const bruto = process.env["AUTH_SECRET"] ?? "";
  if (bruto !== "") {
    if (bruto.length < 32) {
      throw new Error(
        "AUTH_SECRET precisa de pelo menos 32 caracteres. " +
          "Gere um com: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
      );
    }
    return bruto;
  }

  if (PRODUCAO) {
    throw new Error(
      "AUTH_SECRET não definida. Sem ela as sessões seriam assinadas com um " +
        "segredo público, e qualquer pessoa poderia forjar o cookie de " +
        "qualquer profissional.",
    );
  }

  return SEGREDO_DE_DESENVOLVIMENTO;
}

/**
 * Qual provedor de identidade responde por "quem é você".
 *
 * `supabase` é reconhecido e **recusado** de propósito, com uma mensagem que
 * diz o que falta. A alternativa — aceitar o valor e cair num caminho pela
 * metade — produziria um login que às vezes funciona, que é a pior das três
 * situações possíveis. Enquanto não houver projeto provisionado para medir
 * contra, dizer "ainda não" em voz alta é mais honesto do que um `if` que
 * ninguém executou. Ver ADR-0004.
 */
function lerProvedor(): AuthProvider {
  const bruto = process.env["AUTH_PROVIDER"] ?? "password";
  if (bruto === "password") return bruto;

  if (bruto === "supabase") {
    throw new Error(
      'AUTH_PROVIDER="supabase" ainda não está implementado. O que falta está ' +
        "em docs/adr/0004-autenticacao.md — é um verificador de token e o " +
        "mapeamento de `user.id` para `professionals.auth_user_id`, sem tocar " +
        "em rota, página ou consulta. Use `password` até lá.",
    );
  }

  throw new Error(`AUTH_PROVIDER="${bruto}" não existe. Use "password" (ADR-0004).`);
}

export const authConfig = {
  provider: lerProvedor(),
  secret: lerSegredo(),
  cookieName: "scribe_session",
  /**
   * Sete dias. Curto o bastante para que um token roubado não valha para
   * sempre — ver a nota sobre revogação em `token.ts` — e longo o bastante
   * para que quem atende todo dia não veja tela de login toda manhã.
   */
  ttlSeconds: 7 * 24 * 60 * 60,
  secureCookie: PRODUCAO,
} as const;
