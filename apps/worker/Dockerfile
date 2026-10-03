# Worker de processamento. Roda em container próprio porque transcrição leva
# minutos e não cabe em função serverless com timeout — ver ADR-0001.
FROM node:24-alpine

RUN corepack enable
WORKDIR /app

# Manifests primeiro: enquanto as dependências não mudarem, esta camada é
# reaproveitada e o build não reinstala nada.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# TODO pacote de que o worker depende, direta ou indiretamente (db → auth,
# processamento → core, db, storage).
# Faltando um, o `pnpm install` abaixo não resolve o workspace e o build para.
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/storage/package.json packages/storage/
COPY packages/motor/package.json packages/motor/
COPY packages/processamento/package.json packages/processamento/
COPY apps/worker/package.json apps/worker/

RUN pnpm install --frozen-lockfile --filter @scribe/worker...

COPY tsconfig.json ./
COPY packages packages
COPY apps/worker apps/worker

# Não rodar como root: o worker segura a chave service_role, que ignora todas
# as políticas RLS e enxerga os dados de todos os profissionais.
USER node

ENV NODE_ENV=production

# Direto pelo Node, e não por `pnpm start`: o pnpm 11 confere as dependências
# antes de rodar qualquer script e, achando algo a ajustar, tenta REINSTALAR —
# o que falha aqui (o usuário `node` não escreve em node_modules, de
# propósito) e derruba o container em loop de reinício.
WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx", "src/index.ts"]
