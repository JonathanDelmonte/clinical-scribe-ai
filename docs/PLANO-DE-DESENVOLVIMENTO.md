# Plano de Desenvolvimento — Consulta Viva

> Companheiro de [DOCUMENTACAO.md](./DOCUMENTACAO.md), que define **o quê** e **por quê**.
> Este documento define **como** e **em que ordem**.
> Criado em 15/09/2026 · Status: proposta inicial

---

## Princípio que ordena tudo

> **Ataque o risco desconhecido antes do trabalho conhecido.**

O MVP tem duas naturezas de trabalho misturadas:

| Natureza | O que é | Risco |
|---|---|---|
| **Conhecido** | Auth, CRUD de pacientes, PWA, upload, export PDF, cobrança | Baixo — é execução. Leva tempo, mas não falha. |
| **Desconhecido** | Diarização em pt-BR com áudio real de consultório; identificação de papel; nota ancorada sem alucinar | **Alto** — pode simplesmente não funcionar bem o bastante. |

A ordem natural ("começar pelo login") constrói seis semanas de trabalho conhecido antes de descobrir se o desconhecido funciona. A ordem certa inverte isso: **as duas primeiras semanas respondem às perguntas que podem matar o produto**, usando scripts descartáveis, sem app, sem banco, sem interface.

Se o spike falhar, você perdeu duas semanas — não dois meses.

---

## Estado atual — 22/09/2026

> Atualize esta tabela ao fechar cada marco. Um plano que não diz onde o projeto
> está é um plano que ninguém consulta.

| Marco | Estado | O que falta |
|---|---|---|
| **0** — Fundação | ✅ completo | — |
| **1** — Spike de ASR ⭐ | ✅ **no que decide** | Os 4 fornecedores de nuvem não foram medidos. O motor local passou no portão de qualidade, o que responde à pergunta que podia matar o produto. ADR-0002 segue aberto para o dia em que o `cloud` for necessário. |
| **2** — Esqueleto andante | ✅ completo | — |
| **3** — Papel | ✅ **completo, e além** | Método B **e** Método A (impressão vocal), que o plano só previa se B ficasse abaixo de 95%. Ver a ressalva de calibração abaixo. |
| **4** — Nota ancorada ⭐ | ✅ **funcional** | Verificador de suporte (2ª passada); edição livre da nota; aprovação com clique; execução do objetivo da sessão como geração separada. |
| **5** — Produto ao redor | ✅ completo | Auth real, onboarding, CRUD de pacientes com busca, gravação endurecida, consentimento versionado, export em texto e PDF, quota antes de processar, PWA, telemetria de custo. Ver [PLANO-TRILHA-B.md](./PLANO-TRILHA-B.md). |
| **6** — Endurecimento e LGPD | ✅ **completo, com pendências nomeadas** | Auditoria, retenção de áudio, portabilidade e exclusão de conta, rate limiting, privacidade e termos. As 8 pendências de segurança estão listadas e justificadas em [REVISAO-DE-SEGURANCA.md](./REVISAO-DE-SEGURANCA.md) — nenhuma é bloqueante para o primeiro usuário, e todas precisam de decisão antes de escalar. |

### Fila da Trilha A — o que vem depois

1. **Correção da transcrição pelo profissional** — clicar num trecho, corrigir
   o que o Whisper ouviu errado, salvar. O texto original nunca é apagado: o
   par (errado → certo) é dado rotulado, gerado pelo uso, que nenhum
   concorrente tem sem ter usuários antes. Exige migration.
2. **Chave de IA do próprio profissional** — ver [ADR-0003](./adr/0003-chave-de-ia-do-usuario.md).
3. **Vocabulário do domínio no Whisper** — `initial_prompt` com nomes de
   medicamentos e jargão da especialidade. É a melhoria de qualidade mais barata
   que existe: uma linha, custo zero, ataca a classe de erro "azar/arder".
4. **Limpeza de áudio só para o caminho das vozes** — limpar antes do Whisper
   frequentemente PIORA a transcrição (ele foi treinado em áudio sujo), mas o
   pyannote é o oposto. Bifurcar: áudio cru para o Whisper, limpo para a
   diarização e a impressão vocal.
5. **Verificador de suporte** — segunda passada que confere se o trecho citado
   sustenta a afirmação. **Adiado de propósito:** medir a frequência do problema
   antes de gastar uma chamada por nota.

**Os dois marcos ⭐ estão vencidos**, e o trabalho conhecido dos Marcos 5 e 6
também: a Trilha B fechou as doze fases do
[PLANO-TRILHA-B.md](./PLANO-TRILHA-B.md).

O que resta para o MVP não é mais construção — é a fila da Trilha A acima, a
decisão de fornecedor de nuvem (ADR-0002) e as pendências nomeadas na
[revisão de segurança](./REVISAO-DE-SEGURANCA.md).

