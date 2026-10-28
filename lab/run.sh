#!/usr/bin/env bash
# The TADA Lab runner: flies agents for the docs' Lab page (published or local) on this machine.
#   lab/run.sh [--open] [--host 0.0.0.0] [--port 8800] [--registry-only]
# Needs the single-agent code repo and its `tada` conda env (TADA_CODE_REPO, TADA_PY override the defaults).
# The first start builds the docs into site/ (if mkdocs is available), so the runner also serves the Lab
# itself at http://localhost:8800/lab/ -- for browsers that keep the published https page off localhost.
cd "$(dirname "$0")/.."
PY=${TADA_PY:-$HOME/miniconda3/envs/tada/bin/python}
export TADA_PY=$PY
EXTRA=()
if [ ! -f site/index.html ] && "$PY" -c "import mkdocs" 2>/dev/null; then EXTRA=(--build); fi
exec "$PY" lab/server.py "${EXTRA[@]}" "$@"
