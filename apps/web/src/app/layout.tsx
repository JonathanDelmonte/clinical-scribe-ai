import type { Metadata, Viewport } from "next";
import { Host_Grotesk } from "next/font/google";

import { ServiceWorker } from "@/components/ServiceWorker";

import "./globals.css";

/**
 * A fonte da casa: Host Grotesk.
 *
 * Uma grotesca contemporânea, precisa como as suíças e um pouco mais calorosa
 * — e longe das famílias que viraram o rosto padrão de site gerado por IA. O
 * `next/font` baixa os arquivos no build e os serve deste domínio: a página
 * não faz nenhuma requisição ao Google, o que num produto de saúde é um
 * terceiro a menos sabendo quem abriu o quê.
 */
const hostGrotesk = Host_Grotesk({
  subsets: ["latin"],
  variable: "--font-host-grotesk",
  display: "swap",
});

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
  // A cor da barra do sistema quando instalado: a mesma pérola do fundo, para
  // a borda superior não parecer outra superfície. O tema é claro sempre —
  // ver `globals.css`.
  themeColor: "#f2f5f6",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={hostGrotesk.variable}>
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
      <body className="min-h-dvh font-sans antialiased" suppressHydrationWarning>
        <ServiceWorker />
        {/*
         * Cabeçalho, navegação e rodapé moram nos layouts de cada grupo:
         * `(app)` tem a barra lateral; `(acesso)` tem o vídeo e o rodapé com
         * privacidade e termos, que precisam estar ao alcance de quem ainda
         * não entrou.
         */}
        {children}
      </body>
    </html>
  );
}