### Três medições que mudaram o plano

**1. O motor local é mais rápido do que este documento supunha.** A §1 previa
10 a 40 minutos para uma consulta de 30 em CPU. Medido em GPU, com inferência
sequencial: **12,8x o tempo real** em áudio limpo, **3,4x** em áudio real de
consultório. Uma consulta de 30 minutos sai em 2 a 9 minutos. O plano grátis
fecha com folga — ver ADR-0002 para a tabela completa.

**2. Inferência em lote trunca o áudio em silêncio.** 27x de velocidade, HTTP
200, texto coerente — e o final da consulta ausente. Desligada. Correção vale
mais que o dobro de velocidade quando o que some é a conduta.

**3. A impressão vocal (Método A) cede em áudio real.** Separação entre as vozes:
**0,66** em gravação limpa, **0,17** em consulta com máscara e microfone de
celular. Abaixo de 0,30 a correção fala a fala é desligada, e só a escolha no
nível do falante — que é média sobre dezenas de trechos — continua valendo. O
Método A ajuda; ele não sustenta o peso sozinho.

### O que ainda não funciona bem

**Atribuição fala a fala em áudio ruim.** O pyannote acerta *quantos* falantes
existem e erra *onde* cada um começa: na consulta real medida, 49 de 147 turnos
ficaram abaixo de 0,7 s. O papel no nível do falante está certo; algumas falas
individuais aparecem atribuídas à pessoa errada. Nem pós-processamento por
conteúdo nem a camada de voz resolvem nessa qualidade de áudio — é o item aberto
mais relevante do motor.

---

## Sumário

