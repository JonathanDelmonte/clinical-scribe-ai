# Divisão de trabalho — duas trilhas em paralelo

> Companheiro de [PLANO-DE-DESENVOLVIMENTO.md](./PLANO-DE-DESENVOLVIMENTO.md).
> Criado em 15/09/2026 · Para quando duas pessoas trabalham no mesmo repositório.

---

## O princípio

> **Divida por contrato, não por arquivo.**

Duas pessoas em código só acelera quando cada uma consegue trabalhar uma semana
inteira **sem precisar perguntar nada à outra**. Se a divisão obriga a combinar
detalhes toda hora, o segundo desenvolvedor deixa o projeto mais lento, não mais
rápido — porque o tempo de coordenação cresce mais rápido que o tempo economizado.

A boa notícia é que este repositório já tem a costura pronta, e ela não foi
desenhada para isto: é o **banco de dados**.

```
        TRILHA B — o produto ao redor
        login · pacientes · consentimento · PDF · quota · PWA · LGPD
                              │
        ══════════════════════╪══════════════════════  ← o contrato
         schema Drizzle · migrations · políticas RLS
         congelado, testado por 17 asserções adversariais
        ══════════════════════╪══════════════════════
                              │
        TRILHA A — o motor
        áudio · Whisper · diarização · papel · nota ancorada
```

Tudo acima da linha lê e escreve as mesmas tabelas. Tudo abaixo também. Nenhum
dos dois precisa saber como o outro funciona — só que a tabela está lá, e que as
políticas RLS garantem que ninguém vê dado de outro profissional.

---

## As duas trilhas

| | **Trilha A — o motor** | **Trilha B — o produto** |
|---|---|---|
| **Marcos** | 4 (fechar) + camada do navegador | **5 e 6** |
| **Tamanho** | ~1,5 semana | **~3-4 semanas** |
| **Precisa de GPU?** | sim | **não** |
| **Precisa de token do Hugging Face?** | sim | **não** |
| **Precisa de chave de LLM?** | sim | **não** |
| **Precisa de Docker?** | sim (Postgres + ASR com CUDA) | só Postgres |

A Trilha B é maior em calendário e **menor em risco**: é trabalho conhecido, que
leva tempo mas não falha. A Trilha A é curta e incerta — é onde o produto ainda
pode não funcionar.

---

## Trilha B — o escopo completo

### Marco 5 — o produto ao redor

- [ ] **Auth real** substituindo o seletor de usuário de desenvolvimento
      (`UserSwitcher`). Supabase Auth, região `sa-east-1`.
- [ ] **Onboarding**: perfil, especialidade, registro profissional, assinatura
- [ ] **CRUD de pacientes com busca** — hoje existe só o cadastro mínimo
- [ ] **Gravação no navegador endurecida**: upload em pedaços, retomada se a rede
      cair, aviso de bateria e de permissão de microfone.
      *Este item parece pequeno e não é. É onde o mobile real machuca.*
- [ ] **Pasta do paciente** com histórico de sessões
- [ ] **Registro de consentimento** antes de gravar (texto + carimbo de tempo + método)
- [ ] **Export**: PDF e "copiar para o prontuário"
- [ ] **Quota do plano grátis verificada ANTES de processar** — nunca depois,
      senão o custo já foi pago quando o limite é descoberto
- [ ] **PWA**: manifest, service worker, instalável, ícone
- [ ] **Telemetria de custo por sessão** — a tabela `usage_events` já existe e já
      recebe dados; falta a tela que os lê

### Marco 6 — endurecimento e LGPD

- [ ] Trilha de auditoria (`audit_log` já existe no schema, ninguém escreve nela)
- [ ] Retenção: apagar o áudio após `AUDIO_RETENTION_DAYS` — é um handler novo no
      worker, registrado ao lado de `transcribe` e `generate_note`
- [ ] Exclusão de conta e portabilidade (LGPD Art. 18)
- [ ] Política de privacidade e termos, com subprocessadores listados
- [ ] Rate limiting nas rotas caras
- [ ] Revisão de segurança antes do primeiro usuário real

> Os testes de RLS do Marco 6 **já estão prontos** (`pnpm db:test-rls`, 17
> asserções). Rode-os sempre que mexer no schema.

