import Link from "next/link";

import { AuthForm } from "@/components/AuthForm";

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
    <main className="mx-auto max-w-sm px-5 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
      <p className="mt-1 mb-8 text-sm text-muted">
        Continue de onde parou na última consulta.
      </p>

      <AuthForm modo="entrar" destino={destino} />

      <p className="mt-6 text-sm text-muted">
        Ainda não tem conta?{" "}
        <Link href="/cadastrar" className="text-accent hover:underline">
          Criar uma
        </Link>
      </p>
    </main>
  );
}
