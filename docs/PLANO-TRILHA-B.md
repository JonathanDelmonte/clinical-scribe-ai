# Plano de ação — Trilha B (Marcos 5 e 6)

> Companheiro de [DIVISAO-DE-TRABALHO.md](./DIVISAO-DE-TRABALHO.md), que define
> **quem faz o quê**. Este documento define **em que ordem** a Trilha B é feita,
> e por quê nessa ordem.
> Criado em 22/09/2026 · **Concluído em 22/09/2026.**

---

## Estado: as doze fases estão fechadas

| # | Fase | Onde ver |
|---|---|---|
| 0 | Migration anunciada | `migrations/0006` · `sql/rls.sql` · 21 asserções em `sql/test-rls.sql` |
| 1 | Auth real + onboarding | `packages/auth/` · `lib/auth/` · [ADR-0004](./adr/0004-autenticacao.md) |
| 2 | Pacientes | `/` com busca · `/pacientes/[id]` com ficha editável |
| 3 | Consentimento + quota | `lib/consent.ts` · `lib/quota.ts` · `lib/upload.ts` |
| 4 | Gravação endurecida | `lib/recording/` — buffer em IndexedDB, envio em pedaços com retomada |
| 5 | Export | `lib/export/` · `/exportar/[id]` |
| 6 | PWA | `app/manifest.ts` · `public/sw.js` · `scripts/gerar-icones.mjs` |
| 7 | Telemetria de uso | `/uso` |
| 8 | Auditoria | `lib/audit.ts` · `/auditoria` |
| 9 | Retenção de áudio | `apps/worker/src/handlers/retention.ts` |
| 10 | LGPD Art. 18 | `lib/lgpd.ts` · `/configuracoes/dados` |
| 11 | Rate limiting | `lib/rate-limit.ts` · `lib/limites.ts` |
| 12 | Privacidade, termos, revisão | `/privacidade` · `/termos` · [REVISAO-DE-SEGURANCA.md](./REVISAO-DE-SEGURANCA.md) |

