import { AuthForm } from "@/components/AuthForm";
import { CartaoDeAcesso } from "@/components/CartaoDeAcesso";
import { EntrarComoTeste } from "@/components/EntrarComoTeste";

export const dynamic = "force-dynamic";

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ de?: string }>;
}) {
  const { de } = await searchParams;

  /**
   * O destino só é aceito se for um caminho interno.
   *
   * `?de=https://outro.site` transformaria a própria tela de login num
   * trampolim de phishing: o link chega com o domínio certo, a pessoa digita a
   * senha de verdade e é despejada num clone. Exigir que comece com `/` e não
   * com `//` (que o navegador lê como outro host) fecha isso.
   */
  const destino = de !== undefined && /^\/(?!\/)/.test(de) ? de : "/";

  return (
    <>
      <CartaoDeAcesso
        aba="entrar"
        titulo="Que bom te ver."
        subtitulo="Continue de onde parou na última consulta."
      >
        <AuthForm modo="entrar" destino={destino} />
      </CartaoDeAcesso>

      <EntrarComoTeste destino={destino} />
    </>
  );
}
