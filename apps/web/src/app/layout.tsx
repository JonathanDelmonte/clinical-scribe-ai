import type { Metadata, Viewport } from "next";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
