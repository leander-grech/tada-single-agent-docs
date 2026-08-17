# Training Setup


!!! abstract "TL;DR"
    PPO (SB3) with a custom autoregressive policy, 4 parallel envs, 10M steps, ~20 h on one
    box. Rollout buffer pinned at 4096 so worker count is a wall-clock knob and never
    silently an optimiser change.

    LR warms up over the first 8% then half-cosine decays 3e-4 → 3e-5. γ = 0.998.

    Each run writes a `snapshot/` of **every source package**, so the code it ran is recoverable
    from the run directory alone. Progress is scored offline by `analysis/track_run.py` on a
    fixed 100-seed pool — the in-training `success_rate` is a 5-episode rolling window and is
    not a usable measurement.


Source: `main.py`, `network/rlm.py`, `network/autoregressive_policy.py`, `config/config.py`

---

## Run command

```bash
cd reinforcement_learning/single_agent_rllib

# Fresh run (default 2 M steps)
/home/leander/miniconda3/envs/tada/bin/python main.py

# Resume from latest checkpoint of an existing run
/home/leander/miniconda3/envs/tada/bin/python main.py \
  --resume experiments/atc_run_1_16

# Resume with a custom step target and final LR
/home/leander/miniconda3/envs/tada/bin/python main.py \
  --resume experiments/atc_run_1_16 \
  --total-timesteps 5000000 \
  --final-lr 1e-5

# Resume but restart the LR schedule from a fresh starting LR (warm restart)
/home/leander/miniconda3/envs/tada/bin/python main.py \
  --resume experiments/atc_run_1_16 \
  --total-timesteps 5000000 \
  --initial-lr 3e-4 \
  --final-lr 1e-5

# Spinoff from latest checkpoint into a new auto-labelled directory (e.g. atc_run_1_16_a)
/home/leander/miniconda3/envs/tada/bin/python main.py \
  --resume experiments/atc_run_1_16 \
  --new-run \
  --total-timesteps 5000000 \
  --final-lr 1e-5

# Spinoff from a specific checkpoint step (implies --new-run)
/home/leander/miniconda3/envs/tada/bin/python main.py \
  --resume experiments/atc_run_1_16 \
  --checkpoint 1500000 \
  --total-timesteps 5000000 \
  --final-lr 1e-5
```

Conda env: `tada`, Python 3.12.

### CLI arguments

| Argument | Default | Description |
|---|---|---|
| `--resume DIR` | *(none — fresh run)* | Experiment directory to resume from. Auto-detects the latest checkpoint unless `--checkpoint` is given. |
| `--checkpoint STEP` | *(latest)* | Resume from a specific step count (e.g. `1500000`). Implies `--new-run`. |
| `--new-run` | `False` | Write to a new spinoff directory (e.g. `atc_run_1_16_a`) instead of continuing in-place. Name is auto-incremented (`_a`, `_b`, …) by scanning existing dirs. |
| `--total-timesteps N` | 2 000 000 (fresh) / 3 000 000 (resume) | Cumulative timestep target. |
| `--final-lr F` | `3e-5` | LR at end of training. On resume, the schedule decays **linearly from the starting LR** to this value. Set equal to the starting LR for a flat schedule. |
| `--initial-lr F` | *(checkpoint LR)* | Override the LR the resumed schedule **starts** from. If unset, it starts from the LR reached at the checkpoint (read from the optimizer state). Ignored for fresh runs. |

---

## Experiment directory layout

!!! info "Snapshots cover whole packages"
    `snapshot/` contains every `.py` in `actions/`, `atc_env/`, `callbacks/`, `config/`,
    `models/`, `network/`, `simulator/` and `utils/`, plus `main.py` and `render_policy.py`.
    It used to be a curated file list, which went stale silently twice — once when the action
    modules became facades (capturing no clearance definitions at all) and once by never
    listing `utils/infringement_utils.py` or `simulator/route_section_store.py`, both of which
    define MDP. The whole tree is ~505 KB, a quarter of a single checkpoint.

    A partially-copied package is worse than none: its `__init__.py` shadows the live one on
    `sys.path` and its un-copied siblings then fail to resolve. Copying whole packages means a
    snapshot is importable as a unit.


Each run writes to a self-contained directory `experiments/atc_run_1_N/`:

```
experiments/atc_run_1_N/
├── checkpoints/          # ppo_tada_<step>_steps.zip + vecnormalize *.pkl
├── best/                 # best model by eval reward
├── eval_logs/            # eval callback numpy logs
├── tb/                   # TensorBoard + CSV logs
├── snapshot/             # source files copied at launch (reproducibility)
├── run_meta.json         # run name, timestamp, git commit, total_timesteps [, resumed_from]
└── git_diff.patch        # uncommitted diff at launch
```

