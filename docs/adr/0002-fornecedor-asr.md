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

### Primeiro áudio real de consulta

Consulta médica simulada de 11,4 min, gravada em sala de aula: os dois com
**máscara**, microfone de celular, murmúrio de fundo. É o cenário difícil de
propósito.

| | Sintético limpo | **Consulta real** |
|---|---|---|
| Velocidade | 12,8x | **3,4x** |
| 11 min processam em | 0,9 min | **~4 min** |

**Áudio difícil custa 4x mais tempo.** Mais hipóteses no feixe de busca, mais
reprocessamento de trechos incertos. O número honesto para o produto é o da
direita; a régua de laboratório enganava.

#### Dois bugs que só o áudio real revelou

**1. MP3 quebrava a diarização.** `Sizes of tensors must match except in
dimension 0. Expected size 160000 but got size 145516` — 160.000 amostras são
exatamente os 10s da janela de embedding do pyannote. A causa não era o
comprimento do áudio: era o **torchaudio decodificando MPEG diferente do
ffmpeg**. A correção foi decodificar uma vez e passar a mesma forma de onda aos
dois modelos, o que também elimina a decodificação dupla e garante que
timestamps e turnos se refiram ao mesmo áudio.

**2. O progresso nunca chegava.** O endpoint era `async def` com trabalho
bloqueante dentro, o que congela o laço de eventos: `/progress/{job}` ficava sem
resposta exatamente enquanto havia progresso a reportar. Resolvido movendo o
processamento para `asyncio.to_thread`.

#### Qualidade da separação de vozes: parcial

O pyannote acerta **quantas** pessoas são (2), mas erra **onde** ficam as
fronteiras. Informar `num_speakers=2` não mudou nada na qualidade — só deixou
40% mais rápido. 49 dos 147 turnos duram menos de 0,7s.

Duas regras de pós-processamento recuperaram parte:

| | Trechos | "Me chamo Gabriel" |
|---|---|---|
| Sem tratamento | 234 | `Me` / `chamo Gabriel.` ✗ |
| Suavização de turnos curtos | 213 | ainda partido ✗ |
| **+ nenhuma troca sem pausa** | **197** | inteiro ✓ |

A regra forte é a segunda: **ninguém troca de turno sem pausa**. Uma fronteira
de falante entre duas palavras coladas é sempre erro do modelo.

**O que continua errado:** a atribuição oscila entre frases. "Me chamo Gabriel"
e "Sou médico há 5 anos" saem como falantes diferentes, sendo a mesma pessoa.
Nenhum pós-processamento acústico conserta isso sem risco de destruir trocas
legítimas.

**Implicação direta para o Marco 3:** a identificação de papel por conteúdo não
é só um complemento da diarização — em áudio difícil ela é a correção dela. O
LLM lê "Sou médico há 5 anos" e sabe quem fala, independentemente do rótulo
acústico. A §7 da documentação recomenda combinar os dois métodos; este áudio
mostrou por quê.

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
- **Um detector que procura só o termo exato não mede alucinação.** Ver a
  medição do vocabulário abaixo: ele respondeu "zero" enquanto o modelo
  inventava palavras vizinhas às da lista.

## Vocabulário do domínio (`hotwords`) — medido e desligado

> 23/09/2026 · consulta real de 11:24 · `large-v3`, `float16`, CUDA · sem
> diarização (ela não altera o texto)

A hipótese era de que passar ao Whisper os termos da especialidade corrigiria a
grafia de palavras raras — "a azar" por "arder", "lozartana" por "losartana" —
a custo zero. `hotwords` e não `initial_prompt` porque, com
`condition_on_previous_text` desligado, o `initial_prompt` só vale para a
primeira janela de 30 s (conferido no código do faster-whisper 1.1.1, linhas
38–84 e 269–280 de `generate_segments`).

### O controle que torna o resto interpretável

Sem ele, qualquer diferença poderia ser ruído: quando a busca normal falha, o
Whisper recorre a amostragem aleatória. A mesma consulta, sem vocabulário, duas
vezes:

| | Semelhança | Diferenças |
|---|---|---|
| sem vocabulário × sem vocabulário | **1.000** | **0** |

Transcrição determinística. Toda mudança abaixo é do vocabulário.

### O resultado

