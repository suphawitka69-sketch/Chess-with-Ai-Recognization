@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo === Computer Programming Project : setup ===
where python >nul 2>nul || (echo [!] python not found. Install Python 3.12+ from python.org and tick "Add python.exe to PATH". & pause & exit /b 1)
python -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)" || (echo [!] Python 3.11 or newer is required. & python --version & pause & exit /b 1)
set "VENV_PY=%CD%\.venv\Scripts\python.exe"
set "RECREATE_VENV=0"
if exist "%VENV_PY%" (
  "%VENV_PY%" -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)" >nul 2>nul
  if errorlevel 1 set "RECREATE_VENV=1"
) else (
  set "RECREATE_VENV=1"
)
if "%RECREATE_VENV%"=="1" (
  if exist .venv (
    echo [1/2] removing unusable .venv ...
    rmdir /s /q .venv
  )
  echo [1/2] creating .venv ...
  python -m venv .venv || (echo [!] could not create .venv & pause & exit /b 1)
) else (
  echo [1/2] .venv already works on this computer
)
echo [2/2] installing flask + pytest ...
".venv\Scripts\python.exe" -m pip install --quiet --no-index --find-links wheels -r requirements.txt 2>nul
if errorlevel 1 (
  echo     offline wheels did not match this Python - trying online ...
  ".venv\Scripts\python.exe" -m pip install --quiet -r requirements.txt || (echo [!] install failed - check your internet connection & pause & exit /b 1)
)
".venv\Scripts\python.exe" -c "import flask, pytest; print('    flask', flask.__version__ if hasattr(flask,'__version__') else 'ok', '/ pytest', pytest.__version__)"
echo.
echo Done. Next:  run.bat   (opens the site)    check.bat   (score + tests)
pause