Point TensorBoard at `experiments/` to see all runs together:

```bash
tensorboard --logdir reinforcement_learning/single_agent_rllib/experiments
```

On resume, new checkpoints, TB events, and CSV rows append to the same directory so the run appears continuous.

On spinoff (`--new-run` or `--checkpoint`), a fresh directory is created; `run_meta.json` gains a `resumed_from` field recording the source directory, checkpoint filename, and step count. The original run's `run_meta.json` is also annotated with `resumed_from` and `extended_total_timesteps` so the lineage is traceable from both sides.

---

## Environment wrappers

```
ATCSingleAgentEnv
  └── Monitor          # records raw episodic returns (rollout/ep_rew_mean)
        └── DummyVecEnv
              └── VecNormalize   # normalizes the reward stream only (norm_obs=False)
```

Two separate env stacks:

| Stack | `norm_reward` | `training` | Purpose |
|---|---|---|---|
| `train_env` | `True` | `True` (default) | Reward normalization for stable value targets |
| `eval_env` | `False` | `False` | Raw reward scale — keeps eval metrics interpretable |

Both use `gamma=0.995` for VecNormalize's running-return estimator.
`norm_obs=False` on both because observations are already in `[-1, 1]`.

On resume, `train_env` is restored via `VecNormalize.load()` from the checkpoint's paired `.pkl` file so the running statistics continue rather than re-initialising.

### Per-scenario episode horizon

Instead of a fixed 64-step cap, the episode length is sized to each scenario's latest arrival ETA (`Config.USE_PER_SCENARIO_HORIZON = True`):

```
max_steps = clip(ceil(max_arrival_eta / TIME_BETWEEN_ACTIONS) + HORIZON_STEP_MARGIN,
                 MIN_EPISODE_STEPS, MAX_EPISODE_STEPS)
```

| Constant | Value | Notes |
|---|---|---|
| `HORIZON_STEP_MARGIN` | 6 | Extra steps for the last aircraft to land and settle (≈ 270 s) |
| `MIN_EPISODE_STEPS` | 48 | Floor |
| `MAX_EPISODE_STEPS` | 130 | Cap (bounds per-step rollout cost) |

This prevents structural timeouts: the eval scenarios' latest arrival ETAs run well beyond the
64 × 45 s = 2880 s fixed horizon. Measured episode lengths on the 100-seed pool are 3105–5715 s.

