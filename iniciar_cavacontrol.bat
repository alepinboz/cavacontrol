@echo off
title CavaControl - Gestion de Vinos (MS SQL Server 2019)
color 0A
echo ===================================================
echo     Cavacontrol - Gestion de Emprendimiento de Vinos
echo     Conectando a Microsoft SQL Server 2019...
echo ===================================================
echo.

cd /d "%~dp0"

echo [1/2] Verificando base de datos CavaControlDB en SQL Server...
"%USERPROFILE%\.local\bin\uv.exe" run --with pyodbc python init_db.py

echo.
echo [2/2] Iniciando Servidor API local y abriendo aplicacion...
start "" "http://localhost:3001"
"%USERPROFILE%\.local\bin\uv.exe" run --with pyodbc --with bottle python server.py

pause
