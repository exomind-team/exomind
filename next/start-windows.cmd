@echo off
setlocal
cd /d "%~dp0"
node -e "const [v,m]=process.versions.node.split('.').map(Number);process.exit(v>22||(v===22&&m>=16)?0:1)" >nul 2>nul
if errorlevel 1 (
  echo Requires Node.js 22.16 or newer. See README.md.
  pause
  exit /b 1
)
node runtime/cli.mjs --data-dir .local\rebuild --open
pause
