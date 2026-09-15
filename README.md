# Consulta Viva

> Escriba clínico com IA: grava a consulta, transcreve, separa quem fala
> (profissional × paciente) e devolve a nota estruturada — com cada afirmação
> ancorada no trecho de áudio que a originou.

**Status:** Marco 0 (fundação) · pré-MVP

📄 [Documentação de produto](docs/DOCUMENTACAO.md) · 🗺️ [Plano de desenvolvimento](docs/PLANO-DE-DESENVOLVIMENTO.md) · 🧱 [Decisões (ADR)](docs/adr/)

---

## Começando (Windows) — o caminho de um clique

Dê dois cliques em **`atalhos/iniciar.bat`**.

Ele abre o Docker Desktop e espera ficar pronto, detecta se a máquina tem placa
NVIDIA e escolhe o motor de acordo, sobe banco e transcrição, aplica schema e
políticas de segurança, popula os usuários de desenvolvimento, abre a aplicação
e o worker em janelas separadas, e por fim abre o navegador.

Para desligar: **`atalhos/parar.bat`**. Ele encerra a aplicação e os containers, mas
preserva os volumes — o banco e os modelos do Whisper sobrevivem, porque
apagá-los custaria gigabytes de download na próxima vez.

> A primeira execução baixa o modelo (alguns GB) e pode levar 10 a 20 minutos.
> As seguintes sobem em menos de um minuto.

## Começando à mão

Precisa de Node 24+, pnpm e o Docker Desktop aberto.

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm asr:up
```

`pnpm db:migrate` aplica extensões, schema e políticas RLS de uma vez.
`pnpm db:seed` cria dois profissionais de desenvolvimento com cargos
diferentes. `pnpm asr:up` sobe o motor de transcrição local — na primeira
vez ele baixa alguns GB de modelo, então comece por aqui.

> **Tem placa NVIDIA? Use `pnpm asr:up:gpu` no lugar de `pnpm asr:up`.**
>
> A diferença é de uma ordem de grandeza — em CPU o Whisper roda abaixo do
> tempo real (uma consulta de 30 min leva mais de 30 min para processar); em
> GPU ele passa de 20x, e ainda dá para usar o modelo `large-v3`, que é o
> melhor em português. Mais rápido e melhor ao mesmo tempo.
>
> Exige o driver NVIDIA recente e o Docker Desktop com integração de GPU
> (padrão no WSL2). Confira com:
> `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`

Depois, em dois terminais:

```bash
pnpm dev
```

```bash
pnpm dev:worker
```

A aplicação sobe em http://localhost:3000. Crie um paciente, grave ou envie
um áudio, e acompanhe a transcrição aparecer.

Para conferir o isolamento entre profissionais a qualquer momento:

```bash
pnpm db:test-rls
```

Para transcrever um arquivo sem passar pela interface:

```bash
pnpm asr:try caminho/do/audio.wav
```

Antes de abrir um PR:

```bash
pnpm check
```

> **Porta 5433, não 5432.** O Postgres do projeto publica em `localhost:5433`
> de propósito: é comum já existir um PostgreSQL instalado na máquina ocupando
> a 5432. Quando isso acontece, o erro que aparece é "autenticação falhou" —
> que não parece nem de longe com "porta ocupada", e custa uma tarde.

## Estrutura

```
atalhos/        iniciar.bat e parar.bat — sobe e desce tudo sem terminal
apps/
  web/          Next.js — PWA, rotas de API, gravação e revisão
  worker/       processo Node: fila → motor → trechos no banco
packages/
  core/         domínio puro: cargos, motores, citações (sem I/O)
  db/           schema Drizzle, migrations e políticas RLS
  storage/      áudio das consultas — disco hoje, Supabase Storage depois
services/
  asr-local/    Whisper + pyannote em container (o motor do plano grátis)
