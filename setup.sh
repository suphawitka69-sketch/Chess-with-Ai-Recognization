#!/usr/bin/env bash
# Computer Programming Project : setup (macOS / Linux)     usage:  bash setup.sh
cd "$(dirname "$0")"
PY=python3; command -v python3 >/dev/null 2>&1 || PY=python
command -v $PY >/dev/null 2>&1 || { echo "[!] python not found. Install Python 3.12+"; exit 1; }
$PY -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)' || { echo "[!] Python 3.11 or newer is required"; $PY --version; exit 1; }
if [ ! -d .venv ]; then echo "[1/2] creating .venv ..."; $PY -m venv .venv || exit 1; else echo "[1/2] .venv already exists"; fi

VENV_PY=""
if [ -x .venv/bin/python ]; then
  VENV_PY=".venv/bin/python"
elif [ -x .venv/Scripts/python.exe ]; then
  VENV_PY=".venv/Scripts/python.exe"
elif [ -x .venv/Scripts/python ]; then
  VENV_PY=".venv/Scripts/python"
else
  echo "[!] virtual environment python not found"; exit 1
fi

echo "[2/2] installing flask + pytest ..."
if ! "$VENV_PY" -m pip install --quiet --no-index --find-links wheels -r requirements.txt 2>/dev/null; then
  echo "    offline wheels did not match this Python - trying online ..."
  "$VENV_PY" -m pip install --quiet -r requirements.txt || { echo "[!] install failed"; exit 1; }
fi
"$VENV_PY" -c "import flask, pytest; print('    flask ok / pytest', pytest.__version__)"
echo; echo "Done. Next:  bash run.sh   (opens the site)    bash check.sh   (score + tests)"
