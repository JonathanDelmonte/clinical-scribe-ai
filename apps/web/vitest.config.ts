import { fileURLToPath } from "node:url";

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
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),

      /**
       * `server-only` é um pacote que existe para LANÇAR quando importado do
       * bundle do cliente — é assim que ele protege um módulo de servidor de
       * vazar para o navegador. Fora do Next, no Vitest, ele lança sempre, e o
       * erro ("This module cannot be imported from a Client Component") aponta
       * para o lugar errado: parece bug de importação, é o pacote fazendo o
       * trabalho dele.
       *
       * O pacote traz um módulo vazio, mas não o expõe no `exports`. Daí o
       * substituto local: mantém a proteção onde ela importa — o bundle do
       * cliente, no Next — e deixa o teste rodar.
       */
      "server-only": fileURLToPath(
        new URL("./src/lib/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
});
