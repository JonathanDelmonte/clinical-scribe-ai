# ADR-0005 — O ajudante: o motor no computador de cada pessoa, sem Docker

> Status: **etapa 1 implementada** (instalador, motor, bandeja) · 01/10/2026.
> A etapa 2 — o site mandando as consultas de cada pessoa para o ajudante
> dela — é a próxima. Ver "O que falta", no fim.

---

## O pedido

- O processamento é sempre num computador, nunca na nuvem: no computador de
  quem atende, para ser rápido.
- Sem Docker nem terminal. Um programa que se baixa, instala com uma tela de
  carregamento (nada de janela de comando) e fica ao lado do relógio, na
  bandeja do Windows, enquanto a pessoa usa o produto.
- Antes de qualquer coisa, três opções: **Instalar**, **Reinstalar
  (reparar)** e **Desinstalar**. Reinstalar instala por cima, e é também como
  uma versão nova entra.
- Docker ligado no mesmo computador, o ajudante para: o motor do Docker
  atende.
- Sem segredos dentro do programa, porque ele vai ser compartilhado. Nem a
  chave do banco, nem chave de IA: cada pessoa usa a própria (ADR-0003).

## Por que um programa, e não o navegador

O motor é o mesmo do Docker (`services/asr-local/app.py`): Whisper large-v3,
pyannote e torch com CUDA. São uns 9 GB entre Python, bibliotecas e modelos,
e a separação de vozes não roda no navegador. O site continua sendo o lugar
de tudo o que a pessoa vê; o ajudante só transcreve.

## A decisão

| Escolha | Por quê |
|---|---|
| **Electron, um executável só** (`apps/ajudante`, alvo `portable`) | Bandeja, janela com o mesmo visual do site (Respiro) e o mesmo TypeScript do resto do projeto. O arquivo baixado é o instalador; copiado para a pasta de programas, é o próprio ajudante. |
| **Por usuário, sem administrador** | Programa em `%LOCALAPPDATA%\Programs\Consulta Viva Ajudante`, dados em `%LOCALAPPDATA%\ConsultaViva\Ajudante`. Aparece em Configurações → Aplicativos (o "Desinstalar" de lá abre a nossa tela), tem atalho no Menu Iniciar e inicia com o Windows (desligável no menu da bandeja). |
| **Python próprio, pelo uv** | O uv vem dentro do ajudante, conferido por SHA-256, e instala um Python 3.10 só dele (`--no-bin --no-registry`: nada no PATH, nada no registro do Windows). O torch é o cu124 com placa NVIDIA de 4 GB ou mais e driver novo, e o de CPU nos demais casos (`logica/maquina.ts`). |
| **Motor escondido, em 127.0.0.1:8765, sem internet** | Sem janela de comando. `HF_HUB_OFFLINE` e a telemetria do pyannote desligada: o que o motor recebe não sai do computador. |
| **Docker ligado, ajudante em pausa** | A cada 10 s o ajudante olha a porta do Docker (8001). Duas respostas seguidas *do nosso motor* pausam o ajudante e soltam a placa de vídeo; duas ausências seguidas o religam (`logica/docker.ts`). As portas são diferentes de propósito: a disputa seria pela placa, não pela porta. |

### Os modelos, e de onde vem cada um

| Modelo | Licença | De onde |
|---|---|---|
| Whisper large-v3 (`Systran/faster-whisper-large-v3`) | MIT | Baixado do Hugging Face na instalação, sem token |
| Impressão vocal (`pyannote/wespeaker-voxceleb-resnet34-LM`) | CC-BY-4.0 | Idem |
| Separação de vozes (`speaker-diarization-3.1` e `segmentation-3.0`) | MIT | **Dentro do ajudante**, com `LICENCA.txt`. No Hugging Face eles exigem aceitar um formulário; a MIT permite levá-los junto, e ninguém precisa de conta lá |

Cada modelo fica numa pasta própria, como arquivos comuns
(`modelos/whisper/large-v3`, `modelos/pyannote/...`), e o `config.yaml` da
separação aponta para os arquivos locais.

## O que a instalação de verdade ensinou

Cada item abaixo derrubou uma instalação real antes de ser corrigido.

