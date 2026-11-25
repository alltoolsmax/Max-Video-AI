@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Chua co Node.js 20+. Tai tai https://nodejs.org roi chay lai. & pause & exit /b 1)
call npm install || (pause & exit /b 1)
call npx electron-builder --win nsis --x64 --publish never || (pause & exit /b 1)
call node tools/make-downloads.js
echo.
echo Xong. Bo cai: dist\MaxAI-Setup-*.exe  ·  goi tai len: dist\downloads\
pause
