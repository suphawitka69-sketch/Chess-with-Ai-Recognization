@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
	echo Python environment is missing. Running setup.bat ...
	call setup.bat
	if errorlevel 1 exit /b 1
)
".venv\Scripts\python.exe" -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)" >nul 2>nul
if errorlevel 1 (
	echo Python environment is not usable on this computer. Running setup.bat ...
	call setup.bat
	if errorlevel 1 exit /b 1
)
set PYTHONIOENCODING=utf-8
set PORT=%1
if "%PORT%"=="" set PORT=5000
echo Starting on http://localhost:%PORT%   (Ctrl+C to stop)
start "" http://localhost:%PORT%
".venv\Scripts\python.exe" app.py %PORT%
