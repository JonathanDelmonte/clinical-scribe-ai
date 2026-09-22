import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "web",
    environment: "node",
    // Só o que é puro. Rotas, páginas e componentes precisariam de banco, de
    // requisição ou de DOM para dizer alguma coisa — e um teste que monta meia
    // aplicação para conferir uma condição testa principalmente a montagem.
    include: ["src/lib/**/*.test.ts"],
  },
});
