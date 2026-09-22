@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
REM `%~dp0` e a pasta deste script (atalhos\). Subimos um nivel para a
REM raiz do projeto, que e onde o pnpm e o docker compose precisam rodar.
cd /d "%~dp0.."
title Consulta Viva - iniciando

echo.
echo   ========================================
echo     CONSULTA VIVA - subindo o ambiente
echo   ========================================
echo.

REM ===========================================================================
REM  `ping` e nao `timeout` como cronometro: o `timeout` do Windows aborta com
REM  "nao ha suporte para o redirecionamento de entrada" sempre que a entrada
REM  padrao nao for um console — o que acontece em execucao automatizada, em
REM  agendador de tarefas e em CI. O `ping` para o proprio loopback funciona em
REM  qualquer contexto e e o cronometro classico do batch.
REM ===========================================================================

REM ===========================================================================
REM  1. Docker Desktop
REM
REM  Tudo depende dele: banco e motor de transcricao rodam em container. Se nao
REM  estiver no ar, abrimos e esperamos — Docker Desktop leva de 30s a 2min
REM  para o daemon aceitar conexao, e um `docker compose` disparado antes disso
REM  falha com um erro que nao explica a causa.
REM ===========================================================================
echo [1/6] Docker Desktop...
docker info >nul 2>&1
if not errorlevel 1 (
  echo       ja esta rodando.
  goto :docker_pronto
)

set "DOCKER_EXE="
for %%P in (
  "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
  "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
  "%ProgramFiles(x86)%\Docker\Docker\Docker Desktop.exe"
) do (
  if exist %%P if not defined DOCKER_EXE set "DOCKER_EXE=%%~P"
)

