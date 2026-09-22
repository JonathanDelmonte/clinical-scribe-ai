/**
 * Configuração da autenticação.
 *
 * ## Por que a leitura é preguiçosa
 *
 * A primeira versão lia o segredo na avaliação do módulo, para que a falta
 * dele derrubasse a partida em vez de aparecer num log depois. A intenção
 * estava certa; o momento, errado — e o `next build` provou isso:
 *
 *     Error: Failed to collect page data for /api/auth/entrar
 *       [cause]: AUTH_SECRET não definida.
 *
 * O build do Next avalia os módulos de cada rota com `NODE_ENV=production`
 * para descobrir a configuração dela. Nesse instante não existe segredo
 * nenhum — segredo é coisa de tempo de execução, injetada no contêiner que
 * roda, e não na máquina que compila. Ler no topo do módulo transformava
 * "esqueci de configurar o ambiente" em "o build quebrou", que é uma mensagem
 * sobre outro problema.
 *
 * Lido sob demanda, o erro volta para onde pertence: a primeira requisição que
 * precisa assinar ou conferir uma sessão falha alto, com a mensagem certa, e o
 * build passa. O valor é memoizado, então a conferência acontece uma vez por
 * processo — que é o que a versão anterior queria.
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
 * Em produção, a ausência de `AUTH_SECRET` derruba a primeira requisição
 * autenticada. Um cookie de sessão assinado com um segredo que está no Git é
 * um cookie que qualquer um assina.
 */
const SEGREDO_DE_DESENVOLVIMENTO = "consulta-viva-desenvolvimento-nao-use-em-producao";

let segredoMemoizado: string | null = null;

function lerSegredo(): string {
  if (segredoMemoizado !== null) return segredoMemoizado;

  const bruto = process.env["AUTH_SECRET"] ?? "";

  if (bruto !== "") {
    if (bruto.length < 32) {
      throw new Error(
        "AUTH_SECRET precisa de pelo menos 32 caracteres. " +
          "Gere um com: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
      );
    }
    segredoMemoizado = bruto;
    return bruto;
  }

  if (PRODUCAO) {
    throw new Error(
      "AUTH_SECRET não definida. Sem ela as sessões seriam assinadas com um " +
        "segredo público, e qualquer pessoa poderia forjar o cookie de " +
        "qualquer profissional.",
    );
  }

  segredoMemoizado = SEGREDO_DE_DESENVOLVIMENTO;
  return segredoMemoizado;
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
  /** Lido na primeira vez que alguém assina ou confere uma sessão. */
  get secret(): string {
    return lerSegredo();
  },
  get provider(): AuthProvider {
    return lerProvedor();
  },
  cookieName: "scribe_session",
  /**
   * Sete dias. Curto o bastante para que um token roubado não valha para
   * sempre — ver a nota sobre revogação em `token.ts` — e longo o bastante
   * para que quem atende todo dia não veja tela de login toda manhã.
   */
  ttlSeconds: 7 * 24 * 60 * 60,
  secureCookie: PRODUCAO,
} as const;
