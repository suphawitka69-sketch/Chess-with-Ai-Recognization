#!/usr/bin/env bash
cd "$(dirname "$0")"
VENV_PY=""
if [ -x .venv/bin/python ]; then
  VENV_PY=".venv/bin/python"
elif [ -x .venv/Scripts/python.exe ]; then
  VENV_PY=".venv/Scripts/python.exe"
elif [ -x .venv/Scripts/python ]; then
  VENV_PY=".venv/Scripts/python"
fi
if [ -z "$VENV_PY" ] || ! "$VENV_PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)' >/dev/null 2>&1; then
  echo "Python environment is missing or unusable. Running setup.sh ..."
  bash setup.sh || exit 1
  if [ -x .venv/bin/python ]; then VENV_PY=".venv/bin/python"; else VENV_PY=".venv/Scripts/python.exe"; fi
fi
export PYTHONIOENCODING=utf-8
PORT=${1:-5000}
echo "Starting on http://localhost:$PORT   (Ctrl+C to stop)"
(command -v open >/dev/null && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") || true
"$VENV_PY" app.py "$PORT"
