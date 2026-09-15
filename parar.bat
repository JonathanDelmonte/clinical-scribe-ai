@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Consulta Viva - parando

echo.
echo   Parando a Consulta Viva...
echo.

REM As janelas da APLICACAO e do WORKER sao fechadas pelo titulo. `taskkill /T`
REM leva junto os processos filhos — sem isso o `next dev` sobrevive ao
REM fechamento do cmd que o iniciou e continua segurando a porta 3000, e a
REM proxima subida falha com "porta em uso" sem explicar quem a ocupa.
taskkill /FI "WINDOWTITLE eq Consulta Viva - APLICACAO*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Consulta Viva - WORKER*"    /T /F >nul 2>&1
echo   [ok] aplicacao e worker encerrados.

REM Containers param, mas os VOLUMES ficam: o banco e os modelos do Whisper
REM sobrevivem. Apagar os modelos custaria gigabytes de download na proxima vez.
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile asr stop >nul 2>&1
if errorlevel 1 docker compose --profile asr stop >nul 2>&1
echo   [ok] containers parados (dados e modelos preservados).

echo.
echo   O Docker Desktop continua aberto. Feche pela bandeja se quiser.
echo.
ping -n 5 127.0.0.1 >nul
exit /b 0
