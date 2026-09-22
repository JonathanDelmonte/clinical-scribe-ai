import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { SairButton } from "@/components/SairButton";
import { ServiceWorker } from "@/components/ServiceWorker";
import { currentProfessional } from "@/lib/auth";

import "./globals.css";

export const metadata: Metadata = {
  title: "Consulta Viva",
  description:
    "Escriba clínico com IA: grava, transcreve, separa vozes e devolve a nota pronta para revisão.",
  // A documentação (§4) recomenda "clínico" no lugar de "médico" — o termo
  // mantém a porta aberta para nutricionistas, psicólogos, fisioterapeutas e
  // dentistas, um mercado maior e menos disputado.

  // O iOS ignora o manifesto para o ícone do atalho e só olha este link.
  appleWebApp: {
    capable: true,
    title: "Consulta Viva",
    statusBarStyle: "default",
    startupImage: [],
  },
  icons: {
    apple: "/icones/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Mobile-first de verdade: a consulta é gravada no celular, muitas vezes
  // com o aparelho na mesa.
  maximumScale: 5,
  // A cor da barra do sistema quando instalado. Acompanha o tema para que a
  // borda superior não fique branca num aparelho no modo escuro.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1f26" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const me = await currentProfessional().catch(() => null);

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
        <ServiceWorker />
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
            {/*
             * O cabeçalho só mostra navegação de conta para quem tem conta. Na
             * tela de login, "configurações" e "sair" seriam links que não
             * levam a lugar nenhum — e um "sair" visível para quem não entrou
             * é o tipo de detalhe que faz a pessoa duvidar se entrou.
             */}
            {me !== null && (
              <>
                <Link href="/uso" className="ml-auto text-xs text-muted hover:text-ink">
                  uso
                </Link>
                <Link
                  href="/configuracoes"
                  className="text-xs text-muted hover:text-ink"
                >
                  configurações
                </Link>
                <SairButton />
              </>
            )}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
