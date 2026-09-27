# Observations

!!! abstract "Summary"
    A `Dict` observation, everything scaled to `[-1, 1]`: a global vector, per-aircraft scalars, each
    aircraft's flight plan relative to its position, its last 8 clearances, and the action masks.
    Per aircraft there are 12 base scalars, plus 4 AMAN-sequence columns (from `1_33`) and 1 "cleared
    at this step" flag (with reselection, from `1_36`), so 17 in current models. Time features are
    log-scaled so the ±60–120 s decisions are resolvable. The windowed env replaces every feature
    that described the whole scenario with one that describes the window.

Source: `models/observations.py`, `atc_env/windowed_env.py`, `config/config.py`.

## Layout

| key | shape | content |
|---|---|---|
| `global` | `(4,)` | time feature, traffic load, mean deviation, max predicted infringement |
| `aircraft` | `(10, 17)` | per-aircraft scalars (below) |
| `mask_aircraft` | `(10,)` | selectable slots |
| `mask_action_per_ac` | `(10, 15)` | valid clearances per slot |
| `flight_plans_rel` | `(10, 20, 11)` | up to 20 waypoints: position, offset, distance, bearing, target speed |
| `flight_plan_mask` | `(10, 20)` | real waypoints |
| `action_histories` | `(10, 8, 16)` | last 8 clearances per aircraft, one-hot, most recent first |

With reselection the observation also carries `mask_select` and `mask_again`
([Actions](actions.md#reselection)). Coordinates pass through a random per-episode translation
(`T_obs`) so the policy cannot memorise absolute positions.

## Per-aircraft scalars

| # | feature | encoding |
|---|---|---|
| 0–2 | position x, y, z | ±150 NM, ±45 000 ft |
| 3–6 | ground speed, vertical speed, heading sin/cos | 350 kt, ±3000 fpm |
| 7 | time to target | signed log (windowed: scheduled `eta − now`) |
| 8 | predicted landing deviation | signed log, from the do-nothing rollout |
| 9 | predicted infringement | worst severity in the look-ahead, 3–10 NM detection band |
| 10 | time to conflict | linear over 20 min; 1 = imminent |
| 11 | under control | 0/1 |
| 12–15 | AMAN sequence (`TADA_SEQUENCE_OBS=1`) | predicted rank shift; crossings; landing-gap error to AMAN predecessor and successor |
| 16 | cleared at this step (`TADA_MAX_PICKS>1`) | 0/1 |

**Log-scaled time.** `obs = sign(d) · ln(1 + |d|/10 s) / ln(1 + 1800 s/10 s)`. The earlier linear
`d/900` put every decision boundary (±60, 70, 100, 120 s) inside the bottom 13% of the range and
encoded a 10 s error as 0.011. Log scaling cut `time_to_target` saturation from 65.6% to 18.1% on
MXP (71.4% → 15.1% on point merge). It shipped with `1_26`.

**The agent sees further than it is charged.** Feature 9 reads the wide 3–10 NM detection band,
while the [conflict cost](separation.md#severity) only starts inside 5 NM. A conflict can be watched
developing from 10 NM before it costs anything.

**Sequence columns.** Computed from the do-nothing prediction. Negative gap error means
compression. `1_33` added them with the input weights zero-initialised, so it started out computing
exactly `1_32`'s function (output difference 0.0 over 60 states). On their own they did not help
([Findings → sequencing](../findings/sequencing.md)).

## Windowed replacements { #windowed }

| feature | 10-aircraft env | problem on a stream | windowed env |
|---|---|---|---|
| prediction rollout | to the scenario's last landing | length and cost grow with the scenario | receding: `max(2880 s, window's last ETA) + 20 steps`, cap 200 |
| `time_to_target` | read from the rollout's **end** world | encodes rollout length | scheduled `eta − now` |
| `global[0]` | absolute time / 2880 s | pinned at +1 after 48 min | time until the window's last flight is due |
| `global[1]` | filled slots / 10 | a queue window is always full | flights **under control** / 10 |
| `global[3]` | max infringement over every aircraft | includes pairs the agent cannot see | max over the window |

The two time features use a 7200 s signed-log scale (same 30 s knee); ten flights at the
generator's spacing span up to ~6000 s. Two saturations remain and neither depends on stream
length. `time_to_conflict` sits at −1 when nothing is predicted (its floor), and `vel_xy` is capped
~62% of the time because spawn speeds are 375–425 kt against a 350 kt scale.

### The `time_to_target` bug { #time-to-target-bug }

In the 10-aircraft env `time_to_target` is computed on the **end state of the do-nothing rollout**,
thousands of seconds in the future. At t = 540 s a flight 587 s from its target read 5381. The
value is `rollout length − time to go`; it exceeds the 2880 s scale and sits near +1. **It was a
dead feature in every 10-aircraft run.** It is fixed in the windowed env only, because fixing the
base env would change what every existing checkpoint sees.

## Known imperfections

- `time_to_conflict` ramps linearly over 20 min while the conflict cost decays with a 4-minute
  half-life: at 240 s out the cost has halved and the feature still reads 0.80.
- The action history has no timestamps, so rows from different aircraft are not aligned in time.
  Its GRU uses 4.5 of 64 effective directions
  ([Archive → 10-aircraft tests](../archive/ten-aircraft-tests.md#embedding-capacity)).
- Aircraft are pooled into the context by a permutation-invariant summary. From `1_29` onward one
  masked self-attention block over the slots lets aircraft attend to each other
  (`USE_AIRCRAFT_ATTENTION`), because a mean over aircraft cannot express "these two are
  converging".
