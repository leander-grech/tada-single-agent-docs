#!/bin/bash
# The champion 1_38 on three over-capacity validation seeds, rendered on the laptop one at a time
# (single thread). Run from the code repo root; outputs land in the docs repo.
set -u
CODE=/home/leander/code/tada/monorepo/reinforcement_learning/single_agent_rllib
DOCS=/home/leander/code/tada/tada-single-agent-docs
OUT=$DOCS/render-meta/2026-09-28_1_38_overcapacity
PY=/home/leander/miniconda3/envs/tada/bin/python
export OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
cd "$CODE"
M=experiments/atc_run_1_38_windowed_cont/final_model.zip
r() { # name seed paired_attempts
  echo "$(date +%T) start $1 cpu=$(cat /sys/class/thermal/thermal_zone*/temp | sort -n | tail -1)" >> $OUT/progress.txt
  $PY -u render_policy.py --env windowed --model $M --seed $2 --paired-attempts $3 \
      --out $OUT/$1.mp4 --solutions-json $OUT/$1_solutions.json 2>&1 | grep -v '^\[config' > $OUT/$1.log
  echo "$(date +%T) done $1 exit=${PIPESTATUS[0]}" >> $OUT/progress.txt
}
r 1_38_overcap_solved_deterministic_seed1461364854 1461364854 0
r 1_38_overcap_safe_best_seed1123251507 1123251507 9
r 1_38_overcap_worst_best_seed1159417075 1159417075 9
echo ALL_DONE >> $OUT/progress.txt
