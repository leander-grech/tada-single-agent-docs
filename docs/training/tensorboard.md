# TensorBoard metrics

!!! abstract "Summary"
    TensorBoard is for watching a run's health (entropy, KL, gradients, reward parts, action mix),
    not for judging it. Performance comes from `track.csv` and the evaluation battery. Two series in
    particular must not be quoted: `rollout/success_rate` and `eval_custom/success_rate` are
    5-episode rolling windows, and `custom_metrics/end_reason/*` was presence-only before commit
    `c030072` (every series averaged to 1.0).

Point TensorBoard at `experiments/`; each run logs under its own `tb/`.

## Namespaces

| namespace | from | when | what |
|---|---|---|---|
| `instr/obs/*` | `ATCInstrumentationCallback` | per rollout | mean/std/min/max per observation key, `saturation_frac` (share of \|v\| ≥ 0.99), non-finite counts, share of valid actions |
| `instr/reward/*` | same | per rollout | step reward distribution and the mean of each reward part |
| `instr/action/*` | same | per rollout | entropy (and normalised), distinct actions, `do_nothing_frac`, top-1 share, per-clearance and per-slot marginals |
| `instr/buffer/*` | same | per rollout | values, advantages, returns: mean, std, abs-max |
| `instr/grad/*` | same | per rollout | **pre-clip** gradient norm (mean, max) and `clip_frac`, the share of updates above `max_grad_norm` |
| `custom_metrics/*` | `ATCEpisodeMetricsCallback` | per training episode | deviation, infringement, end reason, per-clearance counts and rewards |
| `eval_custom/*`, `eval_instr/*`, `eval_success/*` | `ATCEvalMetricsCallback` | per in-training eval | the same on deterministic eval episodes, plus which success criterion is blocking |
| `window_metrics/*`, `eval_window/*` | windowed env | per episode | `on_time_rate`, `n_landed`, mean/max landing deviation, window occupancy and overflow, landing bonus, clearances, second picks |

## What to watch

| symptom | series |
|---|---|
| policy collapsed onto one action | `instr/action/n_unique` < 5, `top1_frac` > 0.9 |
| entropy collapse | `instr/action/entropy_norm` falling below ~0.3 early; the reason `ent_coef` is non-zero |
| policy drifting too far per update | `train/approx_kl` at the target, clip fraction high (`1_31`: KL at the cap, a quarter clipped) |
| gradients always clipped | `instr/grad/clip_frac` near 1.0 (why `max_grad_norm` went 0.5 → 1.5) |
| value function diverging | `instr/buffer/values_absmax` growing; check VecNormalize is on the training env |
| an observation feature pinned | `instr/obs/<key>_saturation_frac` above ~0.1 |
| a warm start going wrong | explained variance low at the start and entropy **rising**: the critic is not ready ([Fine-tuning](reference.md#fine-tuning)) |

For reselection runs, `window_metrics/again_picks` and `window_metrics/multi_pick_steps` show whether
the policy is learning to use the second pick. In `1_36` the share of decisions asking for one grew
from 3.5% to ~35%.
