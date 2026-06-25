# MDP & Environment

Source: `atc_env/single_agent_env.py`, `config/config.py`

---

## Gym environment class

`ATCSingleAgentEnv(gym.Env)` — single-agent env. The **default** action space is a **factored,
autoregressive** `(aircraft, clearance)` pair; a legacy flat `Discrete(220)` is retained behind
`Config.USE_AUTOREGRESSIVE_ACTIONS = False`.

```python
from atc_env.single_agent_env import ATCSingleAgentEnv
env = ATCSingleAgentEnv(config={"evaluation_mode": False})
```

## Action space

Selected by `Config.USE_AUTOREGRESSIVE_ACTIONS` (default `True`):

```
# default — autoregressive: aircraft head -> clearance head conditioned on the chosen aircraft
action_space = MultiDiscrete([N_AIRCRAFT_MAX, N_CLEARANCES]) = MultiDiscrete([10, 22])

# legacy flat (USE_AUTOREGRESSIVE_ACTIONS = False)
action_space = Discrete(N_AIRCRAFT_MAX * N_CLEARANCES)        = Discrete(220)
```

| Constant | Value | Source |
|---|---|---|
| `N_AIRCRAFT_MAX` | 10 | `config.py` (= `MAX_AIRCRAFT_COUNT_EVAL`) |
| `N_CLEARANCES` | 22 | `config.py` (= `NUM_ACTIONS`) |

### Decoding an action (`single_agent_env.py::step`)

```python
# autoregressive: action already is the pair
a_air, a_clr = action            # aircraft slot [0, 9], clearance [0, 21]
# legacy flat:
a_air = flat // n_clearances
a_clr = flat  % n_clearances
```

The callsign for slot `a_air` is looked up from `_prev_aircraft_order` (the permuted,
stable slot-to-callsign mapping built each step by `build_global_observation`).

## Episode length

The horizon is **sized per scenario** to the latest arrival ETA (see
[Training → per-scenario episode horizon](training.md#per-scenario-episode-horizon)); the fixed
values below are the fallback / cap reference.

| Parameter | Value | Meaning |
|---|---|---|
| `EPISODE_STEPS` | 128 | Fixed-horizon fallback / cap reference |
| `TIME_BETWEEN_ACTIONS` | 22 s | Sim seconds advanced per env step (**was 45**; halved for finer temporal control) |
| Fallback wall-clock horizon | **≈ 2 816 s (47 min)** | 128 × 22 |

Truncation fires when `_steps >= max_steps_per_episode`.

!!! note
    `SECONDARY_TIME_BETWEEN_ACTIONS = 22 s` (same as primary; used when a repeat
    clearance is pending). `EPISODE_TIMEOUT = 30 s` is a wall-clock guard for
    env-runner processes only — it does not change the MDP horizon.

## Action mask

`action_masks()` (`single_agent_env.py:601`) returns a flat `bool[220]` vector.
The mask is built from two observation sub-keys written every step:

- `mask_aircraft[ac]` — 1 if aircraft slot `ac` holds a live, active aircraft.
- `mask_action_per_ac[ac, clr]` — 1 if clearance `clr` is currently valid for
  aircraft `ac` (geometry, route constraints, design limits).

```python
flat_action = ac * n_clearances + clr
mask[flat_action] = True   # iff both masks are 1
```

In the **legacy** flat path, `MaskablePPO` reads this flat mask and zeros invalid logits before
sampling or computing the policy gradient. In the **default autoregressive** path the same
`mask_aircraft` / `mask_action_per_ac` sub-keys are read directly by the policy's aircraft and
clearance heads (see [Training → policy network](training.md#policy-network)).

## Termination vs truncation

| Condition | `terminated` | `truncated` | `last_end_reason` |
|---|---|---|---|
| All aircraft landed + reaches **Tier 5** | `True` | `False` | `"success"` |
| All aircraft landed, below Tier 5 | `True` | `False` | `"delayed"` |
| Step limit (`_steps >= max_steps_per_episode`) | `False` | `True` | `"timeout"` |

A realized hard violation **overrides** the reason above (`_refine_end_reason`): a loss of
separation → `"separation"`, an airspace exit → `"airspace_exit"`.

!!! warning
    Infringement-*truncation* is present in the code but **commented out** — episodes are never
    cut short on a violation. Instead, a violation is recorded as the terminal `last_end_reason`,
    which suppresses any tier bonus and applies the violation penalty (below).

### Terminal reward adjustment

A terminal bonus is added to `last_reward.bonus` **before** `r_parts.total()` is returned. The old
flat ±5.0 `REWARD_SUCCESS_BONUS` is **gone**, replaced by a graduated **5-tier success ladder**
(highest tier reached wins) plus a hard-violation penalty:

| End reason | Bonus |
|---|---|
| `"separation"` / `"airspace_exit"` | `−REWARD_VIOLATION_PENALTY` = −15.0 (suppresses any tier) |
| `"success"` / `"delayed"` / `"timeout"` | graduated tier bonus `+1.5 … +13.0` by highest tier reached (0.0 if none) |

See the [reward tier ladder](reward.md) for the full T1–T5 criteria and rationale.

## Success criterion (`_evaluate_success`)

"Success" (`is_success`) is now exactly **Tier 5 of the graduated ladder** — *all* aircraft landed
and every `|deviation| ≤ SUCCESS_TIER5_DEV_S = 60 s`, with the near-conflict gate satisfied. Lower
tiers (T1–T4) award partial terminal bonus but are **not** counted as success.

| Tier | Fraction within | Extra gate | `is_success`? |
|---|---|---|---|
| 1 | ≥ 50% within ±120 s | — | no |
| 2 | ≥ 80% within ±100 s | — | no |
| 3 | ≥ 80% within ±70 s | `max_dev` < 200 s | no |
| 4 | ≥ 80% within ±60 s | `max_dev` < 120 s | no |
| 5 | **all** within ±60 s | all landed | **yes** |

All tiers require the **relaxed near-conflict gate**: `_steps_since_near_conflict >=
SUCCESS_NEAR_CONFLICT_CLEAR_STEPS (6)` rather than "no near-conflict ever". Near-conflict status is
evaluated on the **rollout world** (`current_predicted_world`) after each step.

### `_evaluate_success` sub-metrics (logged in episode_metrics)

| Key | Meaning |
|---|---|
| `success_all_landed` | All aircraft completed |
| `success_tier` | Highest success tier reached (0–5) |
| `success_frac_under_tier{1..4}` | Fraction of aircraft within each tier's deviation |
| `success_n_under_tier{1..4}` | Count of aircraft within each tier's deviation |
| `success_all_under_tier5` | Every \|dev\| ≤ 60 s |
| `success_total_abs_dev` | Raw total absolute deviation (s) |
| `success_max_aircraft_dev` | Worst single-aircraft deviation (s) |
| `success_no_near_conflicts` | `steps_since_near_conflict >= 6` |
| `success_ever_near_conflict` | A near-conflict was present at some step |
| `success_steps_since_near_conflict` | Steps elapsed since last near-conflict |

## Observation space (summary)

See [observations.md](observations.md) for full spec.

```
Dict(
  global:             Box(-1, 1, shape=(4,)),
  aircraft:           Box(-1, 1, shape=(10, 12)),
  mask_aircraft:      MultiBinary(10),
  mask_action_per_ac: MultiBinary((10, 22)),
  flight_plans_rel:   Box(-1, 1, shape=(10, 20, 11)),
  flight_plan_mask:   MultiBinary((10, 20)),
  action_histories:   Box( 0, 1, shape=(10,  8, 23)),
)
```
