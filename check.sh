#!/usr/bin/env bash
cd "$(dirname "$0")"
VENV_PY=""
if [ -x .venv/bin/python ]; then
  VENV_PY=".venv/bin/python"
elif [ -x .venv/Scripts/python.exe ]; then
  VENV_PY=".venv/Scripts/python.exe"
elif [ -x .venv/Scripts/python ]; then
  VENV_PY=".venv/Scripts/python"
else
  echo "Run  bash setup.sh  first."; exit 1
fi
export PYTHONIOENCODING=utf-8
"$VENV_PY" check_project.py
echo; echo "--- pytest ---"
"$VENV_PY" -m pytest -q