| Vocabulário | Tokens | Trechos | Semelhança com a base |
|---|---|---|---|
| nenhum | 0 | 194 | 1.000 |
| 3 termos, batendo com a consulta | 16 | 125 | 0.716 |
| 25 termos, clínica médica (bate) | 152 | 161 | 0.674 |
| 25 termos, nutrição (não bate) | 150 | 159 | 0.669 |

| Palavra | Sem | Clínica | Nutrição | 3 termos | |
|---|---|---|---|---|---|
| "churrasco" | 1 | **0** | **0** | **0** | verdadeira, apagada |
| "Sou médico" | 1 | **0** | **0** | 1 | verdadeira, apagada |
| "eletrocardiograma" | 1 | — | — | **0** | verdadeira, **estava na lista** |
| "xarope" | 0 | **1** | 0 | — | inventada |
| "emagrecimento" | 0 | 0 | **4** | — | inventada, em laço |
| "me sinto inútil" | 0 | 0 | **1** | — | sintoma inventado |
| "a azar" | 1 | 0 | 0 | 0 | o erro — corrigido |

Corrigiu um erro conhecido. Em troca apagou conteúdo verdadeiro, inventou um
nome de remédio, entrou em laço de repetição, e fabricou um sintoma depressivo.
Com três termos, **perdeu "eletrocardiograma"** — que saía certo sem ajuda e
estava na própria lista.

### Por quê

`hotwords` é inserido no espaço `sot_prev` — o "texto anterior" — de cada
janela. O modelo transcreve cada 30 s como se tivesse acabado de ouvir aquela
lista. É um `condition_on_previous_text` com contexto falso fixo, e o
condicionamento foi desligado neste mesmo ADR por truncar e alucinar. Os
sintomas (frases que somem, laço de repetição) são os mesmos. Que três termos
desestabilizem quase tanto quanto vinte e cinco confirma que é o mecanismo, não
a quantidade.

### A métrica que enganou

O primeiro detector de dano procurava, na saída, os termos exatos da lista, e
respondeu **zero** nas duas rodadas. O vocabulário não fabrica os termos da
lista: ele empurra o modelo para o domínio, e o modelo inventa palavras
vizinhas — "emagrecimento" não está na lista de nutrição. Só a comparação linha
a linha mostrou o dano.

### Decisão

- `ASR_VOCABULARY=false` por padrão. A chave continua existindo para repetir a
  medição com uma versão nova do modelo sem mexer em código.
- O serviço passou a contar os tokens do vocabulário e dizer se cortou — o corte
  da biblioteca é silencioso. As listas usaram 150–152 de 223; nada cortado.
- **O uso que sobra:** as listas como *dicionário* depois da transcrição,
  corrigindo palavras a pequena distância de edição ("lozartana" → "losartana").
  Isso só toca palavras que já estão lá; não insere, não reorganiza, não tem
  como alucinar. Não implementado.
- Para o erro que motivou tudo ("a azar"), a ferramenta certa já existe: a
  correção do trecho pelo profissional, que guarda o par (errado → certo).

## Limpeza de áudio para o caminho das vozes — medida e descartada

> 23/09/2026 · mesma consulta real de 11:24 · pyannote 3.1 +
> wespeaker-resnet34 · scripts em [`spikes/medicoes/`](../../spikes/medicoes/)

A hipótese vinha de um contraste real: limpar ruído costuma **piorar** o Whisper
(ele foi treinado em áudio sujo), mas diarização e impressão vocal medem timbre,
e ruído é timbre estranho misturado. O desenho seria bifurcar — Whisper no áudio
cru, vozes no limpo — e atacar os 0,17 de separação da consulta com máscara.

Dois limpadores:

- **Neural — DeepFilterNet 3.** Rede treinada para devolver fala limpa.
- **Branda — subtração espectral** (`noisereduce`, estacionária, 80%). Tira o
  ruído constante e mexe o mínimo possível na voz.

### Antes da qualidade, o alinhamento

Se a limpeza atrasasse o áudio, as marcações do pyannote ficariam deslocadas das
palavras do Whisper, e a primeira palavra de cada fala iria para quem falou
antes — sem erro nenhum. Correlação cruzada num trecho de 20 s: **0 amostras de
atraso** nas duas (`pad=True` no DeepFilterNet compensa o filtro). Esse risco
estava coberto.