spikes/         código descartável de investigação (não vai para produção)
docs/adr/       decisões arquiteturais numeradas
```

## Cargos, planos e motores

Três conceitos que se confundem com facilidade e são mantidos separados de
propósito. Definidos em [`packages/core/src/account.ts`](packages/core/src/account.ts).

| | Valores | Decide |
|---|---|---|
| **Cargo** | `professional`, `developer` | O que a pessoa **pode** fazer |
| **Plano** | `free`, `pro`, `clinic` | O que ela **recebe** por padrão |
| **Motor** | `local`, `cloud` | **Como** o áudio é processado |

**Por que três eixos e não um enum só.** A alternativa tentadora seria
`medico_gratis | medico_pro | desenvolvedor`. Ela explode em combinações a cada
plano novo, e nela "desenvolvedor" fica sem plano nenhum. Separados, os eixos
não crescem um em cima do outro.

**Os motores:**

- **`local`** — Whisper + pyannote em [`services/asr-local`](services/asr-local).
  O áudio nunca sai do container: nenhum fornecedor, nenhuma transferência
  internacional, nenhum subprocessador a declarar. Custo marginal ~zero, mais
  lento. **É o motor do plano grátis.**
- **`cloud`** — API comercial. Fornecedor ainda não escolhido: isso é decidido
  no Marco 1, medindo, não lendo site (ADR-0002, pendente).

Nomeados pelo que **são**, não pelo que custam: no dia em que o local virar o
padrão de todos ou um fornecedor ficar mais barato, "gratuito" e "pago"
passariam a mentir.

**Quem recebe qual:**

```
plano free           → local
plano pro / clinic   → cloud
cargo developer      → escolhe qualquer um  ← é a razão de o cargo existir
```

A regra que protege o caixa: **quem não é `developer` não escolhe.** Se alguém
no plano grátis pedir `cloud`, o pedido é descartado, a decisão cai no padrão
do plano, e o pedido descartado aparece em `ignoredChoice` em vez de sumir em
silêncio. Falha fechada, e auditável.

Para ver funcionando:

```bash
pnpm asr:up
pnpm asr:try audio.wav --role professional --plan free --engine cloud
```

O `--engine cloud` será descartado, e a saída diz por quê.

## Três regras que não se negociam

### 1. Toda tabela com dado de paciente carrega `professional_id` direto

Mesmo quando ele seria derivável por JOIN. As políticas RLS são a única
barreira real entre os dados de um profissional e os de outro, e política com
JOIN é lenta e fácil de escrever errado. Com a coluna direta, toda política é a
mesma linha trivial. Ver [`packages/db/sql/rls.sql`](packages/db/sql/rls.sql).

### 2. O LLM cita IDs de trecho, nunca timestamps

Se você pedir um timestamp, o modelo **gera** um número — plausível e errado.
Se você der uma lista fechada de IDs opacos e exigir que cite dessa lista, ele
só pode **copiar**, e todo ID inexistente é pego por validação determinística.
Ver [`packages/core/src/citations.ts`](packages/core/src/citations.ts).

### 3. Nenhuma política RLS entra sem teste

[`packages/db/sql/test-rls.sql`](packages/db/sql/test-rls.sql) tenta ativamente
ler, escrever e alterar dados de outro profissional, e falha o build se
conseguir. Ele já pegou um bug real na primeira execução — faltava `grant usage
on schema auth`, e sem isso *nenhuma* consulta funcionava. Política escrita não
é política testada.

### 4. Log registra IDs, nunca conteúdo

`sessionId` sim; o texto da transcrição, não. Log é o vazamento de dado de
saúde mais fácil de cometer e mais difícil de perceber. O logger redige por
padrão, mas a redação é rede de segurança — não substituto para a regra.

## Ambiente

| | |
|---|---|
| Node | 24+ |
| pnpm | 11+ |
| Docker | para o Postgres local |
| Python | 3.13 (apenas para `spikes/`) |

## Sobre dados sensíveis

Este repositório trata dados pessoais sensíveis de saúde (LGPD Art. 11).

- Áudio de consulta e transcrições **nunca** entram no Git — o `.gitignore`
  bloqueia os formatos, mas a responsabilidade é sua.
- `.env` nunca é commitado. `SUPABASE_SERVICE_ROLE_KEY` ignora todas as
  políticas RLS e só pode existir no worker.
- Antes de enviar áudio real a qualquer fornecedor de IA, confirme o contrato
  de **não-treinamento** com os dados.

---

Proprietário — ver [LICENSE](LICENSE).