**O que ficou de fora, de propósito e nomeado:** as oito pendências da
[revisão de segurança](./REVISAO-DE-SEGURANCA.md#️-o-que-continua-aberto).
Nenhuma bloqueia o primeiro usuário; todas precisam de decisão antes de
escalar.

**Três coisas que este plano previa de um jeito e foram feitas de outro**, cada
uma explicada no lugar em que está implementada:

1. **Auth pelo Supabase** virou auth por senha atrás de uma costura. Construir
   só contra o Supabase exigiria projeto provisionado para qualquer pessoa
   rodar `pnpm dev` — inclusive a Trilha A, que não tem nada a ver com login —
   e código de integração nunca executado é rascunho com cara de pronto.
   [ADR-0004](./adr/0004-autenticacao.md).
2. **Retenção de áudio** virou varredura em vez de job agendado no envio: só a
   varredura respeita uma mudança de `AUDIO_RETENTION_DAYS` sobre o que já
   existe, que é justamente quando se quer efeito imediato.
3. **A exportação** ganhou tela própria em vez de entrar na revisão da
   consulta, porque aquela tela é da Trilha A. `ExportarDocumento` é um
   componente exatamente para que ela possa incorporá-lo quando quiser.

---

## Como isto foi construído (o plano original, preservado)

O que vem abaixo é o plano como foi escrito antes de a primeira linha existir,
inclusive o aviso de migration da Fase 0. Preservado no tempo verbal original:
é o registro do raciocínio, e reescrevê-lo no passado apagaria a diferença
entre o que foi previsto e o que foi descoberto fazendo.

---

## O que esta trilha entrega

O motor já funciona ponta a ponta: grava, transcreve, separa as vozes, atribui
papéis e devolve uma nota ancorada no áudio. O que falta é tudo o que
transforma isso num produto que uma pessoa real pode usar sem estar sentada ao
lado de quem o construiu — **login que não é um cookie sem senha, pacientes que
se encontram, gravação que sobrevive ao celular, documento que sai, quota que
não sangra caixa, e os direitos que a LGPD dá ao titular.**

---

## O princípio que ordena as fases

> **Nada que dependa da identidade do usuário pode ser construído antes de a
> identidade ser real.**

Hoje `lib/auth.ts` é um cookie sem senha que diz "sou este profissional". Ele
foi honesto enquanto o objetivo era fechar o esqueleto andante. A partir do
momento em que existe auditoria, quota, exclusão de conta e exportação de
dados, ele deixa de ser um atalho e passa a ser uma mentira embutida: uma
trilha de auditoria sobre uma identidade que qualquer um assume não audita
nada, e uma quota amarrada a um cookie editável não limita nada.

Por isso a autenticação é a **Fase 1**, e não uma das últimas — embora a lista
do Marco 5 a apresente como mais um item entre dez.

O segundo ordenador é mais prosaico: **o que custa dinheiro vem antes do que
custa vergonha.** A quota verificada antes de processar (Fase 3) é a única
tarefa desta trilha em que cada dia de atraso tem preço em reais.

---

## As fases

| # | Fase | Entrega | Depende de |
|---|---|---|---|
| 0 | **Migration anunciada** | Colunas novas, políticas RLS novas, asserções novas | — |
| 1 | **Auth real + onboarding** | Senha, sessão assinada, perfil, assinatura | 0 |
| 2 | **Pacientes** | CRUD completo, busca, pasta com histórico | 1 |
| 3 | **Consentimento + quota** | Texto versionado gravado; quota **antes** de processar | 0, 1 |
| 4 | **Gravação endurecida** | Buffer local, upload retomável, avisos do dispositivo | 1 |
| 5 | **Export** | PDF assinado e "copiar para o prontuário" | 1 |
| 6 | **PWA** | Instalável, shell offline, ícone | — |
| 7 | **Telemetria de uso** | A tela que lê `usage_events` | 1 |
| 8 | **Auditoria** | `audit_log` deixa de estar vazia | 0, 1 |
| 9 | **Retenção de áudio** | Áudio apagado após `AUDIO_RETENTION_DAYS` | 8 |
| 10 | **LGPD Art. 18** | Portabilidade e exclusão de conta | 8, 9 |
| 11 | **Rate limiting** | Teto nas rotas que custam dinheiro ou abrem porta | 1 |
| 12 | **Privacidade, termos, revisão** | Os documentos e o checklist final | 9, 10, 11 |

As fases 6 e 7 não dependem uma da outra nem de nada na frente delas: são as
peças que podem ser intercaladas quando uma fase maior travar.

---

## Fase 0 — a migration, anunciada antes de gerar

> A disciplina da divisão de trabalho é clara: **avise antes de gerar a
> migration.** Duas migrations criadas no mesmo dia colidem na ordem, e desfazer
> isso com dados aplicados é trabalhoso.

Este é o aviso. A Trilha B precisa de **quatro colunas e uma política**, todas
na `0006`, de uma vez só — em vez de uma migration por fase, que multiplicaria
por cinco a chance de colisão.

| Alteração | Por quê |
|---|---|
| `professionals.email` (único) | Não existe login sem um identificador que a pessoa saiba digitar. `auth_user_id` é um UUID. |
| `professionals.password_hash` | O provedor de senha local. Nulo quando a identidade vive no Supabase. |
| `professionals.onboarded_at` | Distingue "conta criada" de "perfil preenchido". Derivar de `specialty is not null` funcionaria hoje e quebraria no dia em que a especialidade virar opcional. |
| `sessions.consent_text` | O Marco 5 pede **texto + carimbo de tempo + método**. Os dois últimos já existem; o texto não. Guardar só "aceitou" é guardar metade de um registro de consentimento: sem o texto, ninguém consegue dizer **com o que** a pessoa concordou. |
| Política `audit_append_own` | A aplicação precisa escrever na trilha de auditoria. Insert-only: quem é auditado pode acrescentar, nunca alterar nem apagar. |

**Não entram**, de propósito:

- `documents.exported_at` — a tela de revisão saber se a nota já saiu em PDF é
  informação da Trilha A. O caminho é a issue, não a coluna. E a trilha de
  auditoria já responde "esta nota foi exportada, quando e por quem".
- Tabela de rate limit — ver Fase 11.
- Índice de busca por trigrama em `patients` — ver Fase 2.

---

## Fase 1 — auth real + onboarding

### A decisão difícil: o Supabase não está disponível para construir contra ele

O plano de desenvolvimento diz **Supabase Auth, região `sa-east-1`**, e a
decisão continua certa para produção. Mas construir *só* contra ele agora tem
dois custos concretos:

1. **Ninguém desenvolve sem projeto provisionado.** Hoje `pnpm dev` sobe com
   `docker compose` e nada mais. Um login que exige um projeto no Supabase
   quebra a partida de todo mundo, inclusive da Trilha A, que não tem nada a
   ver com autenticação.
2. **Não dá para testar o que não se pode subir.** Código de integração
   escrito contra uma API que nunca foi chamada é rascunho, não implementação.

A saída é a que o próprio `lib/auth.ts` já antecipa nos comentários:

> *"Quando o Auth real entrar, muda a origem do `authUserId` — o resto do código
> fica igual."*

Então é exatamente isso que se constrói: **a origem do `authUserId` vira uma
costura com dois provedores.**

```
   /entrar  ·  /cadastrar  ·  /sair
              │
              ▼
   lib/auth/session.ts        cookie assinado (HMAC), HttpOnly, SameSite=Lax
              │                sem segredo no cliente, expira, e é revogável
              ▼
   lib/auth/providers.ts      ┌── password  → scrypt no próprio Postgres
                              └── supabase  → verifica o token no Auth do Supabase
              │
              ▼
   currentAuthUserId()        ← contrato inalterado: tudo abaixo continua igual
```

`AUTH_PROVIDER=password` é o padrão e roda offline. `AUTH_PROVIDER=supabase`
entra quando o projeto existir, sem tocar em nenhuma rota, página ou consulta.

A escolha fica registrada em **ADR-0004**.

### O que entra

- Cadastro com e-mail e senha; hash **scrypt** (`node:crypto`, sem dependência
  nova), com sal por usuário e comparação em tempo constante.
- Sessão em cookie assinado, `HttpOnly`, `Secure` fora de desenvolvimento,
  `SameSite=Lax`, com validade e renovação.
- `middleware.ts` protegendo tudo o que não for público.
- Onboarding: nome, especialidade, conselho + número de registro, **assinatura
  desenhada na tela** (é um produto de celular; pedir upload de arquivo de
  imagem no celular é pedir para a pessoa desistir).
- `UserSwitcher` e `/api/dev-user` **removidos**. Um seletor de usuário sem
  senha ao lado de um login com senha é pior que qualquer um dos dois sozinho.
  O `pnpm db:seed` passa a criar os dois usuários de desenvolvimento **com
  senha**, e o README diz qual é.

---

## Fase 2 — pacientes

CRUD completo (hoje existe só o cadastro mínimo), busca por nome, edição e
arquivamento. Arquivar em vez de apagar: `deleted_at` já existe no schema, e
apagar paciente com consulta gravada destruiria registro clínico.

**Busca:** `ILIKE` simples, sem índice de trigrama. Um profissional autônomo
tem centenas de pacientes, não milhões; `pg_trgm` custaria uma extensão nova em
`00-extensions.sql` — arquivo compartilhado — para resolver um problema que este
produto não tem. Fica registrado aqui para o dia em que tiver.

---

## Fase 3 — consentimento e quota

**Consentimento:** o texto exibido na tela passa a ser versionado no código e
**gravado na sessão**, junto com o método e o carimbo de tempo. O que a pessoa
viu é o que fica registrado.

**Quota — a regra que protege o caixa.** `canProcess()` já existe em
`packages/core/src/account.ts`, pronta e testada, e **ninguém a chama**. A
verificação entra no único lugar onde ela faz efeito: a rota de upload,
**antes** de enfileirar o job. Depois do job criado, o custo já foi
comprometido.

Uma ressalva honesta sobre a duração: quem declara os minutos da sessão no
momento do upload é o dispositivo, e dispositivo mente. A defesa não é confiar
nele, é o formato da conta: o **consumo do mês** vem de `usage_events`, escrito
pelo worker com a duração real medida no áudio. Um cliente que minta sobre uma
sessão passa por ela e é barrado na seguinte — o erro é limitado a uma sessão,
não ao mês. Isso é dito na tela, não escondido.

---

## Fase 4 — gravação endurecida

> *"Subestime este item por sua conta e risco: é onde o mobile real machuca."*

Três falhas distintas, que costumam ser tratadas como uma só:

| Falha | O que acontece hoje | Defesa |
|---|---|---|
| A aba morre no meio (memória, ligação recebida, tela bloqueada) | Perde tudo: os pedaços estão num array em memória | **IndexedDB** — cada pedaço é gravado no dispositivo assim que o `MediaRecorder` o entrega |
| A rede cai no envio | Perde o upload inteiro, e a consulta com ele | **Upload em pedaços com retomada** — o que já subiu fica, e o envio recomeça do primeiro pedaço que faltou |
| O microfone é tomado ou negado | Grava silêncio sem avisar | Verificação de permissão antes, vigia do `track.ended`, `WakeLock`, aviso de bateria |

A ordem importa: **gravar no dispositivo primeiro, enviar depois.** O que nunca
foi escrito localmente não tem como ser recuperado, e é por isso que o buffer
vem antes do transporte.

Ao abrir o app, uma gravação inacabada no IndexedDB é oferecida para envio —
não descartada em silêncio.

---

## Fase 5 — export

- **Copiar para o prontuário**: texto puro, formatado, com os horários das
  citações. É o caminho que serve hoje a todo profissional que já usa outro
  prontuário — e é o que a §10 da documentação chama de "assistente de
  documentação que exporta", a jogada que dispensa a certificação SBIS no MVP.
- **PDF**: documento assinado, com identificação do profissional, conselho e
  registro, paciente, data, as seções da nota, e um rodapé que declara que foi
  produzido com auxílio de IA e revisado por quem assina. Isso não é
  formalidade: é a diferença entre um documento clínico e uma impressão de tela.

O formatador de texto é uma função pura, testada, fora da rota — a mesma
disciplina do resto do repositório.

---

## Fase 6 — PWA

Manifest, ícone, service worker, instalável. Com **uma regra inegociável**:
o service worker **não cacheia nenhuma resposta de API**. Cachear a transcrição
de uma consulta no disco do navegador é criar uma cópia de dado de saúde fora
do controle do sistema, que sobrevive ao logout e vaza no aparelho
compartilhado. Cache só do shell estático.

---

## Fase 7 — telemetria de uso

A tabela `usage_events` já recebe escrita do worker. Falta a tela: minutos do
mês, custo acumulado, quota restante e a lista por sessão. É a instrumentação
que a §11 do plano de desenvolvimento exige "desde o primeiro usuário" — e o
primeiro usuário está mais perto do que o número de itens desta lista sugere.

---

## Fase 8 — auditoria

`audit_log` existe no schema e **ninguém escreve nela**. Entra um helper
`audit()` chamado em cada ponto onde dado clínico é lido, criado, alterado,
exportado ou apagado, e uma tela onde o profissional vê a própria trilha.

Dois cuidados:

- **IDs, nunca conteúdo.** É a regra nº 4 do README, e a trilha de auditoria é
  exatamente onde a tentação de gravar "o que mudou" aparece.
- **Append-only.** A política nova (Fase 0) permite inserir e ler, jamais
  alterar ou apagar. Auditoria que o próprio auditado edita não é auditoria.

---

## Fase 9 — retenção de áudio

Apagar o áudio depois de `AUDIO_RETENTION_DAYS`. Minimização, LGPD Art. 6º — e
também a defesa mais barata que existe: dado apagado não vaza.

⚠️ **É a única tarefa desta trilha que toca um arquivo da Trilha A**, e a
divisão de trabalho é quem manda fazer assim: *"é um handler novo no worker,
registrado ao lado de `transcribe` e `generate_note`"*. O handler é novo, o
acréscimo em `apps/worker/src/index.ts` é a linha de registro que o próprio
`index.ts` já deixou comentada à espera, e o CODEOWNERS pede a revisão do dono
automaticamente. Nada além disso é tocado no worker.

---

## Fase 10 — LGPD Art. 18

- **Portabilidade**: exportar tudo o que é do profissional — perfil, pacientes,
  sessões, transcrições, documentos, uso — em JSON legível por máquina.
- **Exclusão de conta**: apaga o áudio do armazenamento, apaga os registros,
  apaga a identidade. A trilha de auditoria da exclusão **sobrevive** — e pode
  sobreviver porque `audit_log.professional_id` não tem chave estrangeira; foi
  desenhada assim.

A exclusão pede confirmação digitada, e não um clique: é a ação mais destrutiva
do produto e não pode acontecer por toque errado.

---

## Fase 11 — rate limiting

Teto por profissional e por IP em: login (força bruta), upload e finalização
(custo de processamento), geração de nota e objetivo (custo de LLM),
exportação de dados (custo de banco).

**Em memória, no processo**, atrás de uma interface. Isso é suficiente e
honesto para o desenho de hoje — um processo web, um worker, um servidor. Com
mais de uma instância, um limitador em memória vira um limitador por instância;
quando isso acontecer, a implementação em Postgres entra atrás da mesma
interface. O que não é aceitável é não ter nenhum.

---

## Fase 12 — privacidade, termos e a revisão final

Política de privacidade e termos com os **subprocessadores listados** — e a
lista é honesta sobre o que o motor escolhido implica. O motor `local` não tem
subprocessador nenhum: é o argumento de confiança mais forte do produto, e ele
só vale escrito.

Fecha com o checklist de revisão de segurança antes do primeiro usuário real.

---

## Como isto é verificado

A cada fase, sem exceção:

```bash
pnpm check          # formato, lint, tipos, testes
pnpm db:test-rls    # 17 asserções adversariais (mais as que a Fase 0 acrescenta)
```

Um branch por fase, PR para `main`, commits em inglês explicando o *porquê*,
comentários e interface em português.

---

## O que esta trilha explicitamente NÃO faz

Para que ninguém precise perguntar:

- Não toca em `packages/core/`, `apps/worker/` (salvo a Fase 9, acima),
  `services/asr-local/`, `packages/db/src/seed-demo.ts` nem nos cinco
  componentes de revisão listados no CODEOWNERS.
- Não mexe em prompt, validação de citação, atribuição de papel ou qualquer
  coisa que decida o que a IA afirma.
- Não escolhe fornecedor de nuvem (ADR-0002 é da Trilha A).
- Não implementa WhatsApp, Memed, multiusuário nem biblioteca de objetivos:
  é Fase 2 do produto, não Marco 5.
