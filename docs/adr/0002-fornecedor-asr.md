# ADR-0002 — Motor de transcrição e diarização

- **Status:** em andamento — Marco 1
- **Aberto em:** 15/09/2026
- **Decisores:** Jonathan Delmonte

## Contexto

Este é o portão que decide se o produto existe. A pergunta:

> Existe um motor que transcreva e separe vozes em português brasileiro, em
> áudio real de consultório, com qualidade suficiente e custo viável — e, de
> preferência, sem tirar o áudio do país?

A ordem de avaliação começa pelo **local** (Whisper + pyannote em
`services/asr-local`), porque ele responde três perguntas de uma vez: qualidade,
viabilidade do plano grátis, e residência de dados. Ver §Marco 1 do
[plano](../PLANO-DE-DESENVOLVIMENTO.md).

## Medições

### Ambiente

| | |
|---|---|
| Máquina | Windows 10, 16 CPUs, 15 GB RAM |
| Execução | Docker Desktop (WSL2) — **não** Linux nativo |
| Modelo | faster-whisper, `compute_type=int8`, CPU, 16 threads |
| Áudio | 1,7 min de diálogo sintético em pt-BR (TTS do Windows) |

> ⚠️ **O que estas medições NÃO dizem.** O áudio é sintético: prosódia
> artificial, sem ruído, sem sobreposição, sem sotaque. Serve para provar que o
> encanamento funciona e para medir **velocidade**. Não diz nada sobre
> qualidade em consulta real — isso exige o corpus gravado (ver
> `spikes/README.md`).
>
> E o Docker Desktop no Windows passa por uma camada de virtualização. Num
> servidor Linux dedicado o mesmo modelo tende a ser sensivelmente mais rápido.

### Velocidade

| Modelo | Fator de tempo real | Consulta de 30 min levaria | Veredito |
|---|---|---|---|
| `medium` | 0,78x | ~38 min | Mais lento que a própria consulta |
| `small` | **1,79x** | **~17 min** | 2,3x mais rápido que `medium` |
| `large-v3` | não medido | — | Inviável em CPU, pela extrapolação |

**O que estes números significam.** Para um plano grátis assíncrono — em que a
nota chega por notificação e não na hora — ambos são toleráveis isoladamente. O
problema aparece na **fila**: com `medium`, dez consultas grátis chegando
juntas fazem a última esperar mais de seis horas; com `small`, menos de três. O
dimensionamento do plano grátis depende disso tanto quanto do custo.

### Qualidade observada (indicativa, áudio sintético)

A surpresa: **`small` não foi pior que `medium` neste áudio** — em um trecho
foi melhor. Os dois erraram nos mesmos lugares perigosos.

| Falado | `medium` | `small` | Gravidade |
|---|---|---|---|
| "dipirona" | "de pirona" ✗ | "de pirona" ✗ | **Alta** — nome de medicamento |
| "Começou depois que" | "Como é que ou depois que" ✗ | "Como é que eu depois que" ✗ | Média — distorce a história |
| "fica só nas costas" | "fica-se nas costas" ✗ | "fica só nas costas" ✓ | Baixa |
| "medicação" | "medicacão" ~ | "medicacau" ✗ | Baixa |

> **Não conclua daqui que `small` basta.** Áudio sintético não tem ruído,
> sobreposição nem sotaque — que é exatamente onde modelos maiores costumam
> abrir vantagem. Este resultado justifica *testar* `small` no corpus real, não
> *adotá-lo*.

O erro de medicamento apareceu nos dois modelos e é exatamente o que a §11 da
documentação aponta como risco: soa plausível e passa despercebido numa revisão
rápida. **O corpus real precisa contar erros de medicamento e dosagem à mão** —
nenhuma métrica agregada como WER separa "de pirona" de um erro inofensivo.

### Diarização

**Ainda não medida.** O pyannote exige aceitar os termos de
`pyannote/speaker-diarization-3.1` no Hugging Face e um token gratuito.

O serviço degrada de forma graciosa sem o token: transcreve e devolve tudo como
`SPEAKER_00`, marcando `diarization_applied: false`. Isso é deliberado — um
serviço que transcreve sem separar vozes ainda é útil; um serviço que não sobe,
não.

## Decisão

**Pendente.** Falta:

- [ ] **Habilitar diarização** (`HF_TOKEN`) e medir separação de vozes — é o
      único passo que depende de ação humana: criar conta gratuita no Hugging
      Face, aceitar os termos do modelo, gerar token
- [ ] Gravar o corpus real — 2 consultas de 8 min, cenários em `spikes/README.md`
- [ ] Medir `small` e `medium` no corpus real — o empate no áudio sintético
      provavelmente não se repete com ruído
- [ ] Testar os fornecedores de nuvem com região brasileira (Google STT v2
      `southamerica-east1`, Azure Speech Brazil South), se o local não passar
- [ ] Medir num servidor Linux, não em Docker Desktop no Windows

## Consequências já visíveis

- **A arquitetura de dois motores está validada.** `resolveEngine()` decide,
  `TranscriptionProvider` abstrai, e trocar de motor é configuração. Qualquer
  que seja o resultado do spike, a troca custa um arquivo.
- **O plano grátis precisa comunicar a fila.** "Sua nota fica pronta em até uma
  hora" é uma promessa honesta e funciona como diferenciação do Pro. Prometer
  imediato e entregar em 40 minutos, não.
- **`large-v3` em CPU está praticamente descartado** para produção. Se a
  qualidade do `medium` não bastar, o caminho é GPU (custo fixo maior) ou
  fornecedor de nuvem, não um modelo maior no mesmo hardware.
