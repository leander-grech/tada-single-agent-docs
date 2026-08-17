# MDP & Environment


!!! abstract "TL;DR"
    One agent issues **one clearance per 45 s step** to up to 10 arrivals, chosen as a factored
    `MultiDiscrete([10, 15])` — aircraft, then clearance. Clearance sets are **versioned**:
    `v2` (15 actions) from run 1_27, `v1` (22) frozen so run 1_26 stays replayable.

    An episode ends when every aircraft lands, or **immediately** on a realised loss of
    separation — inside 3 NM *and* 500 ft on the live world. Predicted conflicts never
    terminate and never gate success; they are priced in the [reward](reward.md#conflict-penalty)
    instead. Success is the top of a 5-tier ladder: **all landed, every aircraft within ±60 s**.

    `timeout` has fired zero times in 800 scored episodes — the horizon does not bind.


Source: `atc_env/single_agent_env.py`, `config/config.py`

---

## Gym environment class

`ATCSingleAgentEnv(gym.Env)` — single-agent env. The **default** action space is a **factored,
autoregressive** `(aircraft, clearance)` pair; a legacy flat `Discrete(150)` is retained behind
`Config.USE_AUTOREGRESSIVE_ACTIONS = False`.

```python
from atc_env.single_agent_env import ATCSingleAgentEnv
env = ATCSingleAgentEnv(config={"evaluation_mode": False})
```

## Action space

Selected by `Config.USE_AUTOREGRESSIVE_ACTIONS` (default `True`):

```
# default — autoregressive: aircraft head -> clearance head conditioned on the chosen aircraft
action_space = MultiDiscrete([N_AIRCRAFT_MAX, N_CLEARANCES]) = MultiDiscrete([10, 15])

# legacy flat (USE_AUTOREGRESSIVE_ACTIONS = False)
action_space = Discrete(N_AIRCRAFT_MAX * N_CLEARANCES)        = Discrete(150)
```

| Constant | Value | Source |
|---|---|---|
| `N_AIRCRAFT_MAX` | 10 | `config.py` (= `MAX_AIRCRAFT_COUNT_EVAL`) |
| `N_CLEARANCES` | 15 | `config.py` (= `NUM_ACTIONS`, from `ACTION_SET`) |

### Clearance sets are versioned (run 1_27 onward) { #action-set-versions }

`Config.ACTION_SET` selects which clearance set the environment exposes, and `NUM_ACTIONS`
follows from it — which in turn sizes the action space, the clearance head, the mask and the
action-history one-hot.

| set | clearances | used by |
|---|---|---|
| `v1` | 22 | every run up to and including **1_26**. Frozen in `actions/actions_v1.py`; never edited again. |
| `v2` | 15 | **1_27** onward. The reduced set specified by the domain experts. |

A checkpoint can only be loaded into the action space it was trained on. To replay 1_26:

```bash
TADA_ACTION_SET=v1 python render_policy.py --model experiments/atc_run_1_26_sep3nm/best/best_model.zip
```

It is an environment variable rather than a CLI flag because it is consumed at *import* time.
`actions/action_set.py::check_checkpoint_compatible` reads the clearance count out of a
checkpoint and fails with that instruction rather than a raw tensor-shape error.

Only the ACTION side is versioned. Replaying runs ≤ 1_25 is *not* supported: their observation
encoding predates the log-deviation change and the severity/proximity split, so they would be
fed inputs they never trained on.

#### v2 clearances { #v2-clearances }

```
 0 DO_NOTHING          5 SPEED_UP_MEDIUM       10 SKIP_1_WAYPOINT
 1 SLOW_DOWN_SMALL     6 TURN_LEFT_…_ROUTE     11 SKIP_2_WAYPOINTS_NOT_NEXT
 2 SLOW_DOWN_MEDIUM    7 TURN_RIGHT_…_ROUTE    12 SKIP_3_WAYPOINTS_NOT_NEXT
 3 SLOW_DOWN_LARGE     8 LENGTHEN_TROMBONE     13 SKIP_4_WAYPOINTS_NOT_NEXT
 4 SPEED_UP_SMALL      9 SHORTEN_TROMBONE      14 VECTOR_TO_ILS
```

Speed steps are ±10/20/30 kt, and the set is deliberately **asymmetric** — three levels of
slowing, two of speeding, no `SPEED_UP_LARGE`. Arrivals sit near their speed ceiling: six
consecutive `SPEED_UP_LARGE` move landing time by only −18 s, against +339 s for six
`SLOW_DOWN_LARGE`.

`LENGTHEN_TROMBONE` and `SHORTEN_TROMBONE` are exact inverses of one level each and **stack**,
so three lengthens with no shorten between them give +3. Capacity is 4 levels. Shortening
cannot go below the baseline route: every aircraft starts with its trombone fully cut out, so
shorten only undoes the agent's own prior lengthening.

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

## Episode length { #episode-length }

The horizon is **sized per scenario** to the latest arrival ETA (see
[Training → per-scenario episode horizon](training.md#per-scenario-episode-horizon)); the fixed
values below are the fallback / cap reference.

| Parameter | Value | Meaning |
|---|---|---|
| `EPISODE_STEPS` | 64 | Fixed-horizon fallback / cap reference |
| `TIME_BETWEEN_ACTIONS` | **45 s** | Sim seconds advanced per env step |
| `MIN_EPISODE_STEPS` / `MAX_EPISODE_STEPS` | 48 / 130 | floor and cap on the per-scenario horizon |
| `HORIZON_STEP_MARGIN` | 6 | extra steps so the last aircraft can land and settle (~270 s) |
| Fallback wall-clock horizon | **2 880 s (48 min)** | 64 × 45 |

Truncation fires when `_steps >= max_steps_per_episode`.

!!! note
    `SECONDARY_TIME_BETWEEN_ACTIONS = 45 s` (same as primary; used when a repeat
    clearance is pending). `EPISODE_TIMEOUT = 30 s` is a wall-clock guard for
    env-runner processes only — it does not change the MDP horizon.

!!! warning "The 22 s interval was tested and lost"
    Runs 9 and 10 halved `TIME_BETWEEN_ACTIONS` to 22 s (doubling every step-count
    constant in tandem). It destabilised training and was reverted; every run from `1_18`
    onward is back on **45 s**. The experiment is written up in the
    [experiment log](experiments.md#run-9) — the constants above are the live ones.

## Action mask

`action_masks()` (`single_agent_env.py:601`) returns a flat
`bool[N_AIRCRAFT_MAX × N_CLEARANCES]` vector — **150** under the current v2 clearance set,
220 under v1.
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
| **Realised loss of separation** | `True` | `False` | `"separation"` |
| **Airspace exit** | `True` | `False` | `"airspace_exit"` |
| All aircraft landed + reaches **Tier 5** | `True` | `False` | `"success"` |
| All aircraft landed, below Tier 5 | `True` | `False` | `"delayed"` |
| Step limit (`_steps >= max_steps_per_episode`) | `False` | `True` | `"timeout"` |

Since run 1_26 a violation **ends the episode immediately** — the check runs first in
`_check_terminated`. A realised loss of separation means some pair was inside **3 NM and
500 ft** (severity 1.0) on the live world at the current simulation time. Purely predicted
conflicts never terminate and never gate success, however imminent.

!!! note
    `"timeout"` has been observed **zero** times in 800 scored episodes across eight
    checkpoints — every episode ends by landing or by a bust. The episode horizon does not
    bind in practice.

### Terminal reward adjustment

!!! info "Why the violation penalty is horizon-aware"
    Terminating early is an escape hatch whenever mean step reward is negative. On run 1_25 it
    was −0.23, so bailing out at step 20 of 66 would have saved ≈10.6 against a flat 15-point
    penalty. The forfeit term removes the incentive by construction.

A terminal bonus is added to `last_reward.bonus` **before** `r_parts.total()` is returned. The old
flat ±5.0 `REWARD_SUCCESS_BONUS` is **gone**, replaced by a graduated **5-tier success ladder**
(highest tier reached wins) plus a hard-violation penalty:

| End reason | Bonus |
|---|---|
| `"separation"` / `"airspace_exit"` | `−(REWARD_VIOLATION_PENALTY + REWARD_VIOLATION_PER_REMAINING_STEP × remaining_steps)` = `−(30 + 0.5·r)` (suppresses any tier) |
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

## Eval-time action shield (`render_policy.py`) { #eval-time-action-shield }

Source: `render_policy.py::apply_shield`, `single_agent_env.py::peek_action` / `peek_clearances`

An **action shield** is eval/render-time **postprocessing**: it can *refuse* the policy's chosen
clearance and substitute another, decided by a live one-step look-ahead. It is **not part of the
MDP and plays no role in training** — the environment dynamics, reward and the trained weights are
untouched; the shield only changes which action is actually issued at inference. It exists to probe
*how far the raw policy is from optimal* (and to clean up renders); the
[refusal-shield sweep](successful_results.md#run-8-atc_run_1_16) quantifies what it buys.

!!! warning "Postprocessing, not policy"
    Nothing here changes the agent. A shielded rollout answers "could a cheap, greedy override
    recover performance the policy left on the table?" — if shields help a lot, the policy's first
    choices are far from optimal and the lever is better *training*, not more postprocessing.

### Look-ahead primitive (`peek_action`)

The shield never mutates episode state — it evaluates candidates on the **current committed world**
via two read-only, pure helpers (`simulate_candidate` / `simulate_n_next_states` are pure;
`interpret_action` has no side effects on the trombone store):

| Method | Returns | Notes |
|---|---|---|
| `peek_action(a_air, a_clr)` | `reward_delta`, `creates_critical_conflict` (+ raw parts) | evaluates the candidate clearance **and** the `DO_NOTHING` baseline |
| `peek_clearances(a_air, clrs)` | `{clr: {reward_delta, creates_critical_conflict}}` | batch; computes the `DO_NOTHING` baseline **once** (the `next_best` hot path) |

- **`reward_delta`** `= R(action) − R(DO_NOTHING)` on the rolled-out predicted world. Negative ⇒
  issuing the clearance is **worse than doing nothing**.
- **`creates_critical_conflict`** `= conflict(action) AND NOT conflict(DO_NOTHING)` — a near-horizon
  conflict (`has_near_conflict` on the rollout) the action **introduces** that `DO_NOTHING` would
  have avoided. (A conflict already present under `DO_NOTHING` is *not* attributed to the action.)

### Refusal checks (independently toggleable)

| Check | CLI flag | Refuses the proposed clearance when |
|---|---|---|
| reward-drop | `--refuse-on-reward-drop` | `reward_delta < −refuse_reward_eps` (`--refuse-reward-eps`, default `0.0`) |
| critical-conflict | `--refuse-on-critical-conflict` | `creates_critical_conflict` is true |
| both | both flags | **either** check fires |

A `DO_NOTHING` proposal is **never** shielded (early return). A candidate the action mask marks
valid but that still fails to interpret/simulate (a latent mask/interpreter inconsistency the
trained policy avoids) is refused with reason `interpret_error` rather than crashing the rollout.

### Fallback on refusal (`--refuse-fallback`)

| Fallback | Behaviour |
|---|---|
| `do_nothing` (default) | issue `DO_NOTHING` for this step |
| `next_best` | among the aircraft's valid (masked) clearances, batch-peek and pick the **highest `reward_delta`** clearance that passes the enabled checks; `DO_NOTHING` is the floor (the substitute must beat `DO_NOTHING`, else `DO_NOTHING` is issued) |

`next_best` is what recovers tier/punctuality; `do_nothing` mostly only buys safety — see the
[sweep takeaways](successful_results.md#run-8-atc_run_1_16).

### Usage

```bash
# render with the critical-conflict shield, next-best fallback, stochastic sampling
python render_policy.py --model experiments/atc_run_1_16/best/best_model.zip --out shielded.mp4 \
    --refuse-on-critical-conflict --refuse-fallback next_best --stochastic

# both checks, next-best fallback, benchmark across all eval seeds (no video)
python render_policy.py --model experiments/atc_run_1_16/best/best_model.zip --all-eval-seeds --no-video \
    --refuse-on-reward-drop --refuse-on-critical-conflict --refuse-fallback next_best
```

`--stochastic` (sample vs. greedy) is orthogonal to shielding; `--legacy-interval` restores the 45 s
interval + un-doubled horizon caps so a pre-22 s checkpoint is rendered under its training-time timing.
The shield's effectiveness across the full eval set is reported in
[Successful results → refusal-shield sweep](successful_results.md#run-8-atc_run_1_16).

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
