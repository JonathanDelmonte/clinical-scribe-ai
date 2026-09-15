# Spikes

Código **descartável**, escrito para responder a uma pergunta e depois ser
esquecido. Nada daqui vai para produção; nada daqui entra no CI.

Cada spike vira um **ADR** em [`../docs/adr/`](../docs/adr/). O ADR é o produto;
o código é só o instrumento que o gerou.

---

## `asr-bench/` — Marco 1 ⭐

**Pergunta:** existe um fornecedor que transcreva e separe vozes em português
brasileiro, em áudio real de consultório, com qualidade suficiente e custo
viável — e, de preferência, sem tirar o áudio do país?

**Comece pelo local. É grátis e não precisa de cadastro nenhum:**

| Ordem | Fornecedor | Região BR |
|---|---|---|
| **1º** | **Whisper large-v3 + pyannote 3.1 (local)** | 🏠 total |
| 2º | Google Cloud STT v2 (`southamerica-east1`) | ✅ |
| 3º | Azure AI Speech (Brazil South) | ✅ |
| 4º | AssemblyAI | ❌ |
| 5º | Deepgram | ❌ |

Só desça na lista se o de cima não passar. O local é simultaneamente a régua de
qualidade, o candidato a motor do plano grátis, e a única opção em que o áudio
nunca sai do seu servidor.

**Passo 1 — o teste do olho.** Duas gravações de 8 minutos, rodadas em todos os
candidatos, lidas lado a lado. Você não precisa de métrica para ver que um
fornecedor colocou a fala do profissional na boca do paciente. Se um for
visivelmente melhor, pare aqui.

**Passo 2 — só se empatar.** Aí vale medir: WER, **cpWER** (`meeteval`), DER
(`pyannote.metrics`), custo por minuto na fatura real, latência, e contagem
manual de erros em nomes de medicamentos e dosagens.

> **Truque que economiza horas:** grave cada pessoa num microfone separado (dois
> celulares serve). Some os canais para gerar o arquivo de teste; guarde os
> canais separados como gabarito de quem-falou-quando. DER e cpWER saem de
> graça, sem rotular nada à mão.

> O cpWER não é opcional. A documentação (§7) traz o caso de "15% DER com 31%
> cpWER" no mesmo áudio: o DER parecia ótimo enquanto um terço das palavras
> estava atribuída ao falante errado.

**Saída:** `docs/adr/0002-fornecedor-asr.md`.

---

## ⚠️ O corpus não entra no repositório

O `.gitignore` bloqueia `spikes/**/corpus/` e todo formato de áudio.

Mesmo sendo consultas **simuladas**, tratá-las como dado real desde o começo
cria o hábito certo. O dia em que alguém gravar um piloto com paciente de
verdade, o hábito já estará formado — e ninguém vai lembrar de mudar o
`.gitignore` naquele momento.

Guarde o corpus e o *ground truth* fora do Git, com backup próprio.
