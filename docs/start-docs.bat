@echo off
rem nihon-tidy: start the docs server and open the usage page in the browser
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js 18+ is required: https://nodejs.org/ & pause & exit /b 1)
node scripts\serve.js 8080 --open
pause
