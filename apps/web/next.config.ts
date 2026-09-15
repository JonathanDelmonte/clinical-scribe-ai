import type { NextConfig } from "next";

const config: NextConfig = {
  // Os pacotes internos exportam TypeScript direto de `src/`, sem passo de
  // build. Um dev solo não precisa compilar pacotes internos para consumi-los.
  transpilePackages: ["@scribe/core", "@scribe/db"],

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
        ],
      },
    ];
  },
};

export default config;
