# TADA Single-Agent RL

Reinforcement-learning controller for **air-traffic arrival sequencing**: a single agent
issues clearances (speed / vectoring / trombone / skip) to a fleet of inbound aircraft to
hit their AMAN target landing times while keeping them separated.

- **Algorithm:** vanilla **PPO** with a custom autoregressive policy (`ATCAutoregressivePolicy`) — aircraft head → clearance head conditioned on sampled aircraft; masks read from obs. Legacy flat `Discrete(220)` + `MaskablePPO` retained behind `Config.USE_AUTOREGRESSIVE_ACTIONS = False`. See [Training](training.md).
- **Simulator:** Rust `flight_simulator` (PyO3 wheel), driven through a deterministic rollout.
- **Branch:** `UM-lg`.

!!! info "This site is the current source of truth"
    It supersedes the older `SB3_MIGRATION_AND_INSTRUMENTATION.md`. Pages are kept in sync
    with the code on `UM-lg`.

## Where the project stands

| | |
|---|---|
| **Best run** | [`atc_run_1_22`](experiments.md#run-13) — MXP trombone, 8 M steps. First `success_rate = 1.0` evaluations; worst-aircraft deviation **24 s**, `eval/mean_reward` **+43.8**. |
| **Open problem** | **Stability, not capability.** `success_rate` oscillates 0.0–1.0 between eval passes instead of converging, and `1_22` ended on a trough (sustained ~0.41). |
| **Second airspace** | BGY **point-merge** ([runs `1_24` / `1_24_pms`](experiments.md#run-15)) is learnable but unsolved — best success 0.20, worst dev 158–211 s. |
| **In flight** | [`atc_run_1_25_trombone_relaxed`](experiments.md#run-16) — `1_22`'s exact recipe with the [realised-only conflict gate](separation.md). |
| **Settled** | Conflict avoidance. `no_near_conflicts_mean` = 0.99–1.00 in every run since `1_17`; **every** failure since has been a schedule-deviation failure. |
| **Closed** | Finer *temporal* control (22 s interval) — [runs 10–11](experiments.md#run-10) tested it cleanly and it lost to 45 s. Action *magnitude* granularity remains open. |

## Quickstart

Training runs in the conda env **`tada`** (Python 3.12):

```bash
cd reinforcement_learning/single_agent_rllib

# fresh run (2 M steps)
/home/leander/miniconda3/envs/tada/bin/python -u main.py

# resume from latest checkpoint of a previous run
/home/leander/miniconda3/envs/tada/bin/python -u main.py \
  --resume experiments/atc_run_1_16 --total-timesteps 3000000
```

Watch it live — TensorBoard is now under each run's `tb/` sub-directory:

```bash
/home/leander/miniconda3/envs/tada/bin/tensorboard \
  --logdir reinforcement_learning/single_agent_rllib/experiments
```

There are **no console entry scripts** — run `main.py` directly. Base install is a
lightweight *inference* set; add `pip install -e .[train]` for the full training stack.

## Where to look

| Page | What's in it |
|------|--------------|
| [MDP & Environment](mdp.md) | action space, episode, termination & success criteria |
| [Observations](observations.md) | the Dict obs, per-aircraft features, normalization |
| [Reward](reward.md) | imminence-dominant conflict, landing-weighted deviation, terminal bonus |
| [Loss of separation](separation.md) | what `LOSS_OF_SEPARATION` means, severity ↔ distance, realised vs. predicted |
| [Training](training.md) | MaskablePPO + VecNormalize config, callbacks, network |
| [Instrumentation](instrumentation.md) | every TensorBoard metric and what to watch |
| [Experiment log](experiments.md) | what changed in each run and what we learned |
| [Successful results](successful_results.md) | curated renders + refusal-shield sweeps for the best checkpoints, per run |
| [Roadmap](roadmap.md) | what's next (finer actions, reward-peaking bonus) |

## Build the docs

```bash
pip install -e .[docs]      # mkdocs + mkdocs-material
mkdocs serve                # live preview at http://127.0.0.1:8000
mkdocs build                # static site -> ./site
```
