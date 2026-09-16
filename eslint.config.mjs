import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "spikes/**",
      "**/next-env.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // Dado de saúde não vai para o console. Use o logger estruturado, que
      // sabe o que redigir. `console.error` fica liberado para falha fatal.
      "no-console": ["warn", { allow: ["error"] }],

      eqeqeq: ["error", "smart"],
      "no-restricted-syntax": [
        "error",
        {
          // Salvaguarda de isolamento multi-tenant: nenhuma query deve
          // interpolar strings. Use parâmetros — RLS depende do papel da
          // conexão, e SQL injection contorna tudo.
          selector:
            "TaggedTemplateExpression[tag.name='sql'] > TemplateLiteral > TemplateElement[value.raw=/\\bWHERE\\b.*\\$\\{/i]",
          message:
            "Não interpole valores em SQL. Use parâmetros ligados (bound parameters).",
        },
      ],
    },
  },

  // Worker e scripts de linha de comando rodam fora do navegador, e imprimir no
  // terminal é o que eles fazem. A regra continua valendo onde importa: código
  // que toca dado de paciente e usa o logger com redação.
  {
    files: [
      "apps/worker/**/*.ts",
      "packages/db/src/migrate.ts",
      "packages/db/src/seed.ts",
      "packages/db/src/seed-demo.ts",
      "packages/db/src/test-rls.ts",
    ],
    rules: { "no-console": "off" },
  },

  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },

  // O AudioWorklet roda num escopo próprio do navegador — nem janela, nem
  // worker comum. `AudioWorkletProcessor` e `registerProcessor` só existem lá,
  // e o ESLint não tem como saber disso sem que alguém diga.
  {
    files: ["apps/web/public/audio-tap.js"],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: "readonly",
        registerProcessor: "readonly",
        sampleRate: "readonly",
        currentTime: "readonly",
      },
    },
  },
);