if not defined DOCKER_EXE (
  echo.
  echo   [ERRO] Docker Desktop nao encontrado.
  echo   Abra o Docker Desktop manualmente e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

echo       abrindo, aguarde...
start "" "!DOCKER_EXE!"

set /a tentativas=0
:espera_docker
docker info >nul 2>&1
if not errorlevel 1 goto :docker_pronto
set /a tentativas+=1
if !tentativas! gtr 48 (
  echo.
  echo   [ERRO] Docker nao respondeu em 4 minutos.
  echo   Abra o Docker Desktop, espere ficar verde, e rode de novo.
  echo.
  pause
  exit /b 1
)
ping -n 6 127.0.0.1 >nul
goto :espera_docker

:docker_pronto
echo       pronto.
echo.

REM ===========================================================================
REM  2. Dependencias
REM ===========================================================================
echo [2/6] Dependencias...
if not exist "node_modules" (
  echo       primeira execucao, instalando...
  call pnpm install
  if errorlevel 1 goto :erro_pnpm
) else (
  echo       ja instaladas.
)

if not exist ".env" (
  echo       criando .env a partir do modelo...
  copy /y ".env.example" ".env" >nul
)
echo.

REM ===========================================================================
REM  3. Motor de transcricao: GPU se houver, CPU se nao
REM
REM  A diferenca medida nesta maquina foi de 0,78x (CPU) para 10,35x (GPU com
REM  inferencia em lote) — uma consulta de 30 min sai em 3 min em vez de 38.
REM  Mas a reserva de GPU FALHA em maquina sem placa, entao a escolha e feita
REM  aqui em vez de estar fixa no compose.
REM ===========================================================================
echo [3/6] Banco de dados e motor de transcricao...
where nvidia-smi >nul 2>&1
if errorlevel 1 (
  echo       placa NVIDIA nao detectada - usando CPU.
  set "COMPOSE=docker compose -f docker-compose.yml"
) else (
  nvidia-smi >nul 2>&1
  if errorlevel 1 (
    echo       nvidia-smi falhou - usando CPU.
    set "COMPOSE=docker compose -f docker-compose.yml"
  ) else (
    echo       placa NVIDIA detectada - usando GPU.
    set "COMPOSE=docker compose -f docker-compose.yml -f docker-compose.gpu.yml"
  )
)

!COMPOSE! --profile asr up -d
if errorlevel 1 goto :erro_docker
echo.

REM ===========================================================================
REM  4. Espera o motor responder
REM
REM  Na primeira execucao ele baixa alguns GB de modelo. Sem esta espera, o
REM  worker subiria, pegaria um job e falharia contra um servico que ainda nao
REM  terminou de carregar.
REM ===========================================================================
echo [4/6] Aguardando o motor de transcricao...
set /a tentativas=0
:espera_asr
curl -s -o nul -m 3 http://localhost:8001/health
if not errorlevel 1 goto :asr_pronto
set /a tentativas+=1
if !tentativas! gtr 120 (
  echo.
  echo   [AVISO] O motor demorou mais de 10 minutos.
  echo   Pode ser download de modelo. Veja o log com:  pnpm asr:logs
  echo.
  goto :asr_pronto
)
if !tentativas!==12 echo       ainda subindo (primeira vez baixa o modelo, seja paciente)...
ping -n 6 127.0.0.1 >nul
goto :espera_asr

:asr_pronto
echo       pronto.
echo.

REM ===========================================================================
REM  5. Schema, politicas de seguranca e dados de desenvolvimento
REM ===========================================================================
echo [5/6] Preparando o banco...
call pnpm db:migrate
if errorlevel 1 goto :erro_db
call pnpm db:seed
if errorlevel 1 goto :erro_db
echo.

REM ===========================================================================
REM  6. Aplicacao e worker, cada um na sua janela
REM
REM  Janelas separadas de proposito: os dois ficam imprimindo log, e misturar
REM  as duas saidas no mesmo terminal torna impossivel entender qual dos dois
REM  falhou quando algo da errado.
REM ===========================================================================
echo [6/6] Subindo aplicacao e worker...
start "Consulta Viva - APLICACAO" cmd /k "cd /d "%~dp0.." && pnpm dev"
start "Consulta Viva - WORKER"    cmd /k "cd /d "%~dp0.." && pnpm dev:worker"

echo       aguardando a aplicacao responder...
set /a tentativas=0
:espera_web
curl -s -o nul -m 3 http://localhost:3000
if not errorlevel 1 goto :web_pronta
set /a tentativas+=1
if !tentativas! gtr 40 goto :web_pronta
ping -n 4 127.0.0.1 >nul
goto :espera_web

:web_pronta
echo.
echo   ========================================
echo     TUDO NO AR
echo   ========================================
echo.
echo     Aplicacao:  http://localhost:3000
echo     Motor:      http://localhost:8001/health
echo.
REM ===========================================================================
REM  A aplicacao pede login desde o Marco 5, e a senha das contas de
REM  desenvolvimento passa correndo na saida do `pnpm db:seed`, la em cima.
REM  Repetir aqui e a diferenca entre "abriu e funciona" e "abriu numa tela de
REM  login e agora?".
REM ===========================================================================
echo     ENTRAR COM:
echo       ana@consultaviva.local   (profissional, plano free)
echo       dev@consultaviva.local   (developer, escolhe o motor)
echo.
echo       senha das duas:  consulta-viva-dev
echo.
echo     Duas janelas foram abertas (APLICACAO e WORKER).
echo     Fechar qualquer uma delas derruba aquela parte.
echo.
echo     Para desligar tudo:  parar.bat
echo.
start "" http://localhost:3000/entrar
ping -n 4 127.0.0.1 >nul
exit /b 0

REM ===========================================================================
REM  Erros
REM ===========================================================================
:erro_pnpm
echo.
echo   [ERRO] Falha ao instalar dependencias.
echo   Verifique se o Node 24+ e o pnpm estao instalados:  node -v  e  pnpm -v
echo.
pause
exit /b 1

:erro_docker
echo.
echo   [ERRO] Falha ao subir os containers.
echo   Veja o que aconteceu com:  docker compose --profile asr logs
echo.
pause
exit /b 1

:erro_db
echo.
echo   [ERRO] Falha ao preparar o banco.
echo   Confira se a porta 5433 esta livre e se o container subiu:  docker ps
echo.
pause
exit /b 1