1. **O cache do Hugging Face usa links simbólicos**, e o Windows sem Modo de
   desenvolvedor não deixa criá-los ("o cliente não tem o privilégio
   necessário"). Os modelos vão para pastas próprias (`local_dir`), sem links.
2. **O pyannote escolhe como carregar um modelo pelo nome.** Um caminho com
   "wespeaker" e sem "pyannote" é carregado como modelo ONNX, e falha. Por
   isso a impressão vocal mora dentro de `modelos/pyannote/`.
3. **Duas versões da cuDNN no mesmo processo derrubam o motor.** O
   ctranslate2 (Whisper) traz só a peça de entrada da cuDNN, na 9.10, e a
   carrega ao ser importado; o torch traz a cuDNN inteira, na 9.1. A peça 9.10
   procura nas bibliotecas 9.1 uma função que elas não têm, e o processo cai
   com `0xC0000409` ao usar a placa ("Could not load symbol
   cudnnGetLibConfig"). A instalação deixa uma versão só, a do torch, como no
   Docker.
4. **O caminho de um modelo tem o nome do usuário do Windows.** O motor
   informava o modelo pelo valor de `WHISPER_MODEL`, no `/health` e em cada
   transcrição, que o site guarda. Agora informa só o nome
   (`WHISPER_MODEL_NAME`, `EMBEDDING_MODEL_NAME`).
5. **O uv cria um atalho de versão do Python** (uma junção
   `cpython-3.10` → `cpython-3.10.21`) depois de instalar, e acusa erro quando
   a junção não se resolve, com o Python já inteiro. O ajudante não usa o
   atalho: segue pelo caminho real.
6. **O uv mexe no computador, se deixar.** Por padrão ele põe um
   `python3.10.exe` em `~/.local/bin` e registra o Python no Windows.
   Desligado com `--no-bin --no-registry`.
7. **Duas cópias do torch.** Copiando do cache do uv para o ambiente do
   motor, a instalação ocupava 13 GB, e a conferência de espaço pedia 10: um
   disco quase cheio passaria nela e encheria no meio. O ambiente agora
   aponta para os arquivos do cache (hardlinks), e a instalação ocupa 8,3 GB.
   O cache fica, para reparar sem baixar de novo.
8. **O Electron enxerga o `app.asar` como pasta.** Copiar ou apagar a pasta
   do programa pelo `fs` comum falha com "Invalid package"; a instalação usa
   o `original-fs`.
9. **No Windows, o filho não morre com o pai.** Com o ajudante encerrado à
   força (Gerenciador de Tarefas), o motor ficava órfão, segurando a porta e
   uns 4 GB da placa de vídeo. Agora o motor acompanha o processo do ajudante
   (`AJUDANTE_PID`) e sai junto, em menos de 4 segundos.
10. **Um programa não apaga a própria pasta.** Desinstalado de dentro dela
    (pelas Configurações do Windows), o ajudante agenda a remoção da pasta
    para a hora em que fecha, e não para o fim da desinstalação: a pessoa
    pode ficar minutos na tela final.

## Medido, numa RTX 3060

| | Tempo |
|---|---|
| Instalar do zero (6 GB de download) | 2 min 57 s |
| Reinstalar, com o ajudante ligado (do cache) | 2 min 50 s |
| Desinstalar | 5 s, e a pasta do programa 4 s depois de fechar |
| Ligar o motor, já instalado | 17 a 20 s |
| Docker ligou → ajudante em pausa, placa livre | 13 s |
| Docker desligou → ajudante de volta e pronto | 37 s |

Disco: 8,3 GB (cache do uv com o torch 4,9; modelos 2,9; programa 0,4;
Python 0,1). O executável baixável tem 116 MB.

**Para quem for testar:** rodando o ajudante de dentro de um programa
empacotado (MSIX), como o terminal do aplicativo do Claude, o Windows
redireciona o que é gravado em `%LOCALAPPDATA%` para a pasta privada desse
programa (`%LOCALAPPDATA%\Packages\<programa>\LocalCache\Local`), e as junções
lá dentro não se resolvem (o item 5). Atalho, registro e início com o Windows
também ficam invisíveis para o resto do sistema. Quem abre o ajudante com dois
cliques não passa por isso. O teste que vale é o de dois cliques.

## O que falta

- **Etapa 2: o site manda as consultas para o ajudante.** Hoje o motor do
  ajudante fica pronto, mas quem processa as consultas ainda é a estação (o
  Docker), pela fila. Falta: o ajudante entrar com a conta da pessoa (pelo
  navegador, sem senha no programa), uma chave por profissional, o sinal de
  "ligado", o ajudante pegar na fila as consultas da pessoa dele e devolver o
  resultado, e a estação deixar de pegar as consultas de quem está com o
  ajudante ligado. O cadastro da voz passa a ir pela mesma fila
  ([PENDENCIAS.md](../PENDENCIAS.md), primeiro item).
- **Etapa 3: a nota sem depender de computador ligado.** O site gera a nota
  com a chave de IA de cada pessoa.
- **Executável sem assinatura digital.** Na primeira vez, o SmartScreen
  avisa "O Windows protegeu o computador", e é preciso clicar em "Mais
  informações" → "Executar assim mesmo". Some com um certificado de assinatura
  de código, que é pago.
- **Atualização manual:** baixar a versão nova e escolher Reinstalar.
