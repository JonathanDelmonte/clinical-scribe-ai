import Link from "next/link";

/**
 * A moldura das páginas de privacidade e termos.
 *
 * Existe para que as duas fiquem iguais sem copiar layout, e para carregar num
 * lugar só a data de vigência — que é a informação que um documento desses
 * precisa ter e que é a mais fácil de esquecer de atualizar em dois arquivos.
 */

/**
 * Vigência dos documentos legais.
 *
 * ⚠️ Mudou o texto de privacidade ou dos termos? **Mude esta data.** Um
 * documento legal sem data de vigência não diz o que valia quando a pessoa
 * aceitou — e é exatamente isso que ele precisa dizer.
 */
export const VIGENCIA = "22 de setembro de 2026";

export function PaginaLegal({
  titulo,
  resumo,
  children,
}: {
  titulo: string;
  resumo: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <nav className="mb-8 flex flex-wrap gap-4 text-sm text-muted">
        <Link href="/" className="hover:text-ink">
          ← início
        </Link>
        <Link href="/privacidade" className="hover:text-ink">
          privacidade
        </Link>
        <Link href="/termos" className="hover:text-ink">
          termos
        </Link>
      </nav>

      <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
      <p className="mt-2 text-sm text-muted">{resumo}</p>
      <p className="mt-1 text-xs text-muted">Em vigor desde {VIGENCIA}.</p>

      {/*
       * `prose` não existe neste projeto (não há plugin de tipografia), então
       * o espaçamento é dado aqui, uma vez, em vez de repetido em cada
       * parágrafo dos dois documentos.
       */}
      <div className="mt-10 space-y-8 text-sm leading-relaxed">{children}</div>
    </main>
  );
}

export function Secao({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-medium">{titulo}</h2>
      {children}
    </section>
  );
}

export function Lista({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-2 pl-1">{children}</ul>;
}

export function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-muted">•</span>
      <span>{children}</span>
    </li>
  );
}
