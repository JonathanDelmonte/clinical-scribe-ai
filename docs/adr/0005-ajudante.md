# ADR-0005 — O ajudante: o motor no computador de cada pessoa, sem Docker

> Status: **etapa 1 implementada** (instalador, motor, bandeja) · 01/10/2026.
> **Etapa 2 implementada, testada e implantada** (o site manda as consultas e
> o cadastro da voz de cada pessoa para o ajudante dela) · 05/10/2026. O
> ajudante 0.2.0 está publicado. Ver "Etapa 2".

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

## Etapa 2: o site manda o trabalho para o ajudante

Com o ajudante da pessoa ligado, as consultas DELA são transcritas lá; com
ele desligado, a estação (o Docker) atende, como sempre.

### Quem processa o quê

| | Estação | Ajudante |
|---|---|---|
| Transcrição (`transcribe`) | de quem não tem ajudante ligado | só as do próprio profissional |
| Cadastro da voz (`voice_embedding`) | idem | idem |
| Nota, objetivo, retenção, segundo microfone | sempre | — |

"Ligado" é visto há menos de 45 segundos **e** com o motor pronto — em pausa
pelo Docker, o ajudante não tira trabalho da estação. Quem pegou cada job fica
em `jobs.helper_id`, e só quem pegou renova a concessão e entrega. Se o
ajudante some no meio, a concessão (dois minutos) vence e a estação refaz.

### O ajudante faz a parte pesada; o site decide

O ajudante não tem conexão com o banco, nem chave nenhuma. Ele recebe uma
**ordem de serviço** — links assinados para baixar o áudio e enviar a cópia
guardada, e os parâmetros do motor — e devolve o que o motor respondeu. Quem
confere a quota, identifica os papéis, grava os trechos e trava transcrição
truncada é o **site**, chamando as mesmas etapas que a estação chama
(`@scribe/processamento`, extraídas do handler do worker sem mudar o
comportamento).

O motivo é a versão. Um ajudante instalado num computador qualquer fica
desatualizado; se as regras morassem nele, uma correção na identificação de
papéis só valeria para quem reinstalasse. Morando no site, vale para todos no
deploy seguinte. O que o ajudante faz — baixar, converter, transcrever — é
estável como o próprio motor.

Tudo o que chega do ajudante é conferido (`zod`) antes de tocar o banco, e o
site só aponta a sessão para uma cópia que o armazenamento confirma ter.

### Conectar sem senha no programa

Como os aplicativos que "entram com o Google" (OAuth para aplicativos
nativos, com PKCE): o ajudante abre o navegador em `/ajudante/conectar`; a
pessoa, já dentro da conta, confirma; o site devolve um **convite** assinado
(cinco minutos) pelo endereço local do computador (127.0.0.1); o ajudante o
troca, com um verificador que nunca saiu dele, por um **token** próprio. O
banco guarda só o SHA-256 do token; o ajudante o guarda cifrado pelo Windows
(DPAPI). Desconecta-se pelo menu da bandeja ou pelos ajustes do site, e
desinstalar também desconecta.

Dois cuidados que os testes fixam (`packages/auth/src/ajudante.test.ts`): o
convite é assinado com uma chave **derivada**, diferente da do cookie — senão
um convite interceptado valeria como sessão por cinco minutos —, e cada
convite conecta um computador só (nonce único no banco).

### Os arquivos

O áudio vai e volta por **links assinados** que expiram em uma hora: no S3
(produção), a assinatura é do próprio armazenamento (`urlAssinada`, testada
contra o exemplo publicado pela AWS), e o áudio não passa por função do site
— que nem aceitaria corpos desse tamanho. No disco local de desenvolvimento,
quem assina é o site, numa rota própria.

### O cadastro da voz, pela fila

