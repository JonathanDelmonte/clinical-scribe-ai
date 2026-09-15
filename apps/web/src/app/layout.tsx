import { professionals } from "@scribe/db";
import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { UserSwitcher } from "@/components/UserSwitcher";
import { currentAuthUserId, currentProfessional } from "@/lib/auth";
import { db } from "@/lib/db";

import "./globals.css";

export const metadata: Metadata = {
  title: "Consulta Viva",
  description:
    "Escriba clínico com IA: grava, transcreve, separa vozes e devolve a nota pronta para revisão.",
  // A documentação (§4) recomenda "clínico" no lugar de "médico" — o termo
  // mantém a porta aberta para nutricionistas, psicólogos, fisioterapeutas e
  // dentistas, um mercado maior e menos disputado.
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Mobile-first de verdade: a consulta é gravada no celular, muitas vezes
  // com o aparelho na mesa.
  maximumScale: 5,
};

async function devUsers() {
  // Lê com a conexão de serviço porque é uma lista de TODOS os profissionais
  // — algo que RLS corretamente proíbe. É exclusivo do seletor de dev e some
  // junto com ele quando o Auth real entrar.
  try {
    const rows = await db.select().from(professionals).limit(10);
    return rows.map((p) => ({
      authUserId: p.authUserId,
      name: p.name,
      role: p.role,
      plan: p.plan,
    }));
  } catch {
    return [];
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [me, users, authUserId] = await Promise.all([
    currentProfessional().catch(() => null),
    devUsers(),
    currentAuthUserId(),
  ]);

  return (
    <html lang="pt-BR">
      {/*
       * `suppressHydrationWarning` no <body> por causa de EXTENSÕES DO
       * NAVEGADOR, não de código nosso.
       *
       * Várias extensões (ColorZilla, gerenciadores de senha, tradutores)
       * injetam atributos no <body> — `cz-shortcut-listen="true"` é o caso
       * clássico — antes de o React hidratar. O React compara o HTML do
       * servidor com o do cliente, encontra um atributo a mais e acusa erro de
       * hidratação, que aparece para o desenvolvedor como se fosse um bug.
       *
       * A supressão vale só para os atributos DESTE elemento, um nível de
       * profundidade. Erros de hidratação reais, dentro da árvore, continuam
       * sendo reportados normalmente — que é o que queremos.
       */}
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-3xl items-center gap-4 px-5 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Consulta&nbsp;Viva
            </Link>
            {me !== null && (
              <span className="hidden text-xs text-muted sm:inline">
                {me.specialty ?? "—"}
              </span>
            )}
            <div className="ml-auto">
              {users.length > 0 && (
                <UserSwitcher users={users} currentAuthUserId={authUserId} />
              )}
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
