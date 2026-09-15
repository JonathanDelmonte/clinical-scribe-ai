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
| GPU | NVIDIA RTX 3060, 12 GB |
| Motor | faster-whisper — `int8` em CPU, `float16` em GPU |
| Áudio | diálogos sintéticos em pt-BR (TTS do Windows), 38,8s e 103,7s |

> ⚠️ **O que estas medições NÃO dizem.** O áudio é sintético: prosódia
> artificial, sem ruído, sem sobreposição, sem sotaque. Serve para provar que o
> encanamento funciona e para medir **velocidade**. Não diz nada sobre
> qualidade em consulta real — isso exige o corpus gravado (ver
> `spikes/README.md`).
>
> E o Docker Desktop no Windows passa por uma camada de virtualização. Num
> servidor Linux dedicado o mesmo modelo tende a ser sensivelmente mais rápido.

### Velocidade

| Configuração | Tempo real | Consulta de 30 min | Completa? |
|---|---|---|---|
| CPU · `medium` · sequencial | 0,78x | ~38 min | sim |
| CPU · `small` · sequencial | 1,79x | ~17 min | sim |
| GPU · `large-v3` · **em lote** | **27x** | 1,1 min | ❌ **trunca em 30s** |
| **GPU · `large-v3` · sequencial** | **12,8x** | **2,3 min** | ✅ **sim** |

> ⚠️ **Correção de uma medição anterior deste documento.** A versão anterior
> registrava "GPU sequencial 0,52x — mais lento que a CPU" e atribuía isso a
> ociosidade entre rajadas de kernel. **Estava errado:** aquela medição incluía
> o carregamento do modelo na VRAM. Medido com o modelo quente, sequencial dá
> 12,8x. O diagnóstico de "GPU pior que CPU" não se sustenta.

### O bug que quase entrou em produção

A inferência em lote é 2x mais rápida e foi adotada primeiro. Ela **trunca
silenciosamente**.

Quando o VAD encontra uma única região de fala contínua maior que a janela de
30 segundos do Whisper, o pipeline em lote transcreve os primeiros 30 segundos
e **descarta o resto** — sem erro, sem aviso, com resposta HTTP 200 e texto
coerente.

Medido num áudio de 38,8s com pausas de 500 ms entre as falas:

```
sequencial   termina em 37,5s   perde 1,3s (só silêncio)   ✅
em lote      termina em 29,6s   perde 9,2s                 ❌
```

O mesmo lote acertou num áudio de 103s — porque ali as pausas eram de 600 ms e
o VAD partiu em oito regiões. **A falha depende do padrão de pausa da
conversa**, que é exatamente o que varia entre uma consulta e outra.

Numa consulta de 30 minutos entre duas pessoas que se falam sem pausas longas,
o produto entregaria o primeiro meio minuto. E o que se perde no fim de uma
consulta é a conduta: a receita e a data de retorno.

**Decisão: batching desligado.** Dobrar 1,1 para 2,3 minutos numa consulta
inteira é preço irrisório por não perder a prescrição. `WHISPER_BATCH_SIZE`
continua configurável para quem quiser medir, mas o padrão é zero.

### Duas outras correções da mesma investigação

**`condition_on_previous_text=False`.** O padrão do Whisper realimenta o texto
anterior como contexto, e isso produziu duas falhas medidas: encerrar a
transcrição 5,9s antes do fim do áudio, e **alucinar um fecho que ninguém
disse** ("Obrigado."). Desligado, o custo em velocidade é desprezível (11,8x
contra 12,8x) e o texto termina onde o áudio termina.

**Trava de cobertura.** O serviço agora compara onde o texto termina com onde o
áudio termina e devolve `truncated: true` quando a diferença passa de 5
segundos. O worker marca a sessão como **falha** nesse caso — preservando os
trechos para diagnóstico, mas impedindo que uma consulta cortada chegue ao
profissional rotulada como "pronta para revisão".

Essa trava existe porque a classe de falha é invisível por construção: resposta
de sucesso, texto plausível, e o final faltando. Sem ela, a descoberta viria de
alguém notar que a prescrição sumiu da nota — provavelmente depois de o
paciente ir embora.

### Diarização: funcionando

Separação de vozes validada num diálogo sintético de duas vozes distintas:
**10 de 10 trechos atribuídos corretamente.**

Duas dependências precisaram de ajuste, e as duas falhavam com erros que não
mencionavam a causa:

| Problema | Erro que aparecia | Correção |
|---|---|---|
| `huggingface-hub` 1.x removeu `use_auth_token` | `hf_hub_download() got an unexpected keyword argument 'use_auth_token'` | teto `<1.0` no requirements |
| `pyannote.core` usa `matplotlib` sem declarar | `No module named 'matplotlib'` | adicionado explicitamente |

O serviço degradou com elegância nos dois casos: continuou transcrevendo,
devolveu tudo como um falante só, e reportou o motivo exato em
`diarization_error`.

### Implicação para a arquitetura do plano grátis

A margem do freemium depende de GPU, não de CPU. Com ~12x de tempo real, uma
placa processa cerca de 17 mil minutos de áudio por dia; com 25% de utilização
real, atende algo como **1.000 usuários grátis por GPU**. Um servidor com GPU
custa na casa de R$ 500–1.500/mês — custo **fixo**, que não cresce a cada novo
usuário grátis, ao contrário de API por minuto.

Em CPU pura o plano grátis continua possível, mas com fila longa e a promessa
tendo que ser "sua nota fica pronta em até uma hora".

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

## Decisão

**Pendente.** Falta:

- [x] **Habilitar diarização** (`HF_TOKEN`) e medir separação de vozes — é o
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
- **O plano grátis precisa comunicar a fila.** "Sua nota fica pronta em alguns
  minutos" é honesto com GPU. Em CPU vira "em até uma hora" — também honesto, e
  funciona como diferenciação do Pro. Prometer imediato e entregar em 40
  minutos, não.
- **`large-v3` em CPU está descartado** para produção. Se a qualidade do
  `medium` não bastar, o caminho é GPU (custo fixo maior) ou fornecedor de
  nuvem, não um modelo maior no mesmo hardware.
- **Velocidade nunca justifica perda silenciosa de dado.** O batching era 2x
  mais rápido e foi descartado por truncar. Numa ferramenta clínica, a falha
  que não avisa é pior que a lentidão que avisa — e este ADR agora carrega uma
  trava automatizada para essa classe de bug, não só a lembrança dela.
- **Toda dependência de IA precisa de teto de versão.** Duas quebras nesta
  investigação vieram de major que subiu sozinha (`huggingface-hub` 1.x) ou de
  dependência não declarada (`matplotlib`). O ecossistema de ML é jovem e
  quebra compatibilidade com frequência.
