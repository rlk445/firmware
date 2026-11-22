@echo off
chcp 65001 >nul
title VR Stream - servidor (deixe esta janela aberta)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado.
  echo  Baixe a versao LTS em https://nodejs.org , instale com as opcoes padrao e de dois cliques neste arquivo de novo.
  echo.
  start https://nodejs.org
  pause
  exit /b
)

rem --- libera o Firewall do Windows uma unica vez (pede permissao de administrador) ---
netsh advfirewall firewall show rule name="SKZ VR 8080" >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Primeira vez: vou liberar o Firewall do Windows para o celular conseguir conectar.
  echo  Clique em SIM na janela de permissao que vai aparecer.
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~dp0liberar-firewall.bat' -Verb RunAs -Wait"
  netsh advfirewall firewall show rule name="SKZ VR 8080" >nul 2>nul
  if errorlevel 1 (
    echo  Nao consegui liberar o Firewall. Se o celular nao conectar, rode este arquivo de novo e clique SIM.
  ) else (
    echo  Firewall liberado.
  )
  echo.
)

node server.js %*
echo.
echo  O servidor parou. Veja a mensagem acima.
pause
