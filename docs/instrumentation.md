# Instrumentation & TensorBoard Metrics

Source: `callbacks/instrumentation_callback.py`, `callbacks/eval_metrics_callback.py`,
`callbacks/metrics_callback.py`, `utils/instrumentation.py`

---

## Overview

Three callbacks populate TensorBoard:

| Callback | Namespace(s) | Frequency |
|---|---|---|
| `ATCInstrumentationCallback` | `instr/*` | Per rollout |
| `ATCEpisodeMetricsCallback` | `custom_metrics/*`, `debug_metrics/*` | Per training episode |
| `ATCEvalMetricsCallback` | `eval_custom/*`, `eval_instr/*`, `eval_success/*` | Per eval run (every 5 000 steps) |

---

## `instr/obs/*` — observation distribution (per rollout)

Logged for each continuous obs key: `global`, `aircraft`, `flight_plans_rel`,
`action_histories` (`utils/instrumentation.py:22`).

| Metric | Meaning |
|---|---|
| `instr/obs/<key>_mean` | Mean of all values in this obs component |
| `instr/obs/<key>_std` | Standard deviation |
| `instr/obs/<key>_min` | Minimum |
| `instr/obs/<key>_max` | Maximum |
| `instr/obs/<key>_saturation_frac` | Fraction of values with `|v| >= 0.99` (pinned at bound) |
| `instr/obs/<key>_nonfinite` | Count of NaN / Inf values |
| `instr/obs/valid_action_frac` | Fraction of action slots enabled by the mask |

Saturation threshold is `0.99` (`instrumentation.py:17`). High saturation_frac
means many inputs are clipped — a sign of poor normalization range.

---

## `instr/reward/*` — reward distribution & part breakdown (per rollout)

| Metric | Meaning |
|---|---|
| `instr/reward/step_mean` | Mean per-step reward (VecNormalize-scaled) |
| `instr/reward/step_std` | Std dev of per-step reward |
| `instr/reward/step_min` | Min per-step reward |
| `instr/reward/step_max` | Max per-step reward |
| `instr/reward/nonfinite` | Count of non-finite reward values |
| `instr/reward/deviation_mean` | Mean `RewardParts.deviation` per step |
| `instr/reward/conflict_mean` | Mean `RewardParts.conflict` per step |
| `instr/reward/action_mean` | Mean `RewardParts.action` per step |
| `instr/reward/bonus_mean` | Mean `RewardParts.bonus` per step |

---

## `instr/action/*` — action distribution (per rollout)

| Metric | Meaning |
|---|---|
| `instr/action/entropy` | Shannon entropy of the action distribution |
| `instr/action/entropy_norm` | Entropy / log(220) — 1.0 = perfectly uniform |
| `instr/action/n_unique` | Number of distinct actions taken |
| `instr/action/do_nothing_frac` | Fraction of steps using clearance index 0 |
| `instr/action/top1_frac` | Fraction of steps using the single most-common action |
| `instr/action/clearance_NN_frac` | Per-clearance marginal (00..21) |
| `instr/action/aircraft_NN_frac` | Per-aircraft marginal (00..09) |

---

## `instr/buffer/*` — rollout buffer magnitude (per rollout)

For each of `values`, `advantages`, `returns`:

| Metric | Meaning |
|---|---|
| `instr/buffer/<name>_mean` | Mean |
| `instr/buffer/<name>_std` | Std dev |
| `instr/buffer/<name>_absmax` | Max absolute value (exploding-signal check) |
| `instr/buffer/<name>_nonfinite` | Count of NaN / Inf |

---

## `instr/grad/*` — gradient norms (per rollout, captured pre-clip)

`ATCInstrumentationCallback` monkey-patches `torch.nn.utils.clip_grad_norm_` at
training start to record the total gradient norm **before** SB3 applies clipping.
This lets you detect gradient explosion and saturation of the clip.

| Metric | Meaning |
|---|---|
| `instr/grad/norm_mean` | Mean pre-clip gradient norm across all optimizer steps |
| `instr/grad/norm_max` | Max pre-clip gradient norm |
| `instr/grad/nonfinite` | Count of non-finite gradient norms |
| `instr/grad/clip_frac` | Fraction of updates where norm > `max_grad_norm` (= 1.5) |

!!! note
    `clip_frac` near 1.0 means nearly every update was being clipped. This is why
    `max_grad_norm` was raised from 0.5 → 1.5 (`main.py:88`).

---

## `eval_custom/*` — evaluation terminal metrics

Logged once per eval run (20 deterministic episodes).

| Metric | Meaning |
|---|---|
| `eval_custom/n_completed_episodes` | Episodes with terminal metrics |
| `eval_custom/has_terminal_episode_metrics` | Fraction with valid metrics dict |
| `eval_custom/success_rate` | Success fraction this eval run |
| `eval_custom/success_rolling` | Rolling mean success (window=100) |
| `eval_custom/deviation_final_mean` | Mean signed final deviation (s) |
| `eval_custom/deviation_final_min` / `_max` | Min/max across episodes |
| `eval_custom/deviation_abs_final_mean` | Mean absolute final deviation |
| `eval_custom/deviation_abs_rolling` | Rolling mean |dev| |
| `eval_custom/infringement_severity_total_mean` | Mean total infringement severity at episode end |
| `eval_custom/infringement_severity_total_rolling` | Rolling mean |
| `eval_custom/infringement_event_count_mean` | Mean count of infringement events at episode end |
| `eval_custom/infringement_event_count_rolling` | Rolling mean |
| `eval_custom/infringement_severity_avg` | Total severity / total count (per-event avg) |
| `eval_custom/episode_steps_mean` | Mean number of steps to episode end |
| `eval_custom/infringement_reason_count/<reason>` | Total count per infringement reason |
| `eval_custom/infringement_reason_per_episode/<reason>` | Per-episode rate |
| `eval_custom/end_reason_fraction/<reason>` | Fraction of episodes ending with each reason |

