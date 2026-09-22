import { join } from "node:path";

import type { NextConfig } from "next";

/**
 * Carrega o `.env` da RAIZ do monorepo.
 *
 * O Next procura `.env` no diretório da aplicação (`apps/web/.env`), mas o
 * projeto mantém um só na raiz — a mesma `DATABASE_URL` serve web, worker e
 * migrations, e três cópias divergem no primeiro dia em que alguém edita uma.
 *
 * Isto roda antes da aplicação, então as variáveis já estão em `process.env`
 * quando o primeiro módulo é avaliado. Variáveis do ambiente real têm
 * precedência: em produção não existe `.env` e este bloco simplesmente não faz
 * nada.
 */
try {
  process.loadEnvFile(join(process.cwd(), "..", "..", ".env"));
} catch {
  // Sem .env — produção, ou primeira execução antes do `cp .env.example .env`.
}

const config: NextConfig = {
  // Os pacotes internos exportam TypeScript direto de `src/`, sem passo de
  // build. Um dev solo não precisa compilar pacotes internos para consumi-los.
  transpilePackages: ["@scribe/auth", "@scribe/core", "@scribe/db", "@scribe/storage"],

  // Vamos lidar com áudio de consulta — vale apertar os cabeçalhos desde já,
  // antes que alguma dependência comece a chamar endpoint inesperado.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // `microphone=(self)` é o único que precisamos liberar — é a
            // gravação da consulta. Câmera e geolocalização, nunca.
            value: "camera=(), geolocation=(), microphone=(self)",
          },
          {
            /**
             * A parte da CSP que dá para apertar sem quebrar nada.
             *
             * `script-src` não está aqui de propósito, e a ausência é
             * deliberada: apertá-lo no Next exige nonce por requisição, e uma
             * CSP com `unsafe-inline` escrita para "ter uma CSP" só dá a
             * impressão de proteção. Fica no checklist de segurança, nomeada.
             *
             * O que está aqui já fecha portas reais:
             *   frame-ancestors  clickjacking (a forma moderna do X-Frame-Options)
             *   object-src       plugins, um vetor antigo e inteiramente inútil aqui
             *   base-uri         reescrita da base de URLs relativas
             *   form-action      formulário desta página postando para outro site
             */
            key: "Content-Security-Policy",
            value: [
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          /**
           * HSTS só em produção. Em desenvolvimento o host é `http://localhost`
           * e este cabeçalho faria o navegador passar a exigir HTTPS de
           * `localhost` — inclusive de outros projetos na mesma porta, e por
           * meses, porque ele fica gravado no navegador.
           */
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default config;
