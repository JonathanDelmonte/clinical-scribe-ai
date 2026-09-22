import type { MetadataRoute } from "next";

/**
 * O manifesto que torna a aplicação instalável.
 *
 * A documentação (§8) escolhe PWA em vez de app nativo, e o motivo é de
 * negócio antes de ser técnico: o produto precisa estar na tela inicial do
 * celular do profissional sem passar por revisão de loja, sem conta de
 * desenvolvedor e sem dois códigos para manter. Este arquivo é a diferença
 * entre "um site que abre no navegador" e "um aplicativo que ele instala".
 *
 * `display: standalone` tira a barra de endereço. Isso não é estética: a
 * gravação acontece com o aparelho na mesa, e uma barra de endereço convida a
 * um toque errado que sai do aplicativo no meio da consulta.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Consulta Viva — escriba clínico",
    short_name: "Consulta Viva",
    description:
      "Grava a consulta, transcreve, separa as vozes e devolve a nota pronta para revisão.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/",
    // `scope` restringe o que abre dentro do aplicativo instalado. Sem ele,
    // qualquer link externo abriria na janela sem barra de endereço — e uma
    // página de terceiro sem barra de endereço é uma tela de phishing pronta.
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fcfcfd",
    theme_color: "#0f8e9c",
    categories: ["medical", "productivity", "health"],
    icons: [
      { src: "/icones/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icones/icone-512.png", sizes: "512x512", type: "image/png" },
      {
        // O Android recorta o ícone em formatos que variam por fabricante e
        // só garante os 80% centrais. A variante mascarável tem o desenho
        // recuado para sobreviver a qualquer recorte.
        src: "/icones/icone-512-mascaravel.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