### Diarização refeita sobre o áudio limpo

| | Cru | Neural | Branda |
|---|---|---|---|
| Fala por falante | 51% / 49% | **100% / 0%** | 51% / 49% |
| Turnos | 147 | 295 | 195 |
| Turnos < 0,7 s | 49 | 111 | 70 |
| Margem entre as vozes | 0,146 | — | 0,175 |

A neural **fundiu as duas pessoas numa só**: todos os 194 trechos foram para o
mesmo falante. A trava "apenas um falante detectado" recusaria gerar nota — o
defeito apareceria alto, não em silêncio — mas o recurso ficaria inútil.

A branda preservou as duas vozes, fragmentou mais a diarização, e *pareceu*
melhorar a margem em 20%.

### O controle que desfez a melhora

As margens acima foram medidas sobre agrupamentos diferentes — cada condição com
a sua diarização. A subida podia ser impressão vocal mais nítida **ou** falas
reagrupadas de outro jeito. Fixando a divisão do áudio cru e trocando só o áudio
de onde sai a impressão vocal:

| Mesma divisão, áudio da impressão vocal | Margem | Fala mais perto do próprio falante |
|---|---|---|
| cru | 0,145 | 132/138 (96%) |
| branda | 0,154 | 132/138 (96%) |
| neural | **−0,137** | 129/138 (93%) |

A branda não muda **nenhuma** decisão fala a fala. Os 20% eram do reagrupamento.
A neural tem margem negativa: os dois falantes ficaram mais parecidos entre si
(0,758) do que cada fala com o próprio falante (0,621).

### Por quê

Um limpador neural não só subtrai ruído: ele reconstrói a voz em direção à "fala
limpa" que aprendeu. O que distingue duas pessoas inclui textura e imperfeição de
cada voz — exatamente o que a reconstrução uniformiza. Com máscara e microfone de
celular as duas vozes já eram parecidas; limpas, ficaram iguais.

### Decisão

- **Nenhuma das duas entra no serviço.** Sem dependência nova, sem código de
  produção: a neural destrói a separação, a branda não ajuda a impressão vocal e
  piora a diarização.
- Os scripts ficam em `spikes/medicoes/`, com as três armadilhas do
  DeepFilterNet documentadas, para repetir com versões novas dos modelos.
- O problema que motivou isto — separação de 0,17 em consulta com máscara —
  continua aberto. A alavanca que resta sem custo é **dois microfones**: o canal
  de cada pessoa é o gabarito de quem falou quando, e dispensa diarização.

## Dois microfones — diarização por canal

A alavanca que sobrou. Em vez de perguntar "que voz é esta?" — que falha com
máscara e microfone de celular —, pergunta "qual microfone ouviu mais alto?". O
profissional grava no app, como sempre; um segundo celular, perto do paciente,
grava a mesma consulta com o gravador do próprio aparelho; depois ele envia esse
segundo arquivo na tela da sessão.

### As decisões

1. **O segundo arquivo nunca sai do computador.** O algoritmo só usa a
   *energia* do segundo microfone, não a onda. Então o navegador mede a energia
   a cada 5 ms e envia só essa medida (`envelope.ts`, formato `CVE1`: centésimos
   de dB em 16 bits, com cabeçalho). Uma energia a cada 5 ms não contém
   palavras. De quebra resolve o tamanho: o arquivo do teste abaixo tinha
   39,4 MB, e a medida, 94 KB — acima de 10 MB o Next corta o corpo da
   requisição sem erro, e o segundo microfone ficaria mudo na metade final da
   consulta, atribuindo tudo ali ao lado do principal.
2. **Alinhar antes de comparar.** Os dois aparelhos começam em instantes
   diferentes e os relógios andam em ritmos diferentes. O deslocamento sai da
   correlação dos envelopes; a deriva, da mesma medida em seis janelas e de uma
   reta pelos deslocamentos. O áudio da sessão chega sem o silêncio (o navegador
   corta), e as regiões de fala guardadas na sessão o levam de volta ao relógio
   real para alinhar — e trazem o segundo canal ao tempo enxuto depois.
3. **Onde o segundo aparelho não gravou, nada é decidido.** Ausência de medida é
   `NaN`, não zero: zero diria "silêncio do lado do paciente" e entregaria cada
   fala dali ao lado do principal.
