# ADR-0003 — O profissional traz a própria chave de IA

> Status: **aceito, não implementado** · 16/09/2026
> Decide *como* será feito. Quando será feito é outra conversa.

---

## O pedido

O profissional deve poder ligar a **própria chave** de IA — Anthropic, OpenAI,
Google, ou qualquer outra — em vez de usar a do sistema.

## Por que isso é bom para o produto

| Motivo | Efeito |
|---|---|
| **Custo de LLM sai da nossa conta** | Quem traz a chave paga o próprio consumo. O plano grátis fica mais barato de sustentar ([§11 do plano](../PLANO-DE-DESENVOLVIMENTO.md#11-economia-unitária)). |
| **Clínica com contrato próprio** | Hospital ou rede que já tem acordo de não-treinamento com um fornecedor pode usá-lo, com os termos jurídicos que já negociou. |
| **Some a objeção de fornecedor único** | "E se vocês trocarem de IA?" deixa de ser risco do cliente. |
| **Nós já estamos prontos** | `LlmProvider` em `packages/core/src/llm.ts` não sabe quem implementa. Era para isto que a interface existia. |

---

## A parte que não pode ser improvisada

Guardar a chave de outra pessoa é guardar **segredo de terceiro**. Uma chave da
OpenAI vazada não é um incidente do nosso produto: é a conta do profissional
sendo usada por outra pessoa, com cobrança real, e a responsabilidade é nossa
porque fomos nós que perdemos.

Cinco regras, todas obrigatórias:

1. **Cifrada em repouso, com chave que não está no banco.** A coluna guarda
   texto cifrado; a chave de cifra vive em variável de ambiente. Quem obtém um
   dump do banco não obtém as chaves. Guardar em texto puro transformaria um
   vazamento de banco num vazamento de credenciais de todos os clientes.

2. **Nunca volta para o navegador.** A tela mostra `sk-…7f3a` e nada mais. Uma
   rota que devolve a chave inteira "para preencher o formulário" é uma rota
   que vaza a chave para qualquer XSS.

3. **Nunca entra em log.** Os `redact` do pino já cobrem cabeçalhos conhecidos;
   uma chave nova precisa entrar nessa lista **junto com** o campo, não depois.

4. **Verificada na hora de salvar.** Uma chamada barata ao fornecedor —
   `healthy()` já existe na interface. Uma chave errada precisa falhar no
   cadastro, não na primeira consulta.

5. **A política de dados continua valendo.** `checkDataPolicy` não muda: uma
   chave de nível gratuito continua sendo `training` e continua recusada em
   ambiente que exige `contractual`. Ser a chave *do cliente* não muda o que o
   fornecedor faz com o prompt — e o paciente não é parte dessa escolha.

> A regra 5 é a que mais provavelmente será contestada, então vale escrever o
> argumento: o profissional pode aceitar que seus próprios dados sejam usados
> para treino. Ele **não pode** aceitar isso pelo paciente. O dado é do
> paciente; o profissional é o controlador, não o dono.

---

## O desenho

### Modelo de dados

```
professionals
  llm_provider        text    -- "anthropic" | "openai" | "google" | "custom"
  llm_model           text
  llm_key_cipher      bytea   -- cifrado; NUNCA texto puro
  llm_key_hint        text    -- últimos 4 caracteres, só para a tela
  llm_base_url        text    -- para compatíveis com OpenAI e auto-hospedados
  llm_data_policy     text    -- declarada pelo profissional, ver abaixo
  llm_verified_at     timestamptz
```

`llm_base_url` faz mais trabalho do que parece: com ele, um único adaptador
compatível com OpenAI atende OpenAI, Groq, Together, OpenRouter, vLLM
auto-hospedado e praticamente todo serviço novo que aparecer. É a diferença
entre "suportamos três fornecedores" e "suportamos o formato que o mercado
adotou".

### Quem declara a política de dados

O fornecedor não tem como ser interrogado sobre isso por API. Então quem
declara é o profissional, no cadastro, escolhendo entre:

- **"Tenho termos de não-treinamento com este fornecedor"** → `contractual`
- **"Não sei / é nível gratuito"** → `training`, e o sistema recusa consulta real

A escolha fica gravada com data e é reexibida a cada uso. Não é uma pergunta
de formulário: é uma declaração, e ela precisa parecer uma.

### Código

```
packages/core/src/llm.ts          o contrato — já existe, não muda
apps/worker/src/llm/google.ts     já existe
apps/worker/src/llm/anthropic.ts  a criar
apps/worker/src/llm/openai.ts     a criar — cobre todo compatível via base_url
apps/worker/src/llm/index.ts      passa a resolver POR PROFISSIONAL
```

A mudança real está na última linha. Hoje `resolveLlm()` lê o ambiente uma vez,
na partida. Passará a receber o profissional e montar o provedor dele — e a
conferência de política, que hoje roda na partida, passa a rodar por sessão.

**Isso perde a melhor propriedade do desenho atual:** o erro de configuração
deixa de aparecer na primeira linha do console e volta a aparecer no meio de um
job. A mitigação é a regra 4 — verificar ao salvar — que move a descoberta para
o cadastro, onde a pessoa está olhando.

### Ordem de fornecedores

1. **OpenAI-compatível** (com `base_url`) — um adaptador, dezenas de serviços
2. **Anthropic** — formato próprio, muito usado
3. **Google** — já existe

---

## O que decidimos não fazer

- **Chave por sessão.** Seria flexibilidade que ninguém pediu, e multiplicaria
  os caminhos em que uma chave circula.
- **Nossa chave como reserva quando a do cliente falha.** Parece gentileza e é
  uma conta surpresa: o cliente configurou a dele justamente para não usar a
  nossa. Falhar e avisar é o comportamento correto.
- **Deixar o profissional escrever o prompt.** O prompt é onde moram as regras
  anti-alucinação. Ele é da [Trilha A](../DIVISAO-DE-TRABALHO.md) e continua
  sendo.
