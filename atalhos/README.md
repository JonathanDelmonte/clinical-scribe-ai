# Atalhos

Dois cliques, sem terminal.

| Arquivo | O que faz |
|---|---|
| **`iniciar.bat`** | Sobe tudo: Docker, banco, motor de transcrição, aplicação e worker. Abre o navegador no fim. |
| **`parar.bat`** | Desliga tudo, preservando banco e modelos. |

## Entrar na aplicação

O navegador abre em `/entrar`, porque a aplicação pede login desde o Marco 5. O
`pnpm db:seed` cria duas contas de desenvolvimento:

| E-mail | Cargo | O que muda |
|---|---|---|
| `ana@consultaviva.local` | `professional` | O caso comum: plano grátis, motor `local`, quota de 300 min |
| `dev@consultaviva.local` | `developer` | Escolhe o motor em cada sessão e não tem quota |

**Senha das duas: `consulta-viva-dev`.** É pública de propósito — estas contas
só existem em banco local, e `.local` não resolve em lugar nenhum. Ver
[ADR-0004](../docs/adr/0004-autenticacao.md).

## O que o `iniciar.bat` faz, em ordem

1. **Docker Desktop** — abre se estiver fechado e espera o daemon aceitar
   conexão. Leva de 30 s a 2 min; um `docker compose` disparado antes disso
   falha com um erro que não explica a causa.
2. **Dependências** — `pnpm install` só na primeira vez. Cria o `.env` a partir
   do modelo se ele não existir.
3. **Motor de transcrição** — detecta se a máquina tem placa NVIDIA e escolhe
   entre GPU e CPU. A diferença medida foi de 0,78x para 10,35x de tempo real:
   uma consulta de 30 min processa em 3 min em vez de 38.
4. **Espera o motor responder** — na primeira execução ele baixa alguns GB de
   modelo. Sem essa espera o worker pegaria um job e falharia contra um serviço
   que ainda não terminou de carregar.
5. **Banco** — schema, políticas de segurança e os dois usuários de
   desenvolvimento.
6. **Aplicação e worker** — cada um na sua janela. Separadas de propósito: os
   dois imprimem log o tempo todo, e misturar as saídas torna impossível saber
   qual dos dois falhou.

## Detalhes que custaram um erro cada

**`ping` no lugar de `timeout`.** O `timeout` do Windows aborta com *"não há
suporte para o redirecionamento de entrada"* sempre que a entrada padrão não é
um console — o que acontece em execução automatizada, agendador de tarefas e
CI. Funcionaria no duplo-clique e falharia em todo o resto.

**Estes arquivos precisam de CRLF.** O repositório normaliza tudo para LF por
causa do CI em Linux, mas arquivos `.bat` com LF fazem o interpretador se
comportar errado em rótulos e `goto`, sem dar pista de que o problema é
terminação de linha. A exceção está no `.gitattributes` da raiz.

**`cd /d "%~dp0.."`** — `%~dp0` é a pasta deste script. Como ele mora em
`atalhos/`, precisa subir um nível antes de rodar qualquer coisa.

## Quando algo dá errado

| Sintoma | Provável causa |
|---|---|
| "Docker não respondeu em 4 minutos" | Docker Desktop travado — abra à mão e espere ficar verde |
| "porta em uso" | Rodou `iniciar` duas vezes. Use `parar.bat` antes |
| "autenticação falhou" no banco | Outro PostgreSQL ocupando a 5433 |
| Motor demora muito na 1ª vez | Normal: download de vários GB. Acompanhe com `pnpm asr:logs` |
