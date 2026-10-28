#!/usr/bin/env bash
# The TADA Lab runner: flies agents for the docs' Lab page (published or local) on this machine.
#   lab/run.sh [--check] [--open] [--host 0.0.0.0] [--port 8800] [--registry-only]
# First time: lab/setup.sh /path/to/single_agent_rllib (creates lab/.venv and lab/runner.env).
# The runner also serves the Lab itself at http://localhost:8800/lab/ when site/ is built, for browsers
# that keep the published https page off localhost.
cd "$(dirname "$0")/.."
# lab/runner.env (written by lab/setup.sh) fills in TADA_CODE_REPO / TADA_PY unless they are already set
if [ -f lab/runner.env ]; then
  while IFS='=' read -r k v; do
    case "$k" in TADA_*) [ -z "${!k:-}" ] && export "$k=$v" ;; esac
  done < lab/runner.env
fi
if [ -z "${TADA_PY:-}" ]; then
  if [ -x lab/.venv/bin/python ]; then TADA_PY=$PWD/lab/.venv/bin/python; else TADA_PY=$HOME/miniconda3/envs/tada/bin/python; fi
fi
if [ ! -x "$TADA_PY" ]; then echo "run: no Python environment for the runner; run lab/setup.sh first" >&2; exit 1; fi
export TADA_PY
EXTRA=()
if [ ! -f site/index.html ] && "$TADA_PY" -c "import mkdocs" 2>/dev/null; then EXTRA=(--build); fi
exec "$TADA_PY" lab/server.py "${EXTRA[@]}" "$@"
