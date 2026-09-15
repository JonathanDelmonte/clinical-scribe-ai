# Consulta Viva — Documentação do Projeto

> **Nome de trabalho:** _Consulta Viva_ (placeholder — troque à vontade).
> **Repositório sugerido:** `clinical-scribe-ai` · **Candidato a marca:** _Ausculta_
> **Status:** concepção / pré-MVP
> **Última atualização:** setembro de 2026

**O que é, em uma frase:** um escriba clínico com IA que grava a consulta, transcreve, separa quem fala (médico × paciente), e devolve uma anotação estruturada — mais o que o profissional pedir — tudo organizado por paciente e persistido em banco de dados.

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Problema e oportunidade](#2-problema-e-oportunidade)
3. [Concorrência](#3-concorrência)
4. [Público-alvo e nicho de entrada](#4-público-alvo-e-nicho-de-entrada)
5. [Diferenciais — a estratégia de vencer](#5-diferenciais--a-estratégia-de-vencer)
6. [Funcionalidades](#6-funcionalidades)
   - 6.1 [MVP](#61-mvp-o-loop-central)
   - 6.2 [Diferenciação (Fase 2)](#62-diferenciação-fase-2)
   - 6.3 [Planos futuros — a visão de longo prazo](#63-planos-futuros--a-visão-de-longo-prazo)
7. [A solução do problema das vozes (diarização)](#7-a-solução-do-problema-das-vozes-diarização)
8. [Arquitetura técnica](#8-arquitetura-técnica)
9. [Modelo de dados](#9-modelo-de-dados)
10. [Segurança, LGPD e regulação](#10-segurança-lgpd-e-regulação)
11. [Riscos e mitigações](#11-riscos-e-mitigações)
12. [Modelo de negócio (freemium)](#12-modelo-de-negócio-freemium)
13. [Roadmap](#13-roadmap)
14. [Próximos passos](#14-próximos-passos)
15. [Glossário](#15-glossário)
16. [Fontes](#16-fontes)

---

## 1. Visão geral

O produto ataca uma dor concreta: profissionais de saúde gastam uma fatia enorme do dia digitando prontuário em vez de olhar para o paciente. A Consulta Viva escuta a consulta e devolve a documentação pronta para revisão.

**O loop central:**

1. O profissional abre o painel e inicia uma nova sessão para um paciente.
2. A IA grava e transcreve a conversa em tempo real.
3. Separa as falas por papel: **médico × paciente/acompanhante**.
4. Ao final, gera uma **nota estruturada** (anamnese/SOAP) e executa o **objetivo** que o profissional definiu para aquela sessão (ex.: "gere a receita", "faça um resumo para o paciente", "liste os pontos de acompanhamento").
5. O profissional **revisa e edita** — cada trecho da nota aponta o pedaço do áudio que o originou — e salva.

**Modelo mental da interface (dashboard):**

- Clicar e começar a gravar é a ação primária.
- Abas/seções de **pacientes**; cada paciente tem sua **pasta**.
- Dentro da pasta, todas as **sessões** gravadas, com transcrição e documentos.
- Tudo persistido em banco de dados, acessível depois.

**O conceito de "objetivo":** além da transcrição e do resumo padrão, o profissional pode instruir a IA por sessão. Esse recurso é tratado aqui como o **coração do produto** (ver [Diferenciais](#5-diferenciais--a-estratégia-de-vencer)), não como um detalhe.

---

## 2. Problema e oportunidade

A categoria tem nome de mercado: **"ambient AI scribe"** (escriba de IA ambiente) / documentação clínica ambiente.

| Métrica | Valor | Fonte |
|---|---|---|
| Mercado global (2025) | US$ 1,75 bi | Growth Market Reports |
| Projeção (2034) | ~US$ 13,8 bi | Growth Market Reports |
| Crescimento anual (CAGR) | 23,9% | Growth Market Reports |
| Participação América do Norte | ~43% | Growth Market Reports |
| Participação América Latina | ~7,9% | Growth Market Reports |

**Leitura estratégica:** a demanda já está validada por dezenas de empresas e por estudos clínicos. Não é preciso provar que "o profissional quer economizar tempo de digitação". A energia do projeto deve ir para **diferenciação** e **confiança**, não para provar a categoria. O mercado global é maduro; o brasileiro ainda está em formação — janela boa para quem for específico para o Brasil.

---

## 3. Concorrência

Um ponto observado e que muda o jogo: **a concorrência é forte no papel, mas fraca na execução e no marketing** (sites ruins, presença de marca quase inexistente). Isso significa que o diferencial pode ser tanto **execução/marca/polimento** quanto tecnologia.

### 3.1 Brasil — disputam o mesmo cliente

| Produto | Preço | O que faz | Ponto de atenção |
|---|---|---|---|
| **Escriba Médico** | R$ 97/mês (15 dias grátis) | Grava, transcreve em pt-BR, **separa médico × paciente**, gera prontuário/receita/atestado/encaminhamento. Diz não reter áudio nem treinar com dados. | É praticamente a ideia, já pronta e barata. Estudar linha a linha. |
| **ROSC.ai** | R$ 289,99/mês · **grátis: 2.500 min/mês** | Documentação em tempo real, web e mobile, export para prontuário. LGPD + certificação Vanta. | Já tem o plano grátis generoso que queríamos usar como isca. |
| **Amplimed (Amélia)** | dentro do plano | Transcrição integrada ao próprio prontuário; +2.000 profissionais; alega 40% menos tempo. | Vantagem de já _ser_ o prontuário. Sem menção a separar vozes — brecha. |
| **HiDoctor LIVE, My Smart Clinic, Pronova, GestãoDS, AppHealth** | dentro do plano | Prontuários/plataformas embutindo transcrição + resumo por IA. | Maior ameaça de longo prazo: já têm o médico e a base instalada. |

### 3.2 Global — a régua de produto

| Produto | Preço (mês) | Diferencial técnico | Sinal |
|---|---|---|---|
| **Heidi Health** | Grátis ilimitado · Pro US$ 110–150 | 200+ templates; instrução anti-alucinação explícita | Freemium agressivo funciona |
| **Abridge** | ~US$ 2.500/ano | **Linked Evidence** (nota → trecho do áudio); KLAS 94,7 | Confiança = rastreabilidade |
| **Nabla** | Free + pago | "Fatos atômicos" verificados; tem ensaio clínico randomizado | Prova científica vende |
| **Freed** | US$ 39–119 | Foco em autônomo; 90+ idiomas; apaga áudio em 60s | Preço de entrada baixo |
| **Microsoft Dragon Copilot (DAX)** | ~US$ 600 | Enterprise, embutido no Epic; infra Azure | Peso-pesado corporativo |
| **Suki** | US$ 299–399 | Controla o prontuário por voz | Voz como interface |
| **DeepScribe** | sob consulta | Rastreabilidade "Clinical Moments"; KLAS 98,8 | Auditoria importa |
| **Doximity Scribe** | Grátis (EUA) | Grátis para médico verificado; só copia-e-cola | Grátis vira padrão |

> Preços em US$ vêm de comparativos de mercado (Commure, 2026) e servem de régua; os de R$ são das próprias páginas dos produtos. KLAS = índice de satisfação de clínicos, não de acurácia.

---

## 4. Público-alvo e nicho de entrada

**Não começar por "todos os médicos".** A recomendação é escolher uma especialidade de entrada (_beachhead_) com sessões longas e muita documentação, dominar o template dela, e expandir depois. Vertical batendo generalista é regra em SaaS de saúde.

Candidatos fortes:

- **Nutrição** — acesso facilitado a profissionais para entrevistas e testes; consultas com muito registro de hábitos e planos.
- **Psicologia/psiquiatria** — sessões longas, documentação intensa, mal servidas pelos escribas focados em médico.

**Nota de posicionamento:** preferir os termos **"clínico"/"consulta"/"saúde"** a **"médico"** no nome e na comunicação. "Médico" fecha o produto em uma categoria; "clínico" mantém a porta aberta para nutricionistas, psicólogos, fisioterapeutas, fonoaudiólogos e dentistas — um mercado maior e menos disputado.

---

## 5. Diferenciais — a estratégia de vencer

A ideia "como está" já existe (Escriba a R$ 97, ROSC grátis, Heidi grátis no mundo). Copiar sem ângulo é entrar em briga de preço com quem saiu na frente. Os movimentos que criam diferenciação, em ordem de impacto:

1. **Resumo para o paciente via WhatsApp.** Ao fim da consulta, gerar um resumo em linguagem simples e enviar ao paciente. Quase ninguém no Brasil faz bem — e o WhatsApp é onde o paciente vive. Alto valor percebido e marketing viral (o paciente vê a marca).
2. **Foco em um nicho** (seção 4).
3. **"Objetivos" como marca do produto.** Transformar o objetivo customizável em uma **biblioteca de objetivos**: gerar receita, encaminhamento, laudo, CID/TUSS, plano de retorno, resumo para o paciente.
4. **Rastreabilidade nativa (confiança).** Cada afirmação da nota aponta o segundo exato do áudio — resposta direta ao risco de alucinação e argumento de venda.
5. **Integrar em vez de competir de frente.** Conectar com o **Memed** (receita digital) e com prontuários existentes; ser a "camada de IA" de quem já tem o médico.
6. **Mobile-first e resiliente.** PWA, gravação local com envio posterior, retomar sessão — para o consultório real, de internet instável.

---

## 6. Funcionalidades

### 6.1 MVP (o loop central)

Enxuto de propósito. Tudo fora daqui é Fase 2+.

- **Login e cadastro** do profissional (perfil, especialidade, amostra de voz do médico, assinatura).
- **Pacientes** — criar/abrir pasta do paciente (CRUD).
- **Nova sessão** — registrar a ciência da gravação → gravar (web/celular).
- **Processamento** — transcrição + separação de vozes (médico × paciente) via serviço pronto.
- **Geração** — nota estruturada (anamnese/SOAP) + execução do **objetivo** da sessão.
- **Revisão** — editar a nota com **citações ao áudio**; nada é gravado sem aprovação.
- **Salvar e exportar** — na pasta do paciente + PDF/copiar para o prontuário que o profissional já usa.
- **Plano grátis** com limite + upgrade.
- **Consentimento e privacidade** — registro de ciência da gravação; "não treinamos com seus dados"; dados no Brasil.

**Fora do MVP (de propósito):** multiusuário/gestão de clínica; integrações profundas de prontuário e Memed; certificação SBIS/NGS2; app nativo (o PWA cobre o início); transcrição auto-hospedada; relatórios para gestores.

### 6.2 Diferenciação (Fase 2)

- Resumo para o paciente via **WhatsApp**.
- **Biblioteca de objetivos** (receita, encaminhamento, laudo, CID/TUSS, plano de retorno…).
- Mais especialidades / templates.
- Integração com **Memed** e com um ou dois prontuários.

### 6.3 Planos futuros — a visão de longo prazo

Esta seção registra recursos que **não** entram no MVP, mas orientam a arquitetura desde já (o que construir hoje sem fechar portas amanhã). Cada item traz uma avaliação técnica honesta.

#### A) Assistente conversável sobre o histórico (texto **e** voz)

**O que é:** um botão "conversar com a IA" onde o profissional pergunta, por texto ou voz, sobre o próprio histórico. Exemplos reais de uso:

- _"O que eu tinha combinado com o paciente João sobre a dieta na última consulta?"_
- O paciente manda um WhatsApp com uma dúvida específica sobre a consulta; o profissional joga a pergunta na IA e ela responde **com base no que foi registrado** naquele atendimento.

**Como funciona (padrão técnico):** isto é um **RAG** (_Retrieval-Augmented Generation_). As transcrições e notas de cada profissional viram vetores (embeddings) guardados num banco vetorial; a pergunta busca os trechos relevantes **apenas dos pacientes daquele profissional**; um modelo de linguagem responde citando a consulta/data de origem. A entrada por voz reaproveita o ASR do produto; a saída por voz usa TTS (síntese de fala).

| Aspecto | Avaliação |
|---|---|
| **Viabilidade** | **Alta** |
| **Esforço** | **Médio** |
| **Por que vale muito** | Reaproveita 100% dos dados que o produto já guarda; é o "cérebro" que dá sentido ao resto. Provavelmente o recurso futuro mais valioso. |

**Guardrails obrigatórios (não são opcionais):**

- **Isolamento rígido por profissional (multi-tenant).** Cada um só consulta os próprios pacientes. Um vazamento aqui é incidente grave de LGPD — a busca precisa ser filtrada por dono no nível de dados, não só na interface.
- **Grounding + citações.** A resposta sempre cita a consulta/data de origem e nunca inventa. Mesma disciplina anti-alucinação do resto do produto.
- **Regra crítica sobre a dúvida do paciente no WhatsApp:** a IA responde **para o profissional** (ajuda a lembrar e a rascunhar a resposta), **não** responde conduta médica direto ao paciente. Responder automaticamente ao paciente com orientação clínica é exercício da medicina, com responsabilidade legal e regras de telemedicina do CFM. O profissional fica **sempre no meio** (human-in-the-loop). Isso é regra de projeto.

#### B) Interface de voz — o "assistente falante" (estilo Jarvis)

A ideia (falar com uma IA que responde por voz, com uma esfera/orb animada, tipo "Jarvis") se divide em **duas coisas bem diferentes**, e é importante separá-las porque a viabilidade muda muito.

**B1 — Conversar por voz com o assistente do app, com um orb animado.**

- **O que é:** a versão falada do assistente (A): você fala, ele ouve, responde por voz, e uma esfera reage ao áudio na tela.
- **Como funciona:** loop **STT → LLM/RAG → TTS** com streaming (WebRTC) para baixa latência; já existem APIs de voz em tempo real que fazem esse loop. O orb é apenas um visual audio-reativo (Canvas/WebGL) — a parte fácil.

| Aspecto | Avaliação |
|---|---|
| **Viabilidade** | **Média-alta** |
| **Esforço** | **Médio** (o custo está na latência e no polimento de UX, não na ideia) |
| **Base** | É o assistente RAG (A) + camada de voz em tempo real + visual |

**B2 — Controlar o computador inteiro / o sistema operacional ("abre tal aplicativo").**

- **O que é:** um agente estilo Jarvis que comanda o SO por voz.
- **Avaliação honesta:** **viabilidade baixa neste contexto e fora de escopo.** Controlar o SO exige um **agente desktop nativo** com permissões de sistema (APIs de acessibilidade), é um campo minado de segurança e responsabilidade num produto de saúde, e **não serve o trabalho central** (documentar a consulta). Construir isso seria desviar meses do que importa.

**A versão certa desse sonho — e que entra no roadmap:** **comandos de voz dentro do produto**, não no SO. Ex.: _"abrir a ficha do João"_, _"iniciar gravação"_, _"gerar a receita"_, _"resumir a última consulta"_. Isso entrega a sensação "Jarvis" com segurança e valor real, escopado ao app. Controlar o computador inteiro fica como curiosidade, não como meta.

#### Resumo da viabilidade dos recursos futuros

| Recurso | Viabilidade | Esforço | Recomendação |
|---|---|---|---|
| Assistente conversável sobre o histórico (RAG, texto) | Alta | Médio | **Fazer** (fase pós-MVP) |
| Assistente por voz + orb (B1) | Média-alta | Médio | **Fazer** depois do RAG em texto |
| Comandos de voz dentro do app | Média | Médio | **Fazer** junto com B1 |
| Controlar o SO / computador inteiro (B2) | Baixa | Alto | **Não fazer** — fora de escopo |

**Impacto na arquitetura desde já:** guardar transcrições e notas de forma estruturada e limpa, com dono (profissional) e paciente bem marcados, e prever o uso de **embeddings/banco vetorial** (ex.: `pgvector` no próprio Postgres) já habilita o assistente A no futuro sem retrabalho.

---

## 7. A solução do problema das vozes (diarização)

Três coisas diferentes que costumam ser confundidas: **transcrever**, **separar vozes** e **saber o papel de cada voz**.

```
Áudio da consulta
   │  (microfone / celular)
   ▼
[02] Transcrição (ASR — Whisper)      → vira texto + timestamps  (SÓ ISSO o Whisper faz)
   ▼
[03] Diarização (pyannote / API)      → separa Falante 1, 2, 3…
   ▼
[04] Identificação de papel  ★        → médico × paciente/outros   (responde à pergunta-chave)
   ▼
[05] Nota estruturada + transcrição rotulada e revisável
```

**O ponto que derruba muita gente:** o Whisper (o transcritor mais usado) faz **só o passo 02** — ele não diz quem falou. Separar as vozes (diarização) e dizer qual voz é a do médico (identificação de papel) são etapas que se acoplam depois.

**A decisão certa (e que confirma a intuição inicial):** não identificar "o João e a Maria", e sim rotular apenas **MÉDICO × PACIENTE/OUTRO**. É mais barato, mais robusto e é o que o cliente precisa. Quando o paciente leva acompanhante, a diarização lida com N falantes e o sistema só precisa saber "isto não é o médico".

**As 3 formas de saber quem é o médico:**

- **Método A — impressão vocal do médico (recomendado):** o médico grava uma amostra da voz no cadastro; o sistema reconhece essa "âncora" em toda consulta. Resolve o acompanhante de graça.
- **Método B — classificação por conteúdo (LLM):** depois de separar as vozes, um modelo lê o texto e deduz o papel (quem dá conduta é médico; quem descreve sintoma é paciente). Funciona mesmo sem cadastrar a voz e corrige o método A.
- **Método C — canal de áudio separado (o mais confiável):** o médico usa microfone próprio; a voz dele entra num canal isolado, sem adivinhação. Ótimo no consultório fixo; menos prático no celular. Bom como opção "premium de precisão".

**Recomendação:** combinar **A + B** (âncora de voz + confirmação por conteúdo).

**Construir ou comprar:** no começo, **comprar**. Serviços prontos entregam transcrição + diarização em português (AssemblyAI, Deepgram) e há serviços clínicos que já rotulam CLÍNICO × PACIENTE (AWS HealthScribe — confirmar suporte a pt-BR e região). Quando o volume crescer, migrar para **Whisper (excelente em português) + pyannote** auto-hospedado, que reduz custo em escala ao preço de operar GPU.

**Detalhe técnico ao medir qualidade:** não olhar só o **DER** de diarização — ele esconde palavras atribuídas ao falante errado. Medir também o **cpWER** (que penaliza troca de falante). Já se viu "15% DER mas 31% cpWER" no mesmo áudio — o número bonito enganava.

---

## 8. Arquitetura técnica

| Camada | Escolha sugerida | Observação |
|---|---|---|
| **Frente** | PWA mobile-first | Web responsivo que funciona como app; gravação no navegador, retomada de sessão, envio posterior se a rede cair. |
| **Back-end** | API + fila de processamento | O áudio é processado de forma assíncrona por um _worker_ (transcrever → diarizar → gerar nota). Node/TS ou Python. |
| **Banco** | PostgreSQL | Relacional para pacientes/sessões + `JSONB` para trechos de transcrição. Prever `pgvector` para o assistente futuro. |
| **Áudio** | Object storage criptografado (S3-compatível) | **Região Brasil**, criptografia, retenção mínima / auto-exclusão. |
| **Transcrição + vozes** | Comprar no início (AssemblyAI / Deepgram / AWS HealthScribe) | Depois, migrar para **Whisper + pyannote** auto-hospedado por custo. |
| **Geração da nota** | LLM via API, com _grounding_ | Prompt anti-fabricação + citações; contrato que garanta **não-treinamento** com os dados. |

> **Decisão de engenharia mais importante:** no dia 1, **não construir** transcrição nem diarização. Usar API pronta, validar o produto, e só internalizar (Whisper+pyannote) quando o custo por minuto justificar o custo de operar GPU. Construir ASR cedo demais é o erro clássico que queima meses.

---

## 9. Modelo de dados

Entidades essenciais:

- **Profissional** — dados, especialidade, impressão de voz, assinatura, plano.
- **Paciente** — dados básicos, vínculo ao profissional.
- **Sessão** — paciente, data, status, referência do áudio, **objetivo**, registro de consentimento.
- **Transcrição** — trechos com `papel`, tempo e texto.
- **Documento** — nota / receita / resumo, com **citações** (nota → trecho do áudio).
- **Template** e **Objetivo** — reutilizáveis por especialidade.
- **Uso/Assinatura** — quotas do freemium.
- **Auditoria** — trilha de acesso (quem viu/editou o quê e quando).

Marcar bem **dono (profissional)** e **paciente** em cada registro é o que garante o isolamento multi-tenant e habilita o assistente conversável futuro com segurança.

---

## 10. Segurança, LGPD e regulação

### LGPD — dado de saúde é dado sensível

Existe um mito de que "tudo precisa de consentimento". Não é bem assim:

- **Prestar o atendimento** tem base legal na **tutela da saúde** (Art. 11, II, "f" da LGPD) — o profissional trata e documenta independentemente de consentimento.
- **Gravar a consulta** para aquele atendimento: base de saúde + **transparência** (o paciente precisa estar ciente da gravação).
- **Usos secundários** (treinar modelo, pesquisa, compartilhar com terceiros): exigem **consentimento explícito e específico**.
- Princípios que valem sempre: **finalidade, minimização, segurança** e retenção mínima do áudio.

### CFM / SBIS — quando você vira o prontuário oficial

- O prontuário eletrônico é regido pela Resolução CFM 1.821/2007.
- Certificação **SBIS/CFM** tem dois níveis: **NGS1** (controle de acesso, auditoria, backup) e **NGS2** (tudo do NGS1 + **assinatura digital ICP-Brasil**, que dá validade jurídica para eliminar o papel).
- Não é obrigatória para operar, mas é o caminho reconhecido pelo CFM para o registro eletrônico ter segurança jurídica plena.

**Jogada para o MVP:** posicionar o produto como **assistente de documentação** que _exporta_ a nota para o prontuário (certificado) que o profissional já usa. Assim **não é preciso** a certificação SBIS no início. Buscar NGS2 só quando o produto quiser ser o prontuário oficial. E transformar **"seus dados não treinam nossa IA"** e **"dados hospedados no Brasil"** em recursos de confiança, exibidos na tela.

---

## 11. Riscos e mitigações

**Risco nº 1 — alucinação.** Escribas de IA fabricam informação que soa plausível. Num benchmark de 2026 (Scribing.io, que é um fornecedor — ler com esse filtro), as taxas dos líderes ficaram entre **0,8% e 4,1% por afirmação clínica**, com psiquiatria pior (até 7,3%). Os erros mais graves: medicações/doses inventadas, achados de exame físico que não existiram, e troca da ordem temporal dos fatos. E **62% dos achados de exame físico fabricados passaram despercebidos** na revisão rápida do médico, por soarem críveis.

**Mitigações (todas obrigatórias):**

- **Ancoragem + citações** — cada frase clica e mostra o trecho do áudio.
- **Prompt anti-fabricação** — "só registre o que está no áudio; se não houver, omita a seção".
- **Revisão obrigatória** — a nota nasce como rascunho a ser aprovado; nunca gravada sozinha.

**Outros riscos:** economia unitária (cada consulta custa transcrição + IA — o plano grátis precisa de limite calculado); dependência de API de terceiros no início; adoção/confiança do profissional; qualidade de áudio no consultório; e a concorrência dos prontuários incumbentes.

---

## 12. Modelo de negócio (freemium)

A parte grátis é a estratégia certa de aquisição — desde que o limite seja calculado, porque **cada consulta tem custo**.

| Plano | Preço | Para quem | Inclui |
|---|---|---|---|
| **Grátis** | R$ 0 | Atrair e provar valor | ~10 sessões ou 300 min/mês; nota básica; 1–2 templates; separação médico × paciente; marca "feito com Consulta Viva" |
| **Pro** _(carro-chefe)_ | ~R$ 89–99/mês | Autônomo que atende todo dia | Sessões ilimitadas (fair use); todos os templates + **objetivos customizados**; **resumo p/ paciente via WhatsApp**; citações; export avançado |
| **Clínica** | sob consulta / por usuário | Consultórios com equipe | Multiusuário + admin; integrações (Memed, prontuários); relatórios e auditoria; caminho SBIS/NGS2; suporte prioritário |

**Economia unitária:** estimar o custo por consulta (transcrição por minuto + tokens da IA) — algo na casa de **R$ 0,50–2,00** por consulta de 30 min via API. Isso define quanto "grátis" se aguenta. Posicionar o Pro em ~R$ 89 fica logo abaixo do Escriba (R$ 97) sem virar corrida ao fundo do poço. **Medir de perto** desde a primeira semana.

---

## 13. Roadmap

| Fase | Prazo aproximado | Foco | Entregas |
|---|---|---|---|
| **Fase 0** | 2–4 semanas | Validar antes de codar pesado | 10–15 entrevistas no nicho; protótipo clicável; escolher a especialidade |
| **Fase 1 (MVP)** | 2–3 meses | O loop inteiro, uma especialidade | Login, pacientes, gravação, transcrição + separação de vozes (via API), nota + objetivo, revisão com citações, export, freemium, consentimento/LGPD |
| **Fase 2** | meses seguintes | Diferenciação | Resumo via WhatsApp, biblioteca de objetivos, mais especialidades, integração Memed |
| **Fase 3** | ao escalar | Clínicas & escala | Multiusuário, integrações de prontuário, auditoria, caminho SBIS/NGS2, internalização do ASR (Whisper+pyannote) por margem |
| **Fase 4 (visão)** | longo prazo | Inteligência sobre o histórico | **Assistente conversável (RAG) por texto e voz**, **orb falante**, **comandos de voz dentro do app** (ver 6.3) |

---

## 14. Próximos passos

1. **Escolher o nicho de entrada** — sugestão: nutrição ou psicologia.
2. **Falar com 10–15 profissionais** antes de escrever muito código; descobrir o objetivo nº 1 e a disposição a pagar.
3. **Montar o loop com API pronta** — não construir transcrição.
4. **Cravar o wedge** — objetivos customizados + resumo via WhatsApp + citações.
5. **Confiança como recurso** — consentimento, "não treinamos com seus dados", dados no Brasil, revisão obrigatória.
6. **Preço com grátis generoso**, Pro em ~R$ 89–99; medir o custo por consulta.
7. **Repositório** — criar como `clinical-scribe-ai` (renomeável a 1 clique quando a marca vier).

---

## 15. Glossário

- **ASR** (_Automatic Speech Recognition_) — transcrição de fala em texto (ex.: Whisper).
- **Diarização** — separar o áudio por falante ("quem falou quando"), sem necessariamente saber o papel.
- **Identificação de papel** — atribuir um papel a cada voz (médico × paciente).
- **DER / cpWER** — métricas de qualidade de diarização; cpWER penaliza palavra atribuída ao falante errado.
- **RAG** (_Retrieval-Augmented Generation_) — o modelo responde buscando trechos reais dos dados antes de gerar a resposta; base do assistente conversável.
- **TTS** (_Text-to-Speech_) — síntese de fala (a IA "falando").
- **Grounding** — ancorar cada afirmação gerada em uma fonte verificável (o trecho do áudio).
- **Multi-tenant** — vários clientes no mesmo sistema, com isolamento rígido de dados entre eles.
- **PWA** — site que se instala e funciona como app.
- **SBIS/NGS2** — certificação de prontuário eletrônico no Brasil; NGS2 exige assinatura digital ICP-Brasil.

---

## 16. Fontes

Pesquisa realizada em setembro de 2026. Números de mercado e preços mudam — reconferir antes de decisões grandes.

- Growth Market Reports — _Ambient AI Scribe Market_ (tamanho, CAGR): https://growthmarketreports.com/report/ambient-ai-scribe-market
- Commure — _Best AI Medical Scribes 2026_ (comparativo global): https://www.commure.com/blog-scribe/best-ai-medical-scribes
- Commure — _AI Medical Scribe Pricing 2026_: https://www.commure.com/blog-scribe/scribe-pricing
- Escriba Médico (concorrente BR): https://escribamedico.com.br/
- ROSC.ai (concorrente BR): https://rosc.ai/pt-br/
- Amplimed — _Transcrição médica com IA_ (BR): https://www.amplimed.com.br/blog/transcricao-medica/
- AssemblyAI — _Whisper e diarização_ (técnico): https://www.assemblyai.com/blog/whisper-speaker-diarization
- Simbo AI — _Diarização em saúde_: https://www.simbo.ai/blog/the-role-of-speaker-diarization-in-enhancing-healthcare-documentation-and-patient-care-3394597/
- Scribing.io — _Taxas de alucinação_ (fornecedor): https://www.scribing.io/blog/medical-ai-hallucination-rates-comparative-review-top-scribes
- LEC — _LGPD e o mito do consentimento_: https://lec.com.br/lgpd-e-o-mito-do-consentimento-para-tratamento-dos-dados-de-saude/
- Solara — _Certificação SBIS/CFM NGS2_: https://solara.doctor/recursos/certificacao-sbis-cfm-ngs2
- CFM — _Cartilha sobre LGPD_: https://portal.cfm.org.br/noticias/cartilha-do-cfm-orienta-medicos-sobre-uso-da-lgpd/

---

_Documento de trabalho — Consulta Viva (nome provisório). Mercado, técnica e escopo consolidados para orientar o desenvolvimento._
