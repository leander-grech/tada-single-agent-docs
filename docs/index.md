# TADA Single-Agent RL

!!! abstract "TL;DR"
    A single RL agent sequences up to 10 inbound aircraft into Milan Malpensa, issuing one
    clearance per 45 s to hit AMAN target landing times without losing separation.

    **Current best — run `1_26`, 22 clearances, scored on 100 fixed seeds:** success **0.70**,
    losses of separation **0.07**, worst-aircraft deviation **43 s**. The clean-subset success
    rate that had held near 53.7% across twenty runs reached **0.753**.

    **Run `1_27` tested a reduced 15-clearance set on top and did not beat it** — success
    **0.64**, a statistical tie, but worst-aircraft deviation **doubled to 87 s**. It learns much
    faster and converges worse, and a mid-run crash changed its learning-rate schedule, so the
    comparison is not decisive. See [22 clearances vs 15](analysis_v1_v2.md).

    **Read numbers only from `analysis/track_run.py`.** The in-training `success_rate` is a
    5-episode rolling window and reported 1.00 for a run whose true rate was 0.38.

![Runs 1_26 and 1_27 scored on 100 fixed eval seeds](assets/1_26_vs_1_27_training_curve.png)

- **Algorithm:** PPO with a custom autoregressive policy (`ATCAutoregressivePolicy`) — aircraft
  head → clearance head conditioned on the sampled aircraft, masks read from the observation.
  See [Training](training.md).
- **Simulator:** Rust `flight_simulator` (PyO3 wheel), driven through a deterministic rollout.
- **Scenario:** MXP trombone (`VALIDATION_USE_CASE_1`). BGY point-merge exists but underperforms.
- **Branch:** `UM-lg`.

!!! info "This site is the current source of truth"
    Pages are kept in sync with the code on `UM-lg`. Each page opens with a TL;DR; the detail
    below it is not repeated across pages, so follow the links rather than expecting each page
    to stand alone.

## Quickstart

Training runs in the conda env **`tada`** (Python 3.12):

```bash
cd reinforcement_learning/single_agent_rllib

# fresh run
python -u main.py --total-timesteps 10000000 --run-suffix my_experiment

# score its checkpoints on the fixed 100-seed pool while it trains
python analysis/track_run.py --run experiments/atc_run_1_28_my_experiment

# replay an OLD run whose action set differs (see MDP -> action-set versions)
TADA_ACTION_SET=v1 python render_policy.py \
  --model experiments/atc_run_1_26_sep3nm/best/best_model.zip --seeds 1595180635
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
| [Reward](reward.md) | severity geometry, exponential conflict decay, landing-weighted deviation, tier ladder |
| [Training](training.md) | PPO + VecNormalize config, callbacks, network, snapshots |
| [Instrumentation](instrumentation.md) | every TensorBoard metric and what to watch |
| [Experiment log](experiments.md) | what changed in each run and what we learned |
| [Successful results](successful_results.md) | curated renders + refusal-shield sweeps for the best checkpoints, per run |
| [How an agent is tested](analysis_methods.md) | every metric defined from the code — success, the clean set, pass@k, what not to quote |
| [Test log](analysis_log.md) | every test run against an agent, in order, with the question it settled |
| [22 clearances vs 15](analysis_v1_v2.md) | the `1_26` vs `1_27` head-to-head |
| [Roadmap](roadmap.md) | what's next, and what is designed but unbuilt |

## Build the docs

```bash
pip install -e .[docs]      # mkdocs + mkdocs-material
mkdocs serve                # live preview at http://127.0.0.1:8000
mkdocs build                # static site -> ./site
```
