# Reward Function

Source: `actions/rewards.py`, `utils/reward_utils.py`, `config/config.py`

---

## `RewardParts` dataclass (`utils/reward_utils.py:8`)

```python
@dataclass
class RewardParts:
    deviation: float   # deviation improvement (negative = worse)
    conflict:  float   # conflict penalty (non-positive)
    action:    float   # per-command cost (non-positive)
    bonus:     float = 0.0  # terminal bonus (set in step(), not calculate_reward)

    def total(self) -> float:
        return deviation + conflict + action + bonus
```

`total()` is what SB3 receives as the scalar step reward.

---

## Component 1 — Deviation reward (`rewards.py:163`)

Uses **`MISS_TIMED_LANDING` events from a deterministic NOOP rollout**
(`current_predicted_world`). `compute_dynamic_deviation` was removed;
deviation is always sourced from the simulator rollout.

```
deviation_reward = -sum_aircraft( weight(ttl) * |dev| ) / REWARD_SCALE_DEVIATION
```

Where:

```
prox    = 1 - min(1, ttl / horizon)     # 0 = far from landing, 1 = imminent
weight  = REWARD_DEVIATION_LANDING_BASELINE + (1 - REWARD_DEVIATION_LANDING_BASELINE) * prox
horizon = EPISODE_STEPS * TIME_BETWEEN_ACTIONS = 64 * 45 = 2880 s
```

Each aircraft's absolute deviation is weighted **linearly by landing proximity**:
from `REWARD_DEVIATION_LANDING_BASELINE = 0.2` (far) up to `1.0` (landing imminent).

---

## Component 2 — Conflict penalty (`rewards.py:28`)

**Imminence-dominant ramp** over unique predicted aircraft pairs.
For each unique pair, only the **earliest** predicted loss-of-separation is used.

```
w(ttc) = max(floor, ((T_near - ttc) / T_near) ^ p)   for ttc < T_near
w(ttc) = floor                                        for ttc >= T_near

conflict_penalty = -REWARD_INFRINGEMENT_WEIGHT * sum_pairs( severity * w(ttc) )
```

- `severity` = normalized spatial severity `[0, 1]` (from `normalize_separation`).
- `ttc` = predicted time to conflict (s), relative to current world time.
- Conflicts beyond `T_near` pay only the small `floor` cost; within `T_near` the
  penalty ramps steeply as ttc → 0, so imminent conflicts dominate.