---

## Como começar na Trilha B, sem GPU

Cinco comandos. Nenhum precisa de placa de vídeo, token do Hugging Face ou chave
de LLM.

```bash
pnpm install
cp .env.example .env     # basta a DATABASE_URL, que já vem preenchida
pnpm db:up               # Postgres em container, porta 5433
pnpm db:migrate && pnpm db:seed
pnpm db:demo             # ← a peça que torna isto possível
```

Depois, em dois terminais:

```bash
pnpm dev
```

`pnpm db:demo` grava no banco uma **consulta completa e fictícia**: paciente,
sessão transcrita, 26 trechos com papéis atribuídos, e uma nota clínica gerada —
inclusive com uma citação fabricada de propósito, para que o estado de erro da
tela seja visível sem precisar quebrar nada.

É o que desacopla as duas trilhas. Sem isso, mexer num botão da tela de revisão
exigiria dez minutos de processamento em GPU para ver o resultado.

**O que não funciona no modo demo, e é esperado:**

- Ouvir a citação não toca áudio (não há arquivo de áudio no exemplo)
- Gravar uma sessão nova falha (não há serviço de ASR rodando)
- O botão "Gerar nota de novo" falha (não há chave de LLM)

Nada disso atrapalha o Marco 5. Se em algum momento você precisar de uma sessão
de verdade, avise — dá para gerar uma e mandar só o resultado.

---

## Quem mexe em quê

**A Trilha A é fechada. Ninguém da Trilha B altera esses arquivos — em hipótese
alguma, nem para uma correção de uma linha.**

Isso não é hierarquia nem desconfiança. É que a Trilha A contém os mecanismos
que impedem o produto de inventar informação clínica, e esses mecanismos falham
de um jeito particular: **quando quebram, continuam funcionando.**

Um exemplo concreto, do próprio repositório. A conferência de citações marca uma
afirmação sem fonte como problema bloqueante:

```ts
const blocking = issues.filter((i) => i.kind !== "duplicate_source");
```

Alguém ajustando um alerta que aparece demais pode, com toda a boa intenção,
transformar isso em `i.kind === "unknown_segment"`. Os testes passam. A tela
continua bonita. E afirmação sem nenhuma âncora no áudio passa a ser aceita em
silêncio — que é exatamente o caso dos 62% de achados fabricados que os médicos
não perceberam na revisão (§11 da documentação).

Nenhuma revisão de código apressada pega isso. Quem escreveu a regra pega em
cinco segundos. Por isso a barreira é de propriedade, não de bom senso.

### Trilha B é dona de — pode mexer à vontade

```
apps/web/src/app/           exceto sessoes/[id]/
apps/web/src/components/    exceto os cinco listados abaixo
apps/web/src/lib/auth.ts    (a substituição do seletor de dev é sua)
packages/db/sql/rls.sql     (políticas novas para tabelas novas)
docs/                       privacidade, termos
```

### Trilha A — FECHADA

```
packages/core/                       domínio, prompts, validação, papéis
apps/worker/                         pipeline, LLM, fila
services/asr-local/                  Whisper, pyannote, diarização
packages/db/src/seed-demo.ts         o exemplo de desenvolvimento

apps/web/src/components/SessionView.tsx
apps/web/src/components/ClinicalNote.tsx
apps/web/src/components/SpeakerRoles.tsx
apps/web/src/components/SessionProgress.tsx
apps/web/src/components/VoiceEnrollment.tsx
```

### Precisa de uma mudança na Trilha A? O processo

Vai acontecer, e é normal — a tela de revisão precisa de um campo novo, o
handler precisa devolver mais um dado. O caminho é este:

1. **Não edite.** Nem para testar localmente num commit que "depois eu reverto".
2. **Abra uma issue** descrevendo o que você precisa **em termos de resultado**,
   não de implementação: *"a tela de revisão precisa saber se a nota já foi
   exportada em PDF"* — não *"adicione um campo `exported` em ClinicalNote"*.
3. **Siga trabalhando no resto.** A dependência raramente bloqueia a tarefa
   inteira; costuma bloquear um pedaço.
4. **O dono da Trilha A implementa e avisa.**

