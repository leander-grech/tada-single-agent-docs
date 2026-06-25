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
| [Training](training.md) | MaskablePPO + VecNormalize config, callbacks, network |
| [Instrumentation](instrumentation.md) | every TensorBoard metric and what to watch |
| [Experiment log](experiments.md) | what changed in each run and what we learned |
| [Roadmap](roadmap.md) | what's next (finer actions, reward-peaking bonus) |

## Build the docs

```bash
pip install -e .[docs]      # mkdocs + mkdocs-material
mkdocs serve                # live preview at http://127.0.0.1:8000
mkdocs build                # static site -> ./site
```