---

## `eval_instr/*` — instrumentation during evaluation episodes

| Metric | Meaning |
|---|---|
| `eval_instr/reward_step_mean` | Mean per-step reward during eval (raw scale) |
| `eval_instr/reward_step_std` / `_min` / `_max` | Distribution |
| `eval_instr/reward_nonfinite` | Count of non-finite rewards |
| `eval_instr/reward_deviation_mean` | Mean deviation component |
| `eval_instr/reward_conflict_mean` | Mean conflict component |
| `eval_instr/reward_action_mean` | Mean action component |
| `eval_instr/reward_bonus_mean` | Mean bonus component |
| `eval_instr/action_clearance_entropy` | Shannon entropy of clearance marginal |
| `eval_instr/action_do_nothing_frac` | Fraction of clearance-0 selections |
| `eval_instr/action_n_unique_clearances` | Distinct clearances used |
| `eval_instr/clearance_NN_frac` | Per-clearance marginal (00..21) |
| `eval_instr/aircraft_NN_frac` | Per-aircraft marginal (00..09) |

---

## `eval_success/*` — success sub-criteria (averaged over eval episodes)

These let you see **which criterion is blocking success**.

| Metric | Source field in `_evaluate_success` |
|---|---|
| `eval_success/all_landed_mean` | All aircraft completed |
| `eval_success/all_under_threshold_mean` | All `|dev| <= 30 s` |
| `eval_success/total_dev_ok_mean` | Sum `|dev| <= n*30 s` |
| `eval_success/no_near_conflicts_mean` | `steps_since_near_conflict >= 3` |
| `eval_success/ever_near_conflict_mean` | Near-conflict appeared at any step |
| `eval_success/steps_since_near_conflict_mean` | Steps elapsed since last near-conflict |
| `eval_success/frac_under_threshold_mean` | Fraction of aircraft under threshold |
| `eval_success/total_abs_dev_mean` | Mean total absolute deviation (s) |
| `eval_success/max_aircraft_dev_mean` | Worst per-aircraft deviation (s) |
| `eval_success/n_under_threshold_mean` | Mean aircraft count under threshold |

---

## `custom_metrics/*` — training episode metrics

Logged per training episode by `ATCEpisodeMetricsCallback`.

| Metric | Meaning |
|---|---|
| `custom_metrics/deviation_initial` | Deviation at episode start (from rollout) |
| `custom_metrics/infringement_total_initial` | Weighted infringement at episode start |
| `custom_metrics/deviation_final` | Signed final deviation (s) |
| `custom_metrics/deviation_abs_final` | Absolute final deviation (s) |
| `custom_metrics/deviation_rolling` | Rolling mean signed deviation (window=100) |
| `custom_metrics/deviation_abs_rolling` | Rolling mean absolute deviation |
| `custom_metrics/infringement_total_final` | Final infringement severity total |
| `custom_metrics/infringement_total_rolling` | Rolling mean |
| `custom_metrics/infringement_count_final` | Final infringement event count |
| `custom_metrics/infringement_reason/<reason>` | Per-reason count per episode |
| `custom_metrics/success` | 1.0 if episode succeeded |
| `custom_metrics/success_rolling` | Rolling mean success rate |
| `custom_metrics/end_reason/<reason>` | 1.0 for the episode's end reason |
| `custom_metrics/nonzero_action` | Number of non-DO_NOTHING actions taken |
| `custom_metrics/action_<i>_count` | Count per clearance index |
| `custom_metrics/action_<i>_reward` | Mean reward when clearance i was taken |
| `custom_metrics/bonus_reward` | Mean bonus component per step |
| `custom_metrics/infringement_reward` | Mean conflict component per step |
| `custom_metrics/time_deviation_reward` | Mean deviation component per step |

---

## What to watch

### Plateau detection

| Symptom | Metrics to check |
|---|---|
| Agent stops improving | `eval_custom/success_rolling`, `custom_metrics/deviation_abs_rolling` |
| Agent always picks DO_NOTHING | `instr/action/do_nothing_frac` > 0.8, `instr/action/entropy_norm` near 0 |
| Policy collapsed to one action | `instr/action/n_unique` < 5, `instr/action/top1_frac` > 0.9 |

### Entropy collapse

Watch `instr/action/entropy_norm` — if it falls below ~0.3 early in training, the
policy has over-committed. `ent_coef=0.01` is meant to prevent this.

### Exploding or capped gradients

| Symptom | Metric |
|---|---|
| Gradients always clipped | `instr/grad/clip_frac` near 1.0 |
| Gradient explosion | `instr/grad/norm_max` very large |
| Value function diverging | `instr/buffer/values_absmax` growing unboundedly |

If `instr/grad/clip_frac` is consistently near 1.0, consider raising `max_grad_norm`
or lowering `learning_rate`. If `instr/buffer/returns_absmax` explodes, check that
`VecNormalize` is active on the training env.

### Observation saturation

`instr/obs/<key>_saturation_frac` above ~0.1 for any key means many inputs are
hitting the `[-1, 1]` clip boundary. For the `aircraft` key this typically means
the normalization range in `Config` is too narrow for the current scenario difficulty.

### Success gate diagnosis

When `eval_custom/success_rate` is low, use `eval_success/*` to see which AND-clause
is blocking:
- If `ever_near_conflict_mean` is high → conflict avoidance is the bottleneck.
- If `all_under_threshold_mean` is low but `no_near_conflicts_mean` is high →
  deviation is the bottleneck.
- If `all_landed_mean` is low → aircraft are not completing in time.