This term reads the **predicted** world (a NOOP rollout to the end of the episode), which is
deliberate: it is the only signal that gives the agent a reason to resolve a conflict *before*
it happens. See [Loss of separation](separation.md#where-prediction-genuinely-drives-behaviour).

### What `severity` actually means

`severity` is **not** produced by the simulator — it is `min` over two normalised axes computed
in `normalize_separation()`. With the current constants it maps to distance as:

| Horizontal separation | 0 NM | 1 NM | 2 NM | **3 NM** | 5 NM | ≥ 10 NM |
|---|---|---|---|---|---|---|
| `severity` (co-altitude) | 1.00 | 0.90 | 0.80 | **0.70** | 0.50 | 0.00 |

!!! danger "`severity == 1.0` means zero separation, not 3 NM"
    `HORIZONTAL_CONFLICT_RADIUS_NM` is currently `0.0`, so severity 1.0 requires literally
    zero horizontal separation and is unreachable in practice. **"Within 3 NM" is
    `severity >= 0.7`** (`NEAR_CONFLICT_THRESHOLD`). This trips people up constantly — the
    full explanation, including a live piece of dead code it has already caused, is on the
    [Loss of separation](separation.md) page.

### Near-conflict severity threshold

`has_near_conflict()` (`rewards.py:80`) uses `NEAR_CONFLICT_SEVERITY_THRESHOLD = 0.7`:
a conflict counts only if severity ≥ 0.7 **and** ttc < `T_near`. This threshold does **not**
affect the per-step conflict penalty magnitude.

Since run `1_25` this function no longer gates success (see the ladder below) — it is used by
the eval-time shield in `render_policy.py` and for the `no_near_conflicts_predicted` diagnostic.

---

## Component 3 — Action penalty (`rewards.py`)

```python
action_reward = -(num_commands ** 1.25) * REWARD_ACTION_PENALTY_WEIGHT * dof_factor
```

`num_commands = len(interpreted_actions.commands)`. The 1.25 exponent applies a
slightly super-linear cost to issuing many commands in one step.

### Degrees-of-freedom (DOF) scaling

Acting late — when the commanded aircraft has few remaining waypoints — is penalised more
than acting early. The factor scales the base action cost:

```
factor = max(1.0,  1 + K × (W − r) / W)
```

where `r` = remaining waypoints at decision time, `W = MAX_WAYPOINTS`, `K = REWARD_ACTION_DOF_K`.

| `K` | `W` | `r = W` (act early) | `r = W/2` | `r = 1` (act very late) |
|---|---|---|---|---|
| 3.0 | 20 | 1.0× | 2.5× | 3.85× |

`K = 0` disables DOF scaling (flat cost, back-compat). `remaining_wps = None` also returns factor 1.0.

---

## 🎯 Terminal success-tier ladder (set in `step()`)

The terminal bonus is the policy's **primary north star**, and it is **graduated across five
escalating tiers** rather than an all-or-nothing "solved" flag. The highest tier reached wins —
**tiers do not stack** — and each higher tier strictly implies all lower ones, so the agent
always sees a gradient toward the next rung:

```
            tighter schedule  +  worst aircraft pulled in  ───────────────►

   T1   ──►   T2   ──►   T3   ──►   T4   ──►   T5
  +1.5      +3.0      +6.0      +9.0     +13.0     bonus
  ≥50%      ≥80%      ≥80%      ≥80%      ALL      fraction of aircraft
 ±120 s    ±100 s     ±70 s     ±60 s    ±60 s     within deviation
   —         —      max<200 s max<120 s  all       extra worst-aircraft /
                                        landed      completion gate
```

Every tier *additionally* requires the **conflict gate**. Which gate depends on
`Config.SUCCESS_CONFLICT_REALISED_ONLY`:

| | Gate | Reads | Semantics |
|---|---|---|---|
| **Current** (`True`, run `1_25`+) | `not _episode_violations()[0]` | the **live** world | no aircraft pair ever got inside 3 NM (severity ≥ 0.7) during the episode |
| Legacy (`False`, runs ≤ `1_24`) | `_steps_since_near_conflict >= 3` | the **NOOP forecast** | no *predicted* conflict within `NEAR_CONFLICT_TIME_S` for the final 3 steps (≈ 135 s) |

The original gate before Run 3 was "no near-conflict **ever**, predicted or not", which was
unsatisfiable and kept `success_rate` pinned at 0.

!!! note "The gate has never been the binding constraint — but that is not the same as 'conflicts are solved'"
    Replaying `1_22`'s checkpoints with both gates instrumented found the predicted gate open in
    **every episode at every checkpoint** (0 relaxations in 95 episode-evaluations), so removing
    it changed nothing. What suppresses separation busts is the **violation penalty**, which has
    always been realised-only.

    Under the realised gate, `no_near_conflicts_mean` reads **0.774** — ~23 % of episodes contain
    a real loss of separation, where the legacy predicted metric reported 0.99–1.00. Deviation is
    still the harder problem, but do not repeat the claim that conflicts are solved. Measurement:
    [Loss of separation](separation.md#but-the-metric-that-said-so-was-measuring-the-wrong-thing).

| Tier | Criterion | `bonus` | What it targets |
|---|---|---|---|
| **Hard violation** | loss of separation or airspace exit | **−15.0** (`REWARD_VIOLATION_PENALTY`); **suppresses any tier bonus** | safety floor |
| **Tier 1** | ≥ 50% of aircraft within ±120 s | **+1.5** | low bar; gradient from the first steps |
| **Tier 2** | ≥ 80% within ±100 s | **+3.0** | majority on schedule |
| **Tier 3** | ≥ 80% within ±70 s **and** `max_dev` < 200 s | **+6.0** | tail aircraft starts closing |
| **Tier 4** | ≥ 80% within ±60 s **and** `max_dev` < 120 s | **+9.0** | near-solved |
| **Tier 5** | all landed **and** all within ±60 s | **+13.0** | **solved** |
| No tier reached | — | 0.0 | — |

**Why a ladder?** Runs 1–7 used a single all-or-nothing ±30 s gate that *never* fired
(`success_rate = 0`), so the terminal signal was flat and uninformative. The tiers supply dense
terminal gradient, and the explicit `max_aircraft_dev` caps at **Tiers 3–4** specifically pull in
the **worst-case aircraft** — the binding constraint that floored the deviation ceiling at
~360–390 s across those runs. Introducing the ladder (Run 8) lifted success from **0% → ~30%**.

The violation penalty (15.0) is set **above** the maximum tier bonus (13.0) so a hard violation
always produces a worse outcome than any tier, even T5.

The bonus is applied to `last_reward.bonus` **after** `calculate_reward` returns,
so `r_parts.total()` is recomputed with it before being passed to SB3.

!!! note "Replaces `REWARD_SUCCESS_BONUS`"
    The old flat ±5.0 `REWARD_SUCCESS_BONUS` is deprecated and unused. `REWARD_VIOLATION_PENALTY`
    is now independently tunable from the tier bonuses.

### The 6-tier variant (runs `1_23`, `1_24`, `1_24_pms`)

Once Run 13 showed that ±30 s is physically reachable, a **Tier 6** was added — *all landed and
every aircraft within ±30 s* — and it became the binary `success` flag. The ladder shifted up
one slot so the top payout still lands on true success:

| | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|
| 5-tier (≤ `1_22`, and `1_25`) | +1.5 | +3.0 | +6.0 | +9.0 | **+13.0** *(success)* | — |
| 6-tier (`1_23`–`1_24_pms`) | +0.75 | +1.5 | +3.0 | +6.0 | +9.0 | **+13.0** *(success)* |

`SUCCESS_TIER6_DEV_S = 30.0`, and `REWARD_SUCCESS_BONUS_TIER5_CONFIRM` becomes
`REWARD_SUCCESS_BONUS_TIER6_CONFIRM`.

!!! warning "`tier_mean` is not comparable across the two ladders"
    The rungs were re-valued, so a `tier_mean` of 2.2 under the 6-tier ladder measures
    something different from 2.6 under the 5-tier one. Always check which ladder a run used
    before comparing. Run `1_25` is back on the **5-tier** ladder to stay comparable with
    Run 13 (`atc_run_1_22`).

---

## Reward config reference

| Constant | Value | Role |
|---|---|---|
| `REWARD_SCALE_DEVIATION` | 2000 | Divides raw weighted deviation sum |
| `REWARD_DEVIATION_LANDING_BASELINE` | 0.2 | Weight at far-from-landing end |
| `REWARD_INFRINGEMENT_WEIGHT` | 10.0 | Conflict penalty scale |
| `NEAR_CONFLICT_TIME_S` | 1200.0 s | Ramp gate (20 min) |
| `CONFLICT_TIME_EXPONENT` | 3.0 | Ramp steepness (p in formula) |
| `CONFLICT_FAR_FLOOR` | 0.005 | Residual cost beyond T_near |
| `NEAR_CONFLICT_SEVERITY_THRESHOLD` | 0.7 | Severity gate for success check |
| `REWARD_ACTION_PENALTY_WEIGHT` | 0.02 | Per-command cost weight |
| `REWARD_ACTION_DOF_K` | 3.0 | DOF scaling factor K; 0 = flat cost |
| `REWARD_VIOLATION_PENALTY` | 15.0 | Terminal penalty for hard violations (> T5 bonus) |
| `REWARD_SUCCESS_BONUS_TIER1` | 1.5 | Terminal bonus — tier 1 |
| `REWARD_SUCCESS_BONUS_TIER2` | 3.0 | Terminal bonus — tier 2 |
| `REWARD_SUCCESS_BONUS_TIER3` | 6.0 | Terminal bonus — tier 3 |
| `REWARD_SUCCESS_BONUS_TIER4` | 9.0 | Terminal bonus — tier 4 |
| `REWARD_SUCCESS_BONUS_TIER5` | 13.0 | Terminal bonus — tier 5 ("solved") |
| `SUCCESS_TIER1_DEV_S` | 120.0 s | Deviation threshold for tier 1 |
| `SUCCESS_TIER1_FRAC` | 0.5 | Fraction of aircraft required for tier 1 |
| `SUCCESS_TIER2_DEV_S` | 100.0 s | Deviation threshold for tier 2 |
| `SUCCESS_TIER2_FRAC` | 0.8 | Fraction required for tiers 2–4 |
| `SUCCESS_TIER3_DEV_S` | 70.0 s | Deviation threshold for tier 3 |
| `SUCCESS_TIER3_MAX_DEV_S` | 200.0 s | `max_aircraft_dev` cap for tier 3 |
| `SUCCESS_TIER4_DEV_S` | 60.0 s | Deviation threshold for tier 4 |
| `SUCCESS_TIER4_MAX_DEV_S` | 120.0 s | `max_aircraft_dev` cap for tier 4 |
| `SUCCESS_TIER5_DEV_S` | 60.0 s | Deviation threshold for tier 5 (all aircraft) |
| `SUCCESS_NEAR_CONFLICT_CLEAR_STEPS` | 6 | Conflicts must be clear for this many final steps (≈ 132 s) |
| `REWARD_GOAL_BONUS_SCALE_MAX` | 200.0 s | `max_aircraft_dev` sensitivity in goal bonus |
| `REWARD_INFRINGEMENT_DECAY_TAU` | 2000.0 | **Legacy; unused** by the current ramp |
| `USE_ROLLOUT_DEVIATION` | `True` | Always use NOOP rollout deviation |
| `REWARD_SUCCESS_BONUS` | 5.0 | **Deprecated / unused** — replaced by graduated tiers |

!!! note
    `REWARD_INFRINGEMENT_DECAY_TAU` appears in config but is not used by the
    current `infringement_reward_from_world` implementation. The `time_decay_tau`
    parameter is accepted for signature compatibility but ignored.

---

## Full reward flow

```
step(action)
  -> apply_action_and_advance()                    # advance 22 s (TIME_BETWEEN_ACTIONS)
  -> advance_multiple_steps(max_steps_per_episode) # NOOP rollout -> current_predicted_world
  -> calculate_reward(...)
       deviation  = _deviation_reward_rollout(predicted_world, t)
       conflict   = infringement_reward_from_world(predicted_world, t)
       action     = -_action_penalty(interpreted_actions)   # DOF-scaled
       goal       = _goal_bonus(predicted_world)            # exp(-total_dev/S_T) * exp(-max_dev/S_M)
       -> RewardParts(deviation, conflict, action, goal)
  -> _check_terminated / _check_truncated
  -> adjust bonus on terminal step
  -> reward = r_parts.total()
```
