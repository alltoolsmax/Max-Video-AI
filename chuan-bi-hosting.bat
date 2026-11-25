@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Chua co Node.js 20+. Tai tai https://nodejs.org roi chay lai. & pause & exit /b 1)
set /p DOMAIN=Ten mien may chu (Enter = active.mrhuynh.net): 
if "%DOMAIN%"=="" set DOMAIN=active.mrhuynh.net
call node tools/prepare-hosting.js %DOMAIN%
explorer hosting\upload
pause