O passo 2 é o que faz isso funcionar em vez de virar gargalo: descrevendo o
resultado, quem conhece o código escolhe o caminho — que muitas vezes é mais
curto do que o pedido supunha, e às vezes já existe.

### Fronteira compartilhada — avise antes

```
packages/db/src/schema.ts   migration nova = avisa ANTES de gerar
package.json / pnpm-workspace.yaml
.env.example
```

Mudança de schema é o único ponto onde as trilhas realmente se encostam, e as
duas podem precisar dela. A disciplina: **avise antes de gerar a migration.**
Duas migrations criadas no mesmo dia colidem na ordem, e desfazer isso com dados
já aplicados é trabalhoso.

### Como isso é verificado — automaticamente

A lista acima está em [`.github/CODEOWNERS`](../.github/CODEOWNERS). O GitHub
lê esse arquivo e **pede revisão do dono automaticamente** sempre que um PR toca
um caminho da Trilha A. Ninguém precisa lembrar da regra nem conferir a lista de
arquivos à mão.

Para o GitHub **bloquear** o merge, e não só pedir revisão, ligue uma vez:

> Settings → Branches → Add rule para `main`
> ☑ Require a pull request before merging
> ☑ Require review from Code Owners

Sem isso, a revisão é pedida mas o merge passa assim mesmo.

---

## Como trabalhar sem se atrapalhar

- **Um branch por tarefa**, PR para `main`. Nada direto na `main`.
- **`pnpm check` antes de abrir o PR** — formato, lint, tipos e testes. O CI roda
  o mesmo; falhar nele depois é só demora a mais.
- **`pnpm db:test-rls` sempre que mexer no schema.** Uma política mal escrita é
  vazamento de dado de saúde, e o teste existe exatamente para isso.
- **Commits em inglês**, mensagem explicando o *porquê*. O código já mostra o quê.
- **Comentário e interface em português.** O produto é brasileiro.

---

## ⚠️ O que nunca sai desta máquina

Esta parte não é burocracia. São dados de saúde e credenciais.

| Item | Por quê |
|---|---|
| **`.env`** | Contém o token do Hugging Face, a chave de LLM e a senha do banco. Está no `.gitignore`. **Nunca mande por mensagem** — cada um gera as suas. |
| **`.storage/`** | Áudio de consulta. Também no `.gitignore`. |
| **A gravação de teste real** | Mesmo sendo de um vídeo público, não vai para o repositório nem para ninguém. |
| **Transcrições reais** | Idem. O `pnpm db:demo` existe justamente para ninguém precisar delas. |

O repositório em si pode ser compartilhado à vontade — ele não contém nada disso.

### Sobre o LLM gratuito

O `.env.example` vem com `LLM_DATA_POLICY="contractual"`, que **recusa** o nível
gratuito do Google. Isso é de propósito: o nível grátis treina com os prompts
enviados, e mandar consulta de paciente para lá é uso secundário de dado sensível
de saúde sem base legal (LGPD Art. 11).

Na Trilha B você não precisa de LLM nenhum. Se em algum momento precisar, use
`training` **apenas** com o áudio fictício do `pnpm db:demo`.

---

## O que já está pronto, para não refazer

| Já existe | Onde |
|---|---|
| Schema completo, 9 tabelas, migrations 0000–0004 | `packages/db/src/schema.ts` |
| RLS com 17 asserções adversariais | `packages/db/sql/rls.sql` · `pnpm db:test-rls` |
| Fila de jobs com retry e backoff | `apps/worker/src/queue.ts` |
| Armazenamento de áudio atrás de interface | `packages/storage/` |
| Papéis, planos e motores como eixos independentes | `packages/core/src/account.ts` |
| Upload de áudio, gravação básica, progresso detalhado | `apps/web/src/components/` |
| Transcrição + diarização + identificação de papel | funcionando ponta a ponta |
| Nota ancorada com conferência determinística | `packages/core/src/note.ts` |
| Scripts de subida no Windows | `atalhos/` |

`usage_events` e `audit_log` **existem no schema e estão vazias**. A primeira já
recebe escrita do worker; a segunda ainda não recebe de ninguém. São duas das
tarefas da Trilha B, e as tabelas já estão no lugar.
