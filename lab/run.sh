#!/usr/bin/env bash
# The TADA Lab runner: flies agents for the docs' Lab page (published or local) on this machine.
#   lab/run.sh [--open] [--host 0.0.0.0] [--port 8800]
# Needs the single-agent code repo and its `tada` conda env (TADA_CODE_REPO, TADA_PY override the defaults).
cd "$(dirname "$0")/.."
PY=${TADA_PY:-$HOME/miniconda3/envs/tada/bin/python}
export TADA_PY=$PY
exec "$PY" lab/server.py "$@"
