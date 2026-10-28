#!/usr/bin/env bash
# One-time setup of the TADA Lab runner on this machine (Linux x86-64, Python 3.12).
#   lab/setup.sh /path/to/monorepo/reinforcement_learning/single_agent_rllib
# Creates lab/.venv (CPU-only: ~1 GB, a few minutes), installs the simulator wheel from the code repo,
# writes lab/runner.env so lab/run.sh needs no arguments, builds the docs, and runs the preflight check.
set -euo pipefail
cd "$(dirname "$0")/.."
die() { echo "setup: $*" >&2; exit 1; }

CODE=${1:-${TADA_CODE_REPO:-}}
[ -n "$CODE" ] || die "usage: lab/setup.sh /path/to/monorepo/reinforcement_learning/single_agent_rllib"
[ -d "$CODE" ] || die "$CODE does not exist"
CODE=$(cd "$CODE" && pwd)
[ -f "$CODE/render_policy.py" ] || die "$CODE is not the single-agent code directory (no render_policy.py there)"
[ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || die "the simulator wheel is built for Linux x86-64 only (this is $(uname -s) $(uname -m))"
WHEEL=$(ls "$CODE"/simulator/wheels/flight_simulator-0.2.81-cp312-*manylinux*x86_64.whl 2>/dev/null | head -1)
[ -n "$WHEEL" ] || die "simulator wheel 0.2.81 not found under $CODE/simulator/wheels"
rm -rf lab/.venv

# uv (https://docs.astral.sh/uv/) needs no system venv package and fetches Python 3.12 itself if missing;
# otherwise use a system python3.12 with its venv module.
if command -v uv >/dev/null && [ -z "${PYTHON:-}" ]; then
  echo "setup: creating lab/.venv (Python 3.12) with uv"
  uv venv -q --python 3.12 lab/.venv
  install() { uv pip install -q --python lab/.venv/bin/python --index-strategy unsafe-best-match "$@"; }
else
  PYBIN=${PYTHON:-python3.12}
  command -v "$PYBIN" >/dev/null || die "needs Python 3.12. Easiest: install uv (curl -LsSf https://astral.sh/uv/install.sh | sh), \
which provides Python 3.12 by itself, then re-run; or set PYTHON=/path/to/python3.12"
  "$PYBIN" -c 'import sys; sys.exit(sys.version_info[:2] != (3, 12))' || die "$PYBIN is not Python 3.12"
  echo "setup: creating lab/.venv with $PYBIN"
  if ! "$PYBIN" -m venv lab/.venv >/dev/null 2>&1; then
    rm -rf lab/.venv
    die "$PYBIN cannot create virtual environments. Either install uv (curl -LsSf https://astral.sh/uv/install.sh | sh) \
and re-run, or install the venv module (Debian/Ubuntu: sudo apt install python3.12-venv)"
  fi
  lab/.venv/bin/python -m pip install -q --upgrade pip
  install() { lab/.venv/bin/python -m pip install -q "$@"; }
fi
echo "setup: installing the runner's packages (CPU torch, SB3, matplotlib, mkdocs): a few minutes"
install -r lab/requirements.txt
echo "setup: installing the simulator ($(basename "$WHEEL"))"
install "$WHEEL"

cat > lab/runner.env <<ENV
# written by lab/setup.sh; read by lab/run.sh
TADA_CODE_REPO=$CODE
TADA_PY=$PWD/lab/.venv/bin/python
ENV
echo "setup: building the docs site (served at http://localhost:8800/lab/)"
lab/.venv/bin/python -m mkdocs build -q 2>/dev/null || echo "setup: docs build failed; the runner still works with the published page"
lab/run.sh --check
echo "setup: done. Start the runner with: lab/run.sh"