!!! warning "The halved 22 s interval was reverted"
    Runs 9 and 10 halved `TIME_BETWEEN_ACTIONS` 45 → 22 s (doubling `EPISODE_STEPS`, the three
    horizon caps, `NEIGHBOR_LOOKAHEAD_MULTIPLIER`, `SCENARIO_INITIAL_CONFLICT_FREE_STEPS` and
    `SUCCESS_NEAR_CONFLICT_CLEAR_STEPS` in tandem to preserve their wall-clock meaning) so the
    agent could act twice as often. It **destabilised training and lost** — see the
    [experiment log](experiments.md#run-9). Every run from `1_18` onward is back on 45 s, and
    the constants in the table above are the live ones.

---

## PPO hyperparameters

`Config.USE_AUTOREGRESSIVE_ACTIONS = True` (default) uses vanilla `PPO` with `ATCAutoregressivePolicy`.
The legacy flat `Discrete(150)` + `MaskablePPO` path is selected by setting the flag to `False`
(`Discrete(N_AIRCRAFT_MAX × N_CLEARANCES)`, so 220 under the v1 clearance set).

### Shared hyperparameters (both paths)

| Parameter | Value | Notes |
|---|---|---|
| `learning_rate` | `linear_schedule(3e-4 → 3e-5)` | Decays to tame rising late-training KL |
| `n_epochs` | 5 | Was SB3 default 10 → too much policy drift per rollout |
| `target_kl` | 0.03 | Early-stop once `approx_kl` exceeds this |
| `ent_coef` | 0.01 | Was 0.0 → entropy collapsed and policy plateaued |
| `max_grad_norm` | 1.5 | Was 0.5 → grads saturated the clip (`clip_frac` ≈ 1.0) |
| `gamma` | 0.995 | Raised from 0.99 for credit-assignment reach over longer per-scenario episodes |
| `total_timesteps` | 2 000 000 (default) | Overridden by `--total-timesteps` |

### Resume LR schedule

On `--resume`, the schedule's **starting LR** (`start_lr`) is either `--initial-lr` (if given) or
the LR read from the saved optimizer state (`model.policy.optimizer.param_groups[0]["lr"]`, frozen
as a `float` immediately after `PPO.load()`). SB3 re-evaluates the schedule on the first optimizer
update, so `--initial-lr` also overwrites the LR loaded from the optimizer state. The schedule then:

- at `progress_remaining = p_start = 1 − steps_done / new_total` → returns `start_lr`
- at `progress_remaining = 0` (end of the resumed run) → returns `--final-lr`
- is **clamped to `[final_lr, start_lr]`** — the LR can never exceed `start_lr` even
  if SB3 evaluates the schedule at a `progress_remaining` fractionally above `p_start`

Unlike a backward-extrapolated `linear_schedule(new_initial)`, this approach never
produces a visible spike at the resume boundary. Setting `--final-lr` equal to `start_lr`
gives a **flat schedule** for the remainder. The chosen `start_lr`, the checkpoint LR, and
`--final-lr` are recorded under `lr_schedule` in `run_meta.json`.

---

## Policy network

### Autoregressive path (default): `ATCAutoregressivePolicy` (`network/autoregressive_policy.py`)

The policy owns its encoder and both action heads; no separate `features_extractor_class` is configured.

**Encoding** — shared `ATCEncoder` (from `network/rlm.py`):

| Step | Module | Notes |
|---|---|---|
| Per-aircraft scalars | Linear(12→128) + LayerNorm + ReLU | |
| Flight plan | `FlightPlanConvEncoder` (1D CNN, output 64) | |
| Action history | GRU(input=23, hidden=64), last hidden | |
| Fuse per-aircraft | Linear(256→128) + LayerNorm + ReLU | |
| Masked mean-pool | weighted sum / valid count | → `[B, 128]` |
| Global features | Linear(4→128) + ReLU | |
| Final fusion | Linear(256→128) + LayerNorm + ReLU | → `[B, 128]` |

**Aircraft head** — `Linear(128 → N_aircraft)` + softmax over valid aircraft (mask from obs).

**Clearance head** — `Linear(128 + aircraft_embed → N_clearances)` conditioned on the sampled aircraft embedding; masked over valid clearances for that aircraft.

### Legacy path: `MaskablePPO` + `ATCFeatureExtractor`

```python
policy_kwargs = dict(
    features_extractor_class=ATCFeatureExtractor,
    features_extractor_kwargs=dict(features_dim=128),
    net_arch=dict(pi=[64, 64], vf=[64, 64]),
)
```

Same `ATCEncoder` backbone; the latent vector feeds separate policy (`pi`) and value (`vf`) heads with two 64-unit hidden layers each.

---

## Callbacks

| Callback | Class | Frequency | Purpose |
|---|---|---|---|
| `ATCEpisodeMetricsCallback` | `metrics_callback.py` | Every episode end | Training-env episode metrics → `custom_metrics/*` |
| `ATCInstrumentationCallback` | `instrumentation_callback.py` | Every rollout end | Obs / reward / action / grad diagnostics → `instr/*` |
| `CheckpointCallback` | SB3 built-in | Every 10 000 steps | Save model + VecNormalize to `experiments/<run>/checkpoints/` |
| `ATCEvalMetricsCallback` | `eval_metrics_callback.py` | Every 5 000 steps | Deterministic eval (10 episodes) → `eval_custom/*`, `eval_instr/*`, `eval_success/*` |

---

## Eval configuration

| Parameter | Value |
|---|---|
| `eval_freq` | 5 000 steps |
| `n_eval_episodes` | 10 |
| `deterministic` | `True` |
| `rolling_window` | 100 episodes |
| Eval seeds | `Config.SCENARIO_EVAL_SEEDS` — 5 built-in defaults, overridden by `config/eval_seeds.txt` if present |

!!! note "Larger eval-seed pools"
    Drop your seeds into **`config/eval_seeds.txt`** (one int per line; `#` comments, commas, and
    `[ ]` brackets tolerated — a pasted Python/JSON list works) to evaluate on a bigger set without
    touching `config.py`. A missing / seedless / malformed file falls back to the built-in defaults.

    `n_eval_episodes` governs **per-pass coverage**, and the eval seed index *persists across
    passes*. With **fewer episodes than seeds** (e.g. 10 episodes over ~100 seeds) each eval pass
    walks a **rolling window** of the pool, so the full set is covered across ~10 passes and the
    `*_rolling` metrics (`rolling_window = 100`) aggregate it. The trade-off: per-pass
    `eval/mean_reward` and **best-model selection** then see only that pass's subset — raise
    `n_eval_episodes` toward `len(seeds)` if you need every pass to score the whole pool.