O site guarda a amostra e enfileira `voice_embedding`; quem processa grava os
256 números e apaga a amostra na hora (também na recusa por amostra curta e
na última tentativa de uma falha). A tela acompanha a tarefa; antes de pedir a
gravação, ela pergunta se há quem processe — um ajudante da pessoa, ou uma
estação viva (`stations`, o sinal de vida que o worker grava a cada 30 s com
o motor de pé).

### Privilégios

O site faz, em nome do ajudante, o que por desenho é só do worker: mudar o
status de um job e registrar o uso. Isso roda com `service_role`, numa
transação curta, sempre filtrada pelo job, pelo profissional e pelo ajudante
já conferidos — a mesma disciplina do worker, e a regra do `rls.sql` (todo uso
de `service_role` diz por quê, no próprio código: `lib/ajudante/conta.ts`).

### Testado de ponta a ponta (05/10)

Com o site, o banco e o armazenamento locais, a conta de teste e uma consulta
fictícia de 50 s (duas vozes sintéticas do Windows, nenhum dado real):

| | Resultado |
|---|---|
| Estação, consulta | pronta em 72 s; cópia M4A guardada; 13 trechos, papéis certos |
| Estação, voz | na fila → processando → pronta; a amostra saiu do armazenamento |
| Conexão do ajudante | entrar → voltar à página com os parâmetros → convite → token |
| Ajudante, consulta | processada em 28 s, com o andamento na tela; job "pego por" o computador; uso `ajudante:large-v3`; a estação não tocou nela |
| Ajudante, voz | 0,5 s; a amostra saiu do armazenamento |
| Desconectar pelo site | o ajudante percebeu em 13 s e esqueceu a conta |
| Links assinados no S3 de produção | envio 200, download 200 e idêntico, arquivo inexistente 404 |

Um detalhe de teste, não do produto: o navegador embutido do aplicativo do
Claude não segue o redirecionamento para 127.0.0.1 no fim da conexão (Chrome
e Edge seguem — é o mesmo caminho do `gh auth login`). O teste completou a
volta à mão, com `AJUDANTE_NAVEGADOR=nenhum`.

### A ordem da implantação

1. **Migração no banco** (`helpers`, `stations`, `jobs.helper_id`) — só
   acrescenta: o site e o worker antigos continuam funcionando.
2. **A estação com o worker novo** (`--build`): o antigo não conhece
   `voice_embedding` e marcaria como falha os cadastros de voz que pegasse.
3. **O site** (o push no `main`).
4. **O executável** publicado (ver "O download", abaixo).

### O download

O botão "Baixar o ajudante" aponta sempre para o site
(`/api/ajudante/baixar`, só para quem tem conta), e é o servidor que decide
para onde mandar — o link nunca muda quando o arquivo muda de lugar:

- `AJUDANTE_DOWNLOAD_URL`, se definida: qualquer endereço.
- Senão, a Release mais recente do GitHub, pela API, com o arquivo de nome
  fixo `ConsultaViva-Ajudante.exe`. O repositório **não precisa ser
  público**: privado, basta `GITHUB_TOKEN_RELEASES` na Vercel — um token de
  leitura só deste repositório. A API devolve um link temporário do próprio
  GitHub, e o arquivo vai direto de lá para o navegador.
- Sem nada publicado, a pessoa volta aos ajustes com um aviso.

O Supabase gratuito não serve aqui: o limite é 50 MB por arquivo, e o
executável tem 116 MB (o Electron sozinho passa dos 50).

## O que falta

- **Etapa 3: a nota sem depender de computador ligado.** O site gera a nota
  com a chave de IA de cada pessoa.
- **Executável sem assinatura digital.** Na primeira vez, o SmartScreen
  avisa "O Windows protegeu o computador", e é preciso clicar em "Mais
  informações" → "Executar assim mesmo". Some com um certificado de assinatura
  de código, que é pago.
- **Atualização manual:** baixar a versão nova e escolher Reinstalar.
- **Segundo microfone pelo ajudante.** A diarização por dois canais continua
  só na estação: precisa do motor, mas só atende quem usa dois celulares.