1. [Decisões de stack](#1-decisões-de-stack)
2. [Marco 0 — Fundação](#marco-0--fundação-2-3-dias)
3. [Marco 1 — Spike de ASR e diarização](#marco-1--spike-de-asr-e-diarização-1-semana) ⭐
4. [Marco 2 — Esqueleto andante](#marco-2--esqueleto-andante-1-semana)
5. [Marco 3 — Identificação de papel](#marco-3--identificação-de-papel-3-4-dias)
6. [Marco 4 — Nota ancorada](#marco-4--nota-ancorada-1-2-semanas) ⭐
7. [Marco 5 — O produto ao redor](#marco-5--o-produto-ao-redor-2-3-semanas)
8. [Marco 6 — Endurecimento e LGPD](#marco-6--endurecimento-e-lgpd-1-semana)
9. [Modelo de dados inicial](#9-modelo-de-dados-inicial)
10. [Estrutura do repositório](#10-estrutura-do-repositório)
11. [Economia unitária — o número que decide o freemium](#11-economia-unitária)
12. [O que fazer em paralelo (não-código)](#12-o-que-fazer-em-paralelo)
13. [Critérios de aborto](#13-critérios-de-aborto)

---

## 1. Decisões de stack

Recomendações com justificativa. Cada uma vira um ADR em `docs/adr/` quando confirmada.

| Camada | Escolha | Por quê |
|---|---|---|
| **Monorepo** | pnpm workspaces + TypeScript | pnpm já instalado; workspaces evitam o inferno de publicar pacotes internos. |
| **Front-end** | Next.js (App Router) + React + Tailwind | PWA mobile-first, um só deploy, SSR para as páginas de marketing. Solo dev não tem orçamento para manter front e back separados. |
| **API** | Route Handlers do Next.js (BFF) | Evita um segundo serviço no MVP. Se crescer, extrai-se depois. |
| **Worker** | Processo Node separado, container próprio | Transcrição leva minutos. **Não pode** rodar em serverless com timeout. Este é o único serviço que precisa viver fora do Next. |
| **Fila** | Tabela no Postgres com `FOR UPDATE SKIP LOCK` (ou `pgmq`) | Zero infra nova. Redis/SQS só quando o volume justificar. |
| **Banco + Auth + Storage** | **Supabase, região São Paulo (`sa-east-1`)** | Ver nota abaixo — é a decisão de maior alavancagem do projeto. |
| **ORM** | Drizzle | SQL-first, convive bem com políticas RLS escritas à mão. Prisma abstrai demais justamente onde você precisa de controle. |
| **ASR + diarização** | **A definir pelo Marco 1** | Não decidir por leitura de site. Decidir por medição. |
| **LLM da nota** | API com saída estruturada (JSON Schema) + contrato de não-treinamento | Ver [Marco 4](#marco-4--nota-ancorada-1-2-semanas) para o mecanismo anti-alucinação. |
| **Testes** | Vitest (unidade) + Playwright (e2e do loop crítico) | |
| **CI** | GitHub Actions: typecheck, lint, teste, migration dry-run | |

### Por que Supabase em São Paulo

Não é preferência de ferramenta, é a soma de quatro requisitos da documentação resolvidos por uma escolha só:

1. **Isolamento multi-tenant rígido** (§6.3 da doc: *"a busca precisa ser filtrada por dono no nível de dados, não só na interface"*) → **Row Level Security** do Postgres faz exatamente isso. A política vive no banco; nem um bug de aplicação nem uma query esquecida vazam dados de outro profissional.
2. **Dados no Brasil** → região `sa-east-1` existe.
3. **`pgvector` para o assistente RAG futuro** (§6.3-A) → extensão nativa, zero migração depois.
4. **Storage criptografado para áudio** com as mesmas políticas de acesso.

O custo disso é acoplamento a um fornecedor. Mitigação: é Postgres puro por baixo — o schema, as migrations e as políticas RLS são portáveis. O que prende é Auth e Storage, e ambos são substituíveis com ~1 semana de trabalho se necessário.

### ⚠️ O conflito de residência de dados

A documentação vende **"dados hospedados no Brasil"** como recurso de confiança (§10) e sugere **AssemblyAI / Deepgram / AWS HealthScribe** como fornecedores de ASR (§8). **Os três são hospedados fora do Brasil.** O áudio da consulta — o dado mais sensível do sistema — sairia do país.

Isso não é ilegal: a LGPD (Art. 33) permite transferência internacional com salvaguardas. Mas exige que você:

- liste os **subprocessadores** na política de privacidade;
- tenha **cláusulas contratuais** adequadas com cada um;
- **não afirme** "seus dados ficam no Brasil" se o áudio é processado nos EUA — isso é o tipo de promessa que vira reclamação na ANPD.

**Três saídas, em ordem de preferência:**

| Saída | Efeito | Custo |
|---|---|---|
| **A. Fornecedor com região no Brasil** — Google STT v2 (`southamerica-east1`) ou Azure Speech (Brazil South) | Claim de marketing fica verdadeiro e íntegro | Precisa validar qualidade de diarização em pt-BR — é justamente o que o Marco 1 faz |
| **B. Fornecedor estrangeiro + divulgação honesta** | Claim vira *"armazenamento no Brasil; processamento por subprocessadores listados"* | Mais fraco na venda, mas legítimo |
| **C. Whisper + pyannote auto-hospedado em GPU no Brasil** | Residência total + margem em escala | Caro e prematuro no dia 1 — a própria doc alerta contra (§8) |

**Por isso o Marco 1 testa Google e Azure junto com AssemblyAI e Deepgram.** Se um fornecedor com região brasileira entregar qualidade comparável, a saída A é gratuita e o diferencial de confiança fica real.

---

## Marco 0 — Fundação (2-3 dias)

Infraestrutura mínima para que todo o resto tenha onde acontecer.

- [ ] Commit inicial; `.gitignore`, `LICENSE`, `README.md`
- [ ] Monorepo pnpm com a estrutura da [seção 10](#10-estrutura-do-repositório)
- [ ] TypeScript strict, ESLint, Prettier, `.editorconfig`
- [ ] GitHub Actions: `typecheck` + `lint` + `test` em cada PR
- [ ] Projeto Supabase em `sa-east-1`; `.env.example` documentado
- [ ] `docs/adr/` com ADR-0001 (stack) registrado
- [ ] Docker Compose com Postgres local (`pgvector` habilitado) para desenvolvimento offline

**Feito quando:** `pnpm install && pnpm typecheck && pnpm test` passa em um clone limpo e o CI está verde.

---

## Marco 1 — Spike de ASR e diarização (1 semana) ⭐

**Este é o marco mais importante do projeto.** Nenhuma linha de app é escrita aqui. É um diretório Python descartável em `spikes/asr-bench/` cuja única saída é uma tabela de números e um ADR.

### Pergunta que ele responde

> Existe um fornecedor que transcreva e separe vozes em português brasileiro, em áudio real de consultório, com qualidade suficiente e custo viável — e, de preferência, sem tirar o áudio do país?

### Comece pelo local — é grátis e responde três perguntas de uma vez

**Ordem: Whisper + pyannote na sua própria máquina, primeiro.** Sem chave de API, sem cartão, sem cadastro. Whisper large-v3 é genuinamente muito bom em português — frequentemente melhor que as APIs comerciais — e pyannote 3.1 é o estado da arte aberto em diarização.

Rodar local responde três coisas ao mesmo tempo:

1. **A qualidade serve?** (o portão que decide se o produto existe)
2. **O plano grátis fecha?** Se a transcrição roda no seu servidor, o custo marginal por consulta grátis cai para perto de zero — vira custo fixo de servidor, não custo por uso. Ver [§11](#11-economia-unitária).
3. **A residência de dados se sustenta?** O áudio nunca sai do seu servidor. O claim "dados no Brasil" fica verdadeiro sem depender de fornecedor nenhum.

O custo é velocidade: em CPU, uma consulta de 30 minutos leva de 10 a 40 minutos para processar. Para um plano grátis em que a nota chega por notificação em vez de na hora, isso é aceitável. Medir esse tempo na sua máquina é parte do spike.

> **Isto contradiz a documentação?** Não. A §8 alerta contra *construir* ASR — e está certa. Baixar um modelo pronto e rodá-lo num container não é construir ASR; é usar uma biblioteca. São coisas diferentes, com custos diferentes.

### Fornecedores a medir, nesta ordem

| Ordem | Fornecedor | Região BR? | Por que nesta posição |
|---|---|---|---|
| **1º** | **Whisper large-v3 + pyannote 3.1 (local)** | 🏠 total | Grátis, sem cadastro, e é o candidato a motor do plano grátis |
| 2º | Google STT v2 (`southamerica-east1`) | ✅ | Se o local for lento demais, este mantém a residência |
| 3º | Azure Speech (Brazil South) | ✅ | Idem |
| 4º | AssemblyAI | ❌ | Régua de qualidade do mercado |
| 5º | Deepgram | ❌ | Régua de custo e latência |

Só desça na lista se o de cima não passar. Se o local resolver, você economiza o spike inteiro dos pagos.

> Confirme região, suporte a pt-BR e preço vigente na documentação de cada fornecedor no momento do spike — não confie nesta tabela para decisão de contrato.

### Corpus de teste — a versão barata

**Passo 1 — o teste do olho (≈2 horas).** Grave **2 consultas simuladas** de 8 minutos. Rode nos candidatos. **Leia as saídas lado a lado.**

Você não precisa de número nenhum para ver que um fornecedor colocou a fala do profissional na boca do paciente. Se um for visivelmente melhor, a decisão está tomada e você para aqui.

**Passo 2 — só se ficar empatado (≈2 horas a mais).** Aí sim vale medir. E há um truque que elimina a parte cara do trabalho:

> **Grave cada pessoa num microfone separado** — dois celulares, ou um microfone USB mais o do notebook. Some os canais para criar o arquivo de teste (que soa como gravação de um microfone só), e guarde os canais separados. **Eles são o gabarito de quem-falou-quando, perfeito e de graça.**

Isso entrega DER e cpWER sem rotular nada à mão. Sobra só o texto para o WER — e aí você **corrige** a saída do melhor fornecedor em vez de digitar do zero, o que é umas três vezes mais rápido.

**Cenários, em ordem de importância** — três bastam:

| # | Cenário | Por que importa |
|---|---|---|
| 1 | 1:1, sala silenciosa | Piso: se falhar aqui, o fornecedor está fora |
| 2 | Celular na mesa + ruído de fundo | O consultório real, mobile-first |
| 3 | Profissional + paciente + **acompanhante** | 3 falantes — o diferencial prometido |

> **Correção honesta:** a primeira versão deste plano pedia 6 a 10 gravações com transcrição manual completa — umas 8 horas. Isso é rigor de artigo acadêmico para uma decisão de sim-ou-não. O caminho acima custa 2 a 4 horas e decide a mesma coisa.

### Métricas (só no passo 2)

- **WER** — qualidade da transcrição
- **cpWER** — *concatenated minimum-permutation WER*. **Reporte sempre junto com o DER.** A doc (§7) traz o caso de "15% DER com 31% cpWER": o DER parecia ótimo enquanto um terço das palavras estava atribuída ao falante errado. Use o pacote `meeteval`.
- **DER** — via `pyannote.metrics`
- **Custo por minuto** de áudio, medido na fatura real
- **Latência** em lote (e em streaming, se houver intenção de tempo real)
- **Acurácia em termos clínicos** — conte à mão os erros em nomes de medicamentos e dosagens. É onde o erro é perigoso.

### Entregável

`docs/adr/0002-fornecedor-asr.md`, com a tabela completa e a decisão justificada.

### Portão de qualidade

| Métrica | Mínimo aceitável | Comentário |
|---|---|---|
| WER (cenários 1-2) | < 15% | Acima disso a revisão custa mais que digitar |
| cpWER (cenário 3) | < 25% | O caso do acompanhante é o diferencial prometido |
| Custo | < R$ 1,00 / consulta de 30 min | Senão o plano grátis é inviável ([§11](#11-economia-unitária)) |

**Nenhum fornecedor passa?** Vá para os [critérios de aborto](#13-critérios-de-aborto) antes de escrever mais código.

---

## Marco 2 — Esqueleto andante (1 semana)

O *walking skeleton*: a fatia mais fina possível que atravessa **todas** as camadas. Feio de propósito.

```
upload de um .wav  →  job na fila  →  worker chama o fornecedor
     →  segmentos salvos no Postgres  →  linha do tempo rotulada na tela
```

- [ ] Schema inicial + migrations ([seção 9](#9-modelo-de-dados-inicial))
- [ ] **Políticas RLS desde o primeiro dia** — nunca "depois"; retrofitar RLS em schema existente é doloroso e é onde vazamentos nascem
- [ ] Storage: upload de áudio com URL assinada
- [ ] Tabela de jobs + worker com *polling* e retry
- [ ] Integração com o fornecedor escolhido no Marco 1
- [ ] Página crua que lista os segmentos com falante e timestamp

Sem beleza, sem auth elaborada, sem tratamento de erro sofisticado. **Prova que o tubo inteiro funciona ponta a ponta.**

**Feito quando:** você sobe um arquivo pelo navegador e vê a transcrição separada por falante aparecer sozinha.

---

## Marco 3 — Identificação de papel (3-4 dias)

Transformar `Falante 1 / Falante 2` em `PROFISSIONAL / PACIENTE / OUTRO`.

### Recomendação: comece só com o Método B

A documentação (§7) recomenda combinar **A** (impressão vocal cadastrada) + **B** (classificação por conteúdo via LLM). A combinação é o destino certo — mas **não no MVP**.

**Por quê:** o Método B sozinho é um prompt de ~30 linhas sobre a transcrição já diarizada. Não exige *embeddings* de voz, nem infraestrutura de ML, nem — e este é o ponto — **pedir ao profissional que grave uma amostra de voz no cadastro**. Esse passo é fricção pura num fluxo de onboarding, exatamente onde se perde conversão.

E o sinal linguístico é esmagador: quem pergunta *"há quanto tempo você sente isso?"* e quem responde *"faz uns três dias"* não se confundem. O Método A resolve um problema que o B provavelmente já resolve sozinho.

**Plano:** implemente B, **meça a acurácia** no corpus do Marco 1. Só adicione A se B ficar abaixo de ~95%.

- [ ] Prompt de classificação de papel sobre o transcrito diarizado
- [ ] Medir acurácia nos 6 cenários do corpus
- [ ] Correção manual na interface (o profissional troca o rótulo se errar) — **rede de segurança obrigatória**, independente da acurácia
- [ ] Registrar as correções: são os dados que dizem se o Método A vale o esforço

---

## Marco 4 — Nota ancorada (1-2 semanas) ⭐

O segundo marco crítico. Aqui mora a diferença entre um produto confiável e um gerador de texto plausível.

### O mecanismo anti-alucinação

A documentação (§11) mostra o número que assusta: **62% dos achados de exame físico fabricados passaram despercebidos** na revisão do médico — porque soavam críveis. Prompt pedindo "não invente" não resolve isso. Arquitetura resolve.

**A técnica central: cite IDs, nunca timestamps.**

```
Prompt recebe:
  [seg_a1f3] PROFISSIONAL (00:32): "Há quanto tempo você sente essa dor?"
  [seg_b8e2] PACIENTE     (00:38): "Uns três dias, começou depois do treino"
  ...

Saída estruturada obrigatória (JSON Schema):
  {
    "queixa_principal": {
      "texto": "Dor lombar há 3 dias, início após atividade física",
      "fontes": ["seg_b8e2"]           ← só pode COPIAR IDs que existem
    }
  }
```

Por que isso funciona: se você pedir timestamps, o modelo **gera números** — e números gerados são plausíveis e errados. Se você pedir IDs opacos de uma lista fechada, ele só pode copiar. Qualquer ID que não exista na lista é detectado por validação determinística, sem IA no meio.

### Camadas de defesa

1. **Saída estruturada** com `fontes: string[]` obrigatório em toda afirmação clínica
2. **Validação determinística** — todo ID citado existe? Senão, rejeita e reprocessa
3. **Verificação de suporte** — segunda passada barata: o trecho citado sustenta a afirmação? Sinaliza divergência
4. **Seção omitida > seção inventada** — o prompt instrui a omitir o que não está no áudio, nunca preencher
5. **Rascunho até aprovação** — nada é salvo como documento sem clique explícito do profissional

### Interface de revisão

- Clique numa frase → destaca os segmentos-fonte → toca aquele trecho do áudio
- Afirmações sem fonte ou com verificação divergente aparecem **visualmente marcadas**
- Edição livre; a edição do profissional é a verdade final

- [ ] Prompt + JSON Schema da nota (SOAP/anamnese) para a especialidade escolhida
- [ ] Validador de citações (determinístico)
- [ ] Verificador de suporte (LLM barato, segunda passada)
- [ ] Execução do **objetivo** da sessão como geração adicional, com as mesmas regras
- [ ] Interface de revisão com áudio ancorado
- [ ] Versionamento de prompt gravado em cada documento — sem isso você não consegue investigar regressões de qualidade

---

## Marco 5 — O produto ao redor (2-3 semanas)

Agora sim, o trabalho conhecido. Nesta altura o núcleo já está provado.

- [ ] Auth real + onboarding (perfil, especialidade, registro profissional, assinatura)
- [ ] CRUD de pacientes, com busca
- [ ] **Gravação no navegador** — `MediaRecorder`, upload em pedaços, retomada se a rede cair, aviso de bateria/permissão. *Subestime este item por sua conta e risco: é onde o mobile real machuca.*
- [ ] Pasta do paciente com histórico de sessões
- [ ] Registro de consentimento antes de gravar (texto + timestamp + método)
- [ ] Export: PDF e "copiar para o prontuário"
- [ ] Plano grátis com **quota verificada no servidor antes de processar** (nunca depois — senão você paga a conta)
- [ ] PWA: manifest, service worker, instalável, ícone
- [ ] Telemetria de custo por sessão desde o primeiro usuário

---

## Marco 6 — Endurecimento e LGPD (1 semana)

- [ ] **Testes automatizados de RLS** — suíte que tenta ler dados de outro profissional e falha o build se conseguir. Não é opcional.
- [ ] Trilha de auditoria (quem viu/editou o quê, quando)
- [ ] Política de retenção: exclusão automática do áudio após N dias, configurável
- [ ] Exclusão de conta e portabilidade (direitos do titular, Art. 18)
- [ ] Política de privacidade e termos, com subprocessadores listados
- [ ] Criptografia em repouso confirmada; segredos fora do código
- [ ] Rate limiting nas rotas caras
- [ ] Revisão de segurança da aplicação antes do primeiro usuário real

---

## 9. Modelo de dados inicial

Traduzido de §9 da documentação para tabelas concretas.

```
professionals   id, auth_user_id, nome, especialidade, registro_profissional,
                assinatura_url, plano, criado_em
                -- voice_embedding vector(192)  → só se o Marco 3 exigir o Método A

patients        id, professional_id ⚑, nome, data_nascimento, documento_cifrado,
                observacoes, criado_em

sessions        id, professional_id ⚑, patient_id, iniciada_em, encerrada_em,
                status, audio_path, objetivo_texto, objetivo_template_id,
                consentimento_em, consentimento_metodo, excluida_em

transcript_segments  id, session_id, professional_id ⚑, falante_label, papel,
                     inicio_ms, fim_ms, texto, confianca

documents       id, session_id, professional_id ⚑, tipo, conteudo jsonb,
                modelo, prompt_versao, aprovado_em, aprovado_por

objective_templates  id, professional_id ⚑ (nulo = global), especialidade,
                     nome, prompt

usage_events    id, professional_id ⚑, session_id, tipo, minutos,
                custo_centavos, criado_em

audit_log       id, ator_id, acao, entidade, entidade_id, ip, criado_em
```

### Duas decisões de schema que economizam meses

**⚑ Desnormalize `professional_id` em toda tabela.** `transcript_segments` naturalmente só teria `session_id` — o dono viria por JOIN. Não faça isso. Políticas RLS com JOIN são lentas e fáceis de escrever errado, e cada política mal escrita é um vazamento de dado de saúde. Com a coluna direta, toda política é a mesma linha trivial:

```sql
create policy tenant_isolation on transcript_segments
  for all using (professional_id = auth.professional_id());
```

**Prepare o terreno do `pgvector` agora, use depois.** Habilite a extensão no Marco 0 e mantenha `transcript_segments` limpo e bem tipado. O assistente RAG da Fase 4 (§6.3-A da doc) vira uma coluna e um índice — não uma migração de dados históricos.

---

## 10. Estrutura do repositório

```
clinical-scribe-ai/
├── apps/
│   ├── web/                 # Next.js — PWA + rotas de API (BFF)
│   └── worker/              # processo Node: transcrever → diarizar → papel → nota
├── packages/
│   ├── db/                  # schema Drizzle, migrations, políticas RLS, seeds
│   └── core/                # domínio puro: tipos, prompts, pipeline, validadores
│                            #   sem I/O → testável sem banco nem rede
├── spikes/
│   └── asr-bench/           # Marco 1 — Python, descartável, não vai para produção
├── docs/
│   ├── DOCUMENTACAO.md      # visão de produto e negócio
│   ├── PLANO-DE-DESENVOLVIMENTO.md
│   └── adr/                 # decisões arquiteturais numeradas
└── .github/workflows/
```

**Por que `packages/core` separado:** a lógica que mais importa — montagem de prompt, validação de citações, classificação de papel — não deve depender de banco, rede nem framework. Isolada, ela roda em testes de milissegundos, e você consegue iterar em qualidade de prompt sem subir a aplicação inteira. É a diferença entre ajustar um prompt em 10 segundos ou em 3 minutos, multiplicada por centenas de iterações.

---

## 11. Economia unitária

O plano grátis é a estratégia de aquisição (§12 da doc) — e o item que pode sangrar caixa em silêncio. Mas a conta muda **radicalmente** conforme a arquitetura.

### Duas arquiteturas, custo muito diferente

Por consulta de 30 minutos:

| Item | Tudo em API paga | ASR local + LLM barato |
|---|---|---|
| ASR + diarização | R$ 0,45 – 1,10 | **~R$ 0** (custo fixo de servidor) |
| LLM da nota | R$ 0,15 – 0,60 (modelo premium) | R$ 0,05 – 0,15 (modelo econômico) |
| **Total por consulta** | **R$ 0,60 – 1,70** | **~R$ 0,10** |
| **Por usuário grátis/mês** (300 min ≈ 10 consultas) | **R$ 6 – 17** | **~R$ 1** |
| **1.000 usuários grátis/mês** | **R$ 6.000 – 17.000** | **~R$ 1.000** + servidor |

Com 5% convertendo para o Pro a R$ 89, mil usuários geram R$ 4.450/mês. Na coluna da esquerda, **o plano grátis dá prejuízo**. Na direita, é ruído contábil.

**A diferença decisiva é o ASR.** Ele é o item caro, e é o único que dá para zerar: Whisper + pyannote auto-hospedados transformam custo por consulta em custo fixo de servidor — que não cresce quando chega mais um usuário grátis.

### A arquitetura recomendada para o freemium — três motores

| Motor | Onde roda | Quem usa | Custo para você | Diarização |
|---|---|---|---|---|
| **`device`** | navegador do cliente (WebGPU) | grátis | **zero** | difícil — ver abaixo |
| **`local`** | nosso servidor com GPU | grátis com fila · Pro | fixo, R$ 500–1.500/mês | sim |
| **`cloud`** | API comercial | Pro · Clínica | por minuto | sim |

O `local` já resolve a residência de dados: o áudio nunca sai do nosso servidor.
O `device` vai além — **o áudio nunca sai da sala de consulta**. Não é
"hospedado no Brasil", é *nunca transmitido*. Sob LGPD isso é a diferença entre
ter subprocessador a declarar e não haver tratamento de dado algum fora do
dispositivo, e é um argumento que nenhum concorrente copia sem reconstruir o
produto inteiro.

### A divisão de trabalho: navegador E servidor, ao mesmo tempo

O ponto que importa não é escolher entre navegador **ou** servidor. É repartir
as funções: cada lado faz o que consegue fazer melhor, simultaneamente.

```
NAVEGADOR (dispositivo do cliente)        SERVIDOR (GPU)
├─ captura o áudio
├─ VAD: remove o silêncio
├─ 48kHz estéreo → 16kHz mono
├─ rascunho ao vivo (whisper-tiny)
└─ envia só a fala, ~10x menor  ────────► ├─ large-v3: transcrição final
                                          ├─ pyannote: separa as vozes
                                          └─ LLM: papel + nota clínica
```

**O que o navegador faz bem, e que o servidor faria pior:**

| Função | Ganho | Esforço |
|---|---|---|
| **VAD** — remover silêncio antes de enviar | Corta 20–40% do arquivo e do tempo de servidor. O silêncio e o ruído da sala **nunca saem do dispositivo**. | Baixo (Silero VAD, ~1 MB) |
| **Reamostragem** — 48 kHz estéreo → 16 kHz mono | Arquivo 6 a 10x menor. Ataca direto o "consultório de internet instável" da §8 da documentação. | Baixo |
| **Rascunho ao vivo** — whisper-tiny no navegador | O profissional vê o texto surgindo **durante** a consulta. Valor percebido imediato, custo zero de servidor. | Médio |

**O que ele não consegue:**

- Igualar o `large-v3` — modelo grande não cabe no navegador
- Rodar pyannote decentemente — separar vozes é o coração do produto e fica no servidor
- **Dividir uma única inferência com o servidor** — uma passada do modelo é
  indivisível; a divisão é por *função*, não dentro da mesma função
- Exige WebGPU: Chrome e Edge sim, Safari parcial, Firefox ainda não

### Ordem recomendada

| Fase | O quê | Quando |
|---|---|---|
| **A** | VAD + reamostragem no navegador | **Cedo** — é barato (2-3 dias) e o ganho de upload e de servidor é imediato |
| **B** | Rascunho ao vivo no navegador | Depois do Marco 4 — melhora muito a percepção, mas não cria diferencial |
| **C** | Motor `device` completo para o plano grátis | Quando escala ou privacidade total virarem prioridade |

**Por que B e C não vêm antes do Marco 4.** Um motor que transcreve mas não
separa vozes entrega exatamente o que o concorrente já faz por R$ 97. O
diferencial é diarização + identificação de papel + nota ancorada. A Fase A é
exceção porque não compete com isso: ela só torna tudo mais leve e rápido.

> **O código já comporta os três motores.** A interface `TranscriptionProvider`
> e a função `resolveEngine()` não sabem nem se importam com *onde* a
> transcrição acontece. Acrescentar `device` é um valor no enum e uma
> implementação — não é reescrever o pipeline. É o retorno de ter feito a
> abstração antes de precisar dela.

### ⚠️ A armadilha das APIs de IA gratuitas

É tentador usar o nível grátis do OpenRouter, do Google AI Studio ou equivalentes para zerar também o custo do LLM. **Não faça isso com dado de paciente.**

Esses níveis costumam ser gratuitos justamente porque o provedor registra e usa os prompts para treinar. Mandar a transcrição de uma consulta para lá significa:

- **uso secundário** de dado sensível de saúde, que pela própria §10 da documentação exige **consentimento explícito e específico** do paciente;
- a promessa **"não treinamos com seus dados"** deixa de ser verdadeira;
- sem contrato de tratamento de dados (DPA), você não tem base para o compartilhamento com o subprocessador.

**Onde o nível grátis serve muito bem:** desenvolvimento e testes com áudio simulado, que é exatamente o corpus do Marco 1. Use à vontade lá.

**Para dado real:** modelo pago, com termos contratuais de não-treinamento. A boa notícia é que isso custa muito menos do que parece — um modelo econômico processando 30 minutos de transcrição fica na casa de **R$ 0,05 a 0,15**, e vem com os mesmos termos contratuais do modelo caro. Verifique a política de dados vigente de cada provedor antes de fechar.

### Instrumentação, em qualquer arquitetura

- [ ] Quota **verificada antes de processar**, não depois
- [ ] Custo real registrado por sessão em `usage_events` desde o primeiro usuário
- [ ] Painel de custo por usuário e custo por conversão desde a semana 1
- [ ] Limite reavaliado com dados reais aos 30 dias

---

## 12. O que fazer em paralelo

Trabalho não-código que não pode esperar o código ficar pronto:

| Item | Quando | Por quê |
|---|---|---|
| **10-15 entrevistas no nicho** (§13, Fase 0 da doc) | Durante os Marcos 0-2 | Descobrir o **objetivo nº 1** que o profissional pediria. Isso define o template do Marco 4 — e você vai precisar dele antes do Marco 4 terminar. |
| **Escolher a especialidade** | Antes do Marco 4 | Nutrição ou psicologia (§4). O Marco 4 é específico de especialidade. |
| **Gravar o corpus de teste** | Antes do Marco 1 | 8 horas de trabalho manual. Comece no dia 1. |
| **Recrutar 3-5 testadores** | Durante o Marco 3 | Precisam estar prontos quando o Marco 5 fechar. |
| **Definir a marca** | Até o Marco 5 | O repositório já se chama `clinical-scribe-ai`; renomeável a 1 clique. |

> A documentação recomenda validar antes de codar pesado (Fase 0). Este plano não contradiz isso — ele roda a validação **em paralelo** com o trabalho técnico que independe do resultado das entrevistas. Nenhuma entrevista vai mudar o fato de que você precisa saber se a diarização funciona em pt-BR.

---

## 13. Critérios de aborto

Escritos agora, com a cabeça fria, para não serem racionalizados depois.

| Gatilho | Decisão |
|---|---|
| Nenhum fornecedor bate o portão de qualidade do Marco 1 | **Pare.** Reavalie: nicho com áudio mais controlado (microfone dedicado, Método C), ou produto diferente. Não construa o app esperando melhorar depois. |
| Custo por consulta > R$ 3,00 **mesmo com ASR local** | Modelo freemium inviável. Reprecifique antes do Marco 5, não depois. |
| Método B < 80% de acurácia de papel | Acrescente o Método A (impressão vocal) — orçe +1 semana. |
| Taxa de alucinação > 5% por afirmação após o Marco 4 | **Bloqueie o lançamento.** Este é o risco nº 1 da doc (§11). Um erro de dosagem inventado é um problema de responsabilidade civil, não um bug. |
| Entrevistas revelam que o objetivo nº 1 não é a nota estruturada | Ajuste o Marco 4 antes de construí-lo. É por isso que as entrevistas rodam cedo. |

---

## Cronograma consolidado

| Marco | Duração | Acumulado |
|---|---|---|
| 0 — Fundação | 2-3 dias | ~3 dias |
| 1 — Spike ASR ⭐ | 1 semana | ~1,5 semana |
| 2 — Esqueleto andante | 1 semana | ~2,5 semanas |
| 3 — Identificação de papel | 3-4 dias | ~3 semanas |
| 4 — Nota ancorada ⭐ | 1-2 semanas | ~4,5 semanas |
| 5 — Produto ao redor | 2-3 semanas | ~7 semanas |
| 6 — Endurecimento e LGPD | 1 semana | **~8 semanas** |

Dois meses até um MVP testável com usuários reais — dentro da janela de 2-3 meses da Fase 1 da documentação (§13).

**Os marcos ⭐ são os que decidem se o produto existe.** Os outros decidem quando.