4. **O papel é dito, não adivinhado.** Os turnos dizem de que *lado* a fala
   veio; quem estava de cada lado, quem posicionou os aparelhos sabe — a tela
   pergunta. O classificador de conteúdo de sempre vira conferência: se ele
   discorda com segurança, a confiança cai e a tela avisa.
5. **Os trechos não são recriados.** Mantêm ID (as citações da nota continuam
   valendo) e texto (as correções de texto sobrevivem). Papel corrigido à mão,
   trecho a trecho, não é tocado. A inversão de papéis ("trocar") não congela
   nada — ela corrige a leitura da diarização antiga, não cada fala.
6. **Recusa honesta.** Menos de 5 dB entre os lados, segundo microfone mudo
   (menos de 10 dB entre silêncio e fala), arquivo de outra consulta
   (correlação abaixo de 0,25), cobertura abaixo de metade da consulta, ou
   quase toda a fala de um lado só: a sessão guarda o motivo e a transcrição
   fica como estava.

### Medição com resposta conhecida

Não existe gravação de consulta com dois microfones e gabarito. O teste
(`services/asr-local/teste_canais.py`) fabrica uma: pedaços de duas gravações
reais de um falante só, intercalados num roteiro conhecido de 236 s, com todos
os defeitos de um consultório em valores sabidos — vazamento de −12 dB, segundo
aparelho 6 dB mais baixo, começando 3,7 s depois, relógio 120 ppm adiantado,
ruído diferente em cada canal, silêncio cortado pelo navegador. O segundo canal
passa pelo caminho de produção inteiro: medido, codificado, decodificado.

| | Medido | Real |
|---|---|---|
| Deslocamento | 3,700 s | 3,7 s |
| Deriva | −122 ppm | −120 ppm |
| Precisão (da fala atribuída, quanto está certo) | **100%** | |
| Alcance (da fala que existe, quanto foi atribuído) | 96,9% | |
| Mesmo, no tempo enxuto | 100% · 96,8% | |
| Sem corrigir a deriva | 99,8% | |

Os 3% sem atribuição são os 3,7 s que o segundo aparelho não gravou. Os quatro
casos que devem ser recusados — microfone mudo, os dois no mesmo lugar, arquivo
sem relação, segundo aparelho que parou num terço — foram recusados. O formato
tem um vetor de ouro: o navegador escreve, byte a byte, o que o motor escreve.

**A métrica sem controle enganou de novo** — terceira vez, depois do vocabulário
e da limpeza. Uma taxa única de acerto dava 99% com zeros no lugar do "não
gravou", e 97% depois da correção para `NaN`: parecia piora. Separando precisão
de alcance, a versão com zeros acertava o começo **por sorte** (quem falava ali
era do lado do principal), e a correta simplesmente não decide o que não mediu.

### De ponta a ponta, pelo produto

A mesma conversa sintética, enviada como consulta de verdade na conta de teste:
navegador cortando silêncio, Whisper, pyannote, e o segundo arquivo (39,4 MB,
estéreo a 44,1 kHz, como um celular gravaria) pela tela nova.

| | Agrupamento certo | Papel certo |
|---|---|---|
| Separação por voz (hoje) | 60,2% | 0% (todos "não identificado") |
| Dois microfones | **80,6%** | **80,6%** |
| Teto com os trechos do Whisper | 80,9% | |

Nos 32 trechos de uma pessoa só, **100%**. A perda inteira está em 11 trechos em
que o Whisper juntou falas das duas pessoas: um trecho é atribuído inteiro a
quem mais falou nele. A conversa sintética troca de falante a cada 1,5–5 s, bem
mais rápido que uma consulta; ainda assim é o próximo limite. Quebrar o trecho
na troca de lado exigiria o tempo de cada palavra (não é guardado hoje) e
trocaria IDs citados pela nota — possível só antes de a nota existir.

Processamento: 7 s do envio ao resultado. Reenviar com a posição invertida
inverteu os papéis e manteve o trecho corrigido à mão; apagar a consulta levou
os dois arquivos.

### O que falta

Uma consulta real gravada com dois celulares. Tudo acima é sintético, com
defeitos escolhidos por quem escreveu o teste — o vazamento real de uma sala, o
ganho automático de um celular e a distância real entre as pessoas podem mudar
a separação medida.
