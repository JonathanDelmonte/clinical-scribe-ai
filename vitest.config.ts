import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cada pacote com testes vira um projeto. `packages/core` é o que mais
    // importa: lógica pura, sem I/O, testável em milissegundos — é onde a
    // qualidade de prompt e a validação de citações são iteradas.
    projects: ["packages/*", "apps/*"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
    },
  },
});
