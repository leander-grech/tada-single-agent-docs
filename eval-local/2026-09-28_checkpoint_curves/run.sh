#!/bin/bash
# Per-checkpoint 20-flight scores (every ~1M steps) for runs that only had a final evaluation, scored
# on the laptop with the pinned-frame scorer. Outputs go to the docs repo; the code repo is only read.
set -u
CODE=/home/leander/code/tada/monorepo/reinforcement_learning/single_agent_rllib
OUT=/home/leander/code/tada/tada-single-agent-docs/eval-local/2026-09-28_checkpoint_curves
PY=/home/leander/miniconda3/envs/tada/bin/python
export OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 PYTHONUNBUFFERED=1
cd "$CODE"
s() { # id seqobs models...
  local id=$1 seq=$2; shift 2
  echo "$(date +%T) start $id cpu=$(cat /sys/class/thermal/thermal_zone*/temp | sort -n | tail -1)" >> $OUT/progress.txt
  TADA_SEQUENCE_OBS=$seq $PY -u analysis/score_windowed.py --models "$@" --seeds 100 --workers 6 \
      --csv $OUT/${id}_ckpts.csv 2>&1 | grep -v '^\[config' > $OUT/${id}_ckpts.log
  echo "$(date +%T) done $id exit=${PIPESTATUS[0]}" >> $OUT/progress.txt
}
s 1_38 1 experiments/atc_run_1_38_windowed_cont/checkpoints/ppo_tada_1003520_steps.zip experiments/atc_run_1_38_windowed_cont/checkpoints/ppo_tada_2002944_steps.zip experiments/atc_run_1_38_windowed_cont/checkpoints/ppo_tada_3002368_steps.zip experiments/atc_run_1_38_windowed_cont/checkpoints/ppo_tada_4001792_steps.zip experiments/atc_run_1_38_windowed_cont/final_model.zip
s 1_36 1 experiments/atc_run_1_36_windowed_multipick/checkpoints/ppo_tada_1003520_steps.zip experiments/atc_run_1_36_windowed_multipick/checkpoints/ppo_tada_2002944_steps.zip experiments/atc_run_1_36_windowed_multipick/checkpoints/ppo_tada_3002368_steps.zip experiments/atc_run_1_36_windowed_multipick/checkpoints/ppo_tada_4001792_steps.zip
s 1_37 1 experiments/atc_run_1_37_windowed_control/checkpoints/ppo_tada_1003520_steps.zip experiments/atc_run_1_37_windowed_control/checkpoints/ppo_tada_2002944_steps.zip experiments/atc_run_1_37_windowed_control/checkpoints/ppo_tada_3002368_steps.zip experiments/atc_run_1_37_windowed_control/checkpoints/ppo_tada_4001792_steps.zip
s 1_39 1 experiments/atc_run_1_39_windowed_safety/checkpoints/ppo_tada_1003520_steps.zip experiments/atc_run_1_39_windowed_safety/checkpoints/ppo_tada_2002944_steps.zip experiments/atc_run_1_39_windowed_safety/checkpoints/ppo_tada_3002368_steps.zip experiments/atc_run_1_39_windowed_safety/checkpoints/ppo_tada_4001792_steps.zip
s 1_35 1 experiments/atc_run_1_35_windowed_jax/checkpoints/ppo_tada_1003520_steps.zip experiments/atc_run_1_35_windowed_jax/checkpoints/ppo_tada_2002944_steps.zip experiments/atc_run_1_35_windowed_jax/checkpoints/ppo_tada_3002368_steps.zip experiments/atc_run_1_35_windowed_jax/checkpoints/ppo_tada_4001792_steps.zip
s 1_31 0 experiments/atc_run_1_31_windowed/checkpoints/ppo_tada_1000000_steps.zip
echo ALL_DONE >> $OUT/progress.txt
