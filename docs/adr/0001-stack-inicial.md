# ADR-0001 — Stack inicial

- **Status:** aceita — implementada no Marco 0
- **Data:** 15/09/2026
- **Decisores:** Jonathan Delmonte

## Contexto

Projeto greenfield, desenvolvedor solo, MVP com prazo alvo de ~2 meses. Requisitos que restringem a escolha, vindos de [DOCUMENTACAO.md](../DOCUMENTACAO.md):

1. **Isolamento multi-tenant rígido** — §6.3 exige filtragem por dono "no nível de dados, não só na interface". Vazamento entre profissionais é incidente grave de LGPD com dado sensível de saúde.
2. **Dados hospedados no Brasil** — §10 posiciona isso como recurso de confiança exibido na tela.
3. **`pgvector` previsto** — §6.3-A (assistente RAG) e §8 pedem que a arquitetura de hoje não feche a porta.
4. **Processamento assíncrono de áudio** — §8; transcrição leva minutos, não cabe em requisição HTTP nem em função serverless com timeout.
5. **Mobile-first / PWA** — §8; consultório com internet instável.

## Decisão

| Camada | Escolha |
|---|---|
| Monorepo | pnpm workspaces + TypeScript 6.0.3 strict |
| Front-end / API | Next.js (App Router), Tailwind, PWA |
| Worker | Processo Node em container separado |
| Fila | Tabela no Postgres (`FOR UPDATE SKIP LOCKED`) ou `pgmq` |
| Banco / Auth / Storage | Supabase, região `sa-east-1` (São Paulo) |
| ORM | Drizzle |
| Testes | Vitest + Playwright |
| CI | GitHub Actions |

**Fora do escopo deste ADR:** fornecedor de ASR e diarização — decidido empiricamente em ADR-0002, após o Marco 1.

## Justificativa

**Supabase em São Paulo** resolve quatro dos cinco requisitos de uma vez: RLS do Postgres atende (1) no nível de dados, a região atende (2), `pgvector` é extensão nativa e atende (3), e Storage com as mesmas políticas cobre o áudio.

**Worker separado** é o único serviço que precisa viver fora do Next.js — é o requisito (4) e não há atalho: serverless com timeout não processa áudio de 30 minutos.

**Drizzle sobre Prisma** porque as políticas RLS são SQL escrito à mão, e Drizzle convive com SQL cru sem atrito. Prisma abstrai justamente a camada onde precisamos de controle explícito.

**Next.js full-stack** porque desenvolvedor solo não sustenta dois serviços separados com dois deploys e dois ciclos de release durante um MVP. Se o BFF crescer demais, extrai-se depois — o custo dessa extração é menor que o custo de manter a separação desde já.

## Consequências

**Positivas**
- Isolamento multi-tenant garantido pelo banco, não pela disciplina do desenvolvedor
- Residência de dados no Brasil para armazenamento e banco
- Caminho para RAG sem migração de dados históricos
- Um deploy para a aplicação, um para o worker

**Negativas**
- Acoplamento a Supabase em Auth e Storage. *Mitigação:* o banco é Postgres puro — schema, migrations e políticas são portáveis. Auth e Storage são substituíveis com ~1 semana de trabalho.
- Um worker separado significa um segundo ambiente para operar e observar.
- O conflito de residência de dados **não é resolvido por este ADR**: se o fornecedor de ASR escolhido em ADR-0002 for hospedado fora do Brasil, o áudio sai do país e o claim de marketing precisa ser ajustado. Ver seção "⚠️ O conflito de residência de dados" em [PLANO-DE-DESENVOLVIMENTO.md](../PLANO-DE-DESENVOLVIMENTO.md).

## Notas de implementação (15/09/2026)

Duas coisas que só apareceram ao montar de verdade:

### TypeScript 6.0.3, não 7.x

O `latest` do npm é **TypeScript 7.0.2** — a porta nativa em Go, muito mais
rápida. Mas `typescript-eslint@8.70` recusa TS 7 na partida (peer range
`>=4.8.4 <6.1.0`): o ecossistema de lint ainda depende da API do compilador
antigo.

A troca é velocidade de compilação contra lint com consciência de tipos. Num
produto que trata dado de saúde, o lint vale mais. **Fixado em 6.0.3.**

> Revisitar quando `typescript-eslint` suportar TS ≥ 7.1
> ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).
> A migração é um bump de versão.

### `types: []` na raiz do tsconfig

O pnpm usa `node_modules` isolado, e a descoberta automática de `@types` não
funcionou de forma confiável nesse layout. Em vez de contornar, cada pacote
declara os tipos globais que usa.

O efeito colateral é melhor que a correção: `packages/core` herda a lista
vazia, então `process`, `fs` e afins **não existem lá**. A pureza do pacote —
que era uma convenção num comentário — virou erro de compilação.

### Desvio do plano: `packages/config` não existe

O plano previa um pacote para configuração compartilhada. Com um `tsconfig.json`
e um `eslint.config.mjs` na raiz, um pacote inteiro para guardar dois arquivos
é cerimônia sem ganho. Removido.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| NestJS + React separados | Dois deploys, dois ciclos de release. Sobrecarga que um dev solo não sustenta no MVP. |
| Prisma | Atrito com SQL cru, exatamente onde as políticas RLS vivem. |
| Redis / SQS para a fila | Infra adicional sem ganho no volume do MVP. Postgres com `SKIP LOCKED` serve até milhares de jobs/dia. |
| Firebase | Sem Postgres, sem `pgvector`, sem RLS relacional. Fecha a porta do RAG. |
| AWS montado à mão (RDS + S3 + SQS + Cognito) | Residência resolvida, mas semanas de infraestrutura antes da primeira linha de produto. |
