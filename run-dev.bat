@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Chua co Node.js 20+. Tai tai https://nodejs.org roi chay lai. & pause & exit /b 1)
if not exist node_modules (echo Dang cai thu vien lan dau... & call npm install || (pause & exit /b 1))
call npm start
