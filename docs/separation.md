# Loss of separation — what the simulator actually reports

Source: `rust_simulator/simulator_lib/src/aircraft_service.rs`,
`utils/infringement_utils.py`, `actions/rewards.py`, `atc_env/single_agent_env.py`

This page pins down what `LOSS_OF_SEPARATION` means, where "severity" comes from, and the
difference between a conflict that **actually happened** and one that is merely **predicted**.
It exists because those three things are routinely conflated, and the conflation has already
produced one piece of dead code (see [the scenario filter](#the-scenario-filter-is-dead-code)).

---

## The raw simulator event

`LOSS_OF_SEPARATION` is emitted by the Rust simulator in
`AircraftService::check_aircraft_separation`. It is a **pure current-position geometric test** —
there is no prediction, no severity, and no notion of flight phase (landing, cruise, approach)
anywhere in it:

```rust
if dist_h < aircraft.mission.aircraft_horizontal_safezone_radius * 2.0
    && dist_v < aircraft.mission.aircraft_vertical_safezone_radius
{
    // -> Infringement::LossOfSeparation { timestamp, aircraft_pair,
    //                                     horizontal_separation, vertical_separation }
}
```

Both aircraft must be `is_active` **and** `under_control`; pairs are de-duplicated per call.
The emitted struct carries only a timestamp, the pair, and the two separations.

!!! warning "The emit threshold is much wider than 3 NM"
    The radius is multiplied by **2**, and `HORIZONTAL_SAFEZONE_RADIUS_NM = 10.0`, so the
    simulator raises a `LOSS_OF_SEPARATION` for **any pair inside 20 NM horizontally and
    1000 ft vertically**. A raw event count is therefore *not* a count of real separation
    breaches — most raw events are routine proximity. Severity (below) is what makes it
    meaningful.

### Sampling cadence

`update_infringement_info` runs on **every 1-second simulator tick**, but the separation scan
is throttled by a 60-second bucket:

```rust
let bucket_seconds = 60.0;
let current_bucket = (world_age_in_seconds / bucket_seconds).floor();
// last_check_bucket is read from the most recent LoS / AirspaceExit timestamp
if last_check_bucket.is_none() || last_check_bucket.unwrap() < current_bucket { /* scan */ }
```

Two consequences worth knowing:

1. While the world is clean the scan runs every second; once *any* `LOSS_OF_SEPARATION` or
   `AIRSPACE_EXIT` has been recorded, further scans are suppressed until the world age crosses
   into a later 60 s bucket.
2. The recorded `horizontal_separation_nm` is therefore **a sample, not the closest point of
   approach**. A fast crossing pair can be logged at 4 NM even though they actually passed at
   2 NM, if the scan happened to be throttled through the closest approach.

---

## Severity is a Python-side derived quantity

The simulator does not produce a severity. `normalize_separation()`
(`utils/infringement_utils.py`) maps the two separations onto `[0, 1]`, taking the **minimum**
of the two axes so that *both* must be bad for the value to be high:

```python
h = clamp01((H_safe - horizontal_nm) / (H_safe - H_conflict))
v = clamp01((V_safe - vertical_ft)   / (V_safe - V_conflict))
severity = min(h, v)
```

With the current constants (`H_safe = 10 NM`, `H_conflict = 0 NM`,
`V_safe = 1000 ft`, `V_conflict = 500 ft`):

| Horizontal sep | severity (v = 0) | | Vertical sep | severity (h = 0) |
|---|---|---|---|---|
| 0 NM | **1.00** | | ≤ 500 ft | 1.00 |
| 1 NM | 0.90 | | 650 ft | 0.70 |
| 2 NM | 0.80 | | 800 ft | 0.40 |
| **3 NM** | **0.70** | | 1000 ft | 0.00 |
| 5 NM | 0.50 | | | |
| ≥ 10 NM | 0.00 | | | |

!!! danger "`severity == 1.0` is unreachable in practice"
    Because `HORIZONTAL_CONFLICT_RADIUS_NM` is currently **0.0**, severity 1.0 requires
    **literally zero horizontal separation** — i.e. a collision. It was 3.0 historically
    (the commented-out line still sits in `config.py`), and under *that* setting
    severity 1.0 did mean "within 3 NM".

    **If you mean "the aircraft were within 3 NM", the code's expression for that is
    `severity >= 0.7` (`NEAR_CONFLICT_THRESHOLD`), not `severity == 1.0`.**
    Note it also requires vertical separation ≤ 650 ft, because of the `min` over both axes.

---

## Realised vs. predicted — the distinction that matters

The *same* simulator function is evaluated on **two different worlds**, and the environment
treats the results very differently:

| | World it reads | Function | What it drives |
|---|---|---|---|
| **Realised** | the live, committed world | `_episode_violations()` | `end_reason="separation"`, `REWARD_VIOLATION_PENALTY`, the success gate |
| **Predicted** | a NOOP rollout to the end of the episode | `has_near_conflict()`, `infringement_reward_from_world()` | the dense per-step conflict penalty |

The predicted world comes from `simulator.advance_multiple_steps()`, which returns a **new**
world and leaves the live one untouched — so predicted conflicts never contaminate the realised
infringement list.

### What counts as a violation (realised)

`_episode_violations()` reads `world.infringements`, which accumulates everything raised since
`reset()`, and asks whether **any** `LOSS_OF_SEPARATION` reached `severity >= 0.7`:

```python
sep = get_world_infringements(world)          # LOSS_OF_SEPARATION only, normalised to [0,1]
had_separation = any(t.value >= Config.NEAR_CONFLICT_THRESHOLD
                     for lst in sep.values() for t in lst)
```

This is already exactly the operational rule — *a real pair, inside 3 NM, at a real timestep* —
and it has driven `end_reason` and the violation penalty since before run `1_22`.

### The success gate (`SUCCESS_CONFLICT_REALISED_ONLY`)

From run `1_25` onward the tier gate uses the **realised** signal too:

```python
if Config.SUCCESS_CONFLICT_REALISED_ONLY:       # current default: True
    had_separation, _ = self._episode_violations()
    no_near = not had_separation
else:                                            # legacy
    no_near = self._steps_since_near_conflict >= Config.SUCCESS_NEAR_CONFLICT_CLEAR_STEPS
```

The legacy gate was a **recency** test on the *forecast*: "the NOOP rollout predicts no
severity ≥ 0.7 conflict within `NEAR_CONFLICT_TIME_S = 1200 s`, for the last 3 steps".
The new gate is an **ever** test on *reality*: "no actual breach at any point this episode".

!!! note "This tightens the flag, it does not relax it"
    It is tempting to assume that ignoring predicted conflicts must make success easier. It
    does not, because the legacy gate was **never the binding constraint** — see the
    measurement below. What changes is that the reported `success` flag can no longer be
    `True` on an episode that actually busted 3 NM, which was previously possible: the flag
    consulted the forecast while the reward consulted reality.

Both gates are logged every episode (`no_near_conflicts` and `no_near_conflicts_predicted`),
so the two regimes can be compared on identical episodes.

### Measured: the predicted gate never bound

Replaying `atc_run_1_22`'s own checkpoints with both gates instrumented, on its eval seeds:

| Checkpoint | Episodes with no real LoS | Gate open (realised) | Gate open (predicted) | Relaxations | Tightenings |
|---|---|---|---|---|---|
| 200 k | 11/15 | 11 | **15** | 0 | 4 |
| 1.0 M | 11/15 | 11 | **15** | 0 | 4 |
| 2.5 M | 11/15 | 11 | **15** | 0 | 4 |
| 4.0 M | 9/15 | 9 | **15** | 0 | 6 |
| `best_model` (20 seeds) | 19/20 | 19 | **20** | 0 | 1 |

The predicted gate was open in **every episode at every checkpoint**; the relaxation direction
fired **0 times in 95 episode-evaluations**. `SUCCESS_NEAR_CONFLICT_CLEAR_STEPS = 3` is only a
~135 s window at the *end* of an episode, by which point the aircraft have landed or separated,
so the rollout is essentially always clear.

This is corroborated across the whole experiment log: `eval_success/no_near_conflicts_mean`
sits at **0.99–1.00 in every run from `1_17` to `1_24_pms`**. Conflicts have not been the
blocker for a long time — **schedule deviation is**.

---

## Where prediction genuinely drives behaviour

Not the gate — the **reward**. `infringement_reward_from_world()` runs on the predicted world
with `REWARD_INFRINGEMENT_WEIGHT = 10.0` over a 20-minute `NEAR_CONFLICT_TIME_S` horizon, and
that term is what gives the agent any incentive to head a conflict off *before* it happens:

```
w(ttc) = max(CONFLICT_FAR_FLOOR, ((T_near - ttc) / T_near) ** CONFLICT_TIME_EXPONENT)
conflict_penalty = -REWARD_INFRINGEMENT_WEIGHT * sum_pairs( severity * w(ttc) )
```

Making *this* realised-only would remove all look-ahead pressure: the agent would receive no
conflict gradient until aircraft were already inside 3 NM, which is far too late to act on.
It is deliberately left on the predicted world.

---

## The scenario filter is dead code

`Simulator.check_not_imminent_infringement()` rejects candidate scenarios that start with an
imminent conflict:

```python
return not any(
    tuple.value >= 1.0                       # <-- unreachable
    for aircraft_infringements in infringements.values()
    for tuple in aircraft_infringements
)
```

Since severity cannot reach `1.0` under `HORIZONTAL_CONFLICT_RADIUS_NM = 0.0`, this function
**always returns `True`**: every generated scenario passes as "conflict-free", including ones
that open with a 1 NM predicted conflict. The threshold was written when the conflict radius
was 3.0 NM, and silently became inert when it changed to 0.0.

**Fix when convenient:** compare against `Config.NEAR_CONFLICT_THRESHOLD` instead of the
literal `1.0`. This has not been changed yet because it would alter the training scenario
distribution, and doing so mid-campaign would confound the `1_25` comparison against `1_22`.

---

## Summary

| Question | Answer |
|---|---|
| Is `LOSS_OF_SEPARATION` about landing? | No. It has no flight-phase logic at all. |
| Is it predicted or actual? | The event is always **actual geometry** — but it is evaluated on both the live world *and* on NOOP-rollout worlds, and the caller decides which. |
| Does it carry a severity? | No. Severity is computed in Python by `normalize_separation()`. |
| What is "within 3 NM" in code? | `severity >= 0.7` (`NEAR_CONFLICT_THRESHOLD`), **not** `severity == 1.0`. |
| What does a violation mean? | Realised, live-world, severity ≥ 0.7 → `end_reason="separation"` and `−REWARD_VIOLATION_PENALTY`. |
| What still uses prediction? | The dense conflict reward, and the eval-time shield in `render_policy.py`. |
