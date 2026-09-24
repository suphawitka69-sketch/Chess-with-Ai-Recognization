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
PORT=${1:-5000}
echo "Starting on http://localhost:$PORT   (Ctrl+C to stop)"
(command -v open >/dev/null && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") || true
"$VENV_PY" app.py "$PORT"
