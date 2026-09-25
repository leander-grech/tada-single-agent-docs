# Windowed env: a 20-flight stream

!!! abstract "TL;DR"
    `WindowedATCEnv` (`main.py --env windowed`) runs a **20-flight** MXP trombone scenario
    through a window of the **next 10 flights in the landing queue**. When a flight lands, the
    next one in the queue takes its slot. The observation and action spaces match the
    10-aircraft env exactly, so existing checkpoints load unchanged.

    **Design rule: nothing the agent observes, and nothing its critic has to predict, depends
    on how many flights the scenario has.** A scenario is treated as a finite excerpt of an
    endless arrival stream, so the same agent can be run on longer streams at evaluation. Those
    runs are stability tests of whether it can be used continuously.

    **The reward is per flight instead of per episode.** The tier ladder assumes a fixed set of
    aircraft, so it can't survive a window whose membership keeps changing. Each flight earns
    a bonus once, at touchdown, from its actual landing deviation.

    **Zero-shot, before any training** (run `1_29`'s best checkpoint, 20 seeds): **79%** of
    flights on time, **10%** of episodes lose separation, **10%** land all 20 flights on time.
    Run `1_31_windowed` is training from that checkpoint now.

    Two findings affect the existing env too:

    - [`time_to_target` has been a dead feature](#time-to-target-bug) in every run so far.
    - [Generated scenarios get harder further down the queue](#generator-not-stationary).

## Why a window, and why this one

The trombone generator releases aircraft over time. At t = 0 none of the 20 is under
control; measured across seeds, **3.6 are active on average and up to 13 at once**. Ten slots
are almost always enough, but not always, so the queue needs a rule for who is visible.

"Next in line" is well defined here. On every probed seed, the landing order under
do-nothing equals the AMAN target order, so the window is simply the AMAN queue:

| | rule |
|---|---|
| membership | the next `WINDOW_SIZE = N_AIRCRAFT_MAX = 10` **unlanded** flights, in AMAN order, spawned or not |
| on landing | the flight leaves; the next flight in the queue takes the slot |
| not-yet-spawned flights | **visible** (the agent can plan around them; `under_control = 0`), but only `DO_NOTHING` is unmasked |
| aircraft head | picks only under-control slots when any exist; falls back to all visible slots otherwise |
| slot order | queue position; the policy is permutation-equivariant, so slot index carries no meaning |

The aircraft-head rule is not optional. Without it, zero-shot `1_29` kept *picking* pending
flights and spent the step on a no-op: **65%** of episodes lost separation. With the rule,
**10%**. The 10-aircraft env never mixes under-control and pending slots in one observation
(0 of 178 checked), so for existing checkpoints the rule is exactly the old mask.

Flights under control but more than 10 places back are invisible. They are logged as
`window_overflow_frac`, about **3%** of steps.

## Observables: what was scenario-dependent, and what replaced it { #observables }

The base env assumes the whole scenario fits in view. Everything that encoded the
scenario rather than the window is replaced. The windowed env does this after the shared
observation builder runs, so the base env is untouched.

| feature | base env | problem in a stream | windowed env |
|---|---|---|---|
| NOOP prediction rollout | to the scenario's **last** landing | length (and cost) grows with the scenario | **receding**: `max(2880 s, window's last ETA) + 20 steps`, cap 200 |
| per-aircraft `time_to_target` | read from the rollout's **end** world | encodes rollout length, see [below](#time-to-target-bug) | scheduled time to go, `eta − now` |
| `global[0]` time | absolute scenario time / 2880 s | pinned at +1 after 48 min; means nothing mid-stream | **window span**: time until the window's last flight is due |
| `global[1]` active count | slots filled / 10 | a queue window is always full, so it only drops as the scenario *ends* | window flights **under control** / 10 (the actual traffic load) |
| `global[3]` max predicted infringement | over every aircraft in the world | includes pairs the agent can't see | max over the window |

The two time features use their own **7200 s** signed-log scale (same shape and 30 s knee as
the base encoding). Ten flights at the generator's 90–600 s spacing span up to ~6000 s; on the
2880 s scale the window span sat at +1 a quarter of the time.

**Verified stationary.** 20- and 40-flight streams were rolled out with `1_29`, and every
feature was compared early vs late in the stream. None drifts, and neither time feature
saturates (0.0% and 0.1%, down from 25–35% and 5–10%).

Two saturations remain, and neither depends on flight count:

- `time_to_conflict` sits at −1 when there is no predicted conflict. That is its floor, not
  clipping.
- `vel_xy` is capped ~62% of the time, because spawn speeds are 375–425 kt against a 350 kt
  normaliser. That encoding is shared with the base env and was left alone.

### The `time_to_target` bug { #time-to-target-bug }

`build_global_observation` computes `time_to_target` as
`curr_world.calculate_time_to_target_arrival(cs)`, where `curr_world` is the **end state of
the NOOP rollout**, thousands of seconds in the future. Measured at t = 540 s:

| flight | scheduled time to go | live world | rollout-end world (what the obs used) |
|---|---|---|---|
| TEST001 | 587 s | −587 | **5381** |
| TEST002 | 807 s | −807 | **5161** |
| TEST003 | 1028 s | −1028 | **4940** |

The value is `rollout length − time to go`. It exceeds the 2880 s scale, so it sits pinned
near +1 and is **effectively a dead feature in every run so far**. It is fixed in the windowed
env only; fixing the base env would change what every existing checkpoint sees.

## Reward: per flight, not per episode { #reward }

| term | 10-aircraft env | windowed env |
|---|---|---|
| success signal | tier ladder over the fixed set + [PBRS](pbrs.md) | **landing bonus** per flight, once, at touchdown |
| dense deviation | every aircraft, every step, weight 0.2 → 1 | unlanded flights; weight **0 → 1** over the last 2880 s before landing |
| dense conflict | every predicted pair | pairs with at least one member **in the window** |
| goal bonus | on | off (an episode-set construct, like the ladder) |
| end of scenario | termination | **truncation** (PPO bootstraps) |
| bust penalty | 30 + 0.5 × remaining **steps** | constant: 30 + 3 × 10 (a window's worth of landings) |

**Landing bonus.** `Σ_k B_k · σ((D_k − |dev|) / 15 s)` with rungs (120 s, 1.0) and (60 s, 2.0).
A flight within ±60 s earns ~3.0, about what the 10-aircraft ladder's 32.5 total pays per
aircraft, so the incentive per flight matches the checkpoint being warm-started.

**Why the dense deviation weight starts at 0.** A flight's charge fades in as it approaches.
It never jumps when a flight enters the window or the rollout. Landed flights stop being
charged; in a 150-step episode, a per-step charge for an early flight's residual deviation
would dominate the return.

**Why truncation and a constant penalty.** The critic sees the window, not how many flights
remain. If the stream running dry ended the episode, or the bust penalty scaled with flights
left, V(s) would have to predict something unobservable. A real loss of separation is still a
true termination. The tier ladder is still computed over all 20 flights and logged; it is
just not rewarded.

## Results

**Zero-shot**, run `1_29_pbrs_attn_d` best checkpoint, 20 seeds, deterministic, no training:

| env | all flights on time | flights on time | separation lost |
|---|---|---|---|
| 10-flight | 0.55–0.75 ¹ | — | 0.00–0.05 |
| 20-flight window | **0.10** | **0.79** | **0.10** |
| 20-flight window, under-control-only ² | 0.20 | 0.81 | 0.20 |
| 20-flight window, no aircraft-head rule ³ | 0.00 | 0.34 | 0.65 |

¹ Two identical runs; the per-episode observation offset is drawn from an unseeded RNG, so 20
episodes move this much. ² The earlier window rule, where only spawned flights are eligible.
³ Pending flights selectable: the failure described [above](#why-a-window-and-why-this-one).

"All 20 on time" is roughly the per-flight rate to the 20th power, so it is the wrong
headline for a stream. **Quote `window_on_time_rate`**: on-time landings over *all* flights of
the scenario, so a bust or a timeout counts every unlanded flight as a miss. It is comparable
across stream lengths.

**Training.** Warm-started from `1_29`'s policy weights with a fresh VecNormalize, 5M steps on
8 workers.

- `1_31` used the fresh-run LR schedule and **got worse**: on-time 0.79 → 0.49.
- `1_32` retunes it as a fine-tune: 300k steps of critic-only warm-up, then peak LR 3e-5 and
  entropy coefficient 0.003. Scored paired on 100 seeds, it takes **all 20 on time from 0.08
  to 0.29** (21 newly solved, none lost). The on-time rate is flat at 0.73 and separation
  losses unchanged at 21%.

See the [experiment log](experiments.md#run-1_31).

**Cost.** A windowed step takes ~131 ms against ~36 ms in the 10-aircraft env. The rollout
takes 78 ms of it (20 ms in the base env): twice the aircraft, and mid-stream the airspace
never empties. The observation build takes 40 ms (11 ms), because the window always holds 10
flights where the base env shows ~3.4. Train with `--n-envs 8`.

## Renders: run `1_32` on 20-flight validation seeds { #renders }

`1_32` final model, deterministic, no shield, with the observation frame pinned per seed.
Each render reproduces the scorer's outcome for its seed exactly. The seeds are an honest
sample: two solved, one typical, one loss of separation.

- **Frame title:** the window (as queue positions) and on-time over landed so far.
- **Aircraft table:** every flight, with its status: `PRE` not yet spawned, `AIR`, `LND`
  landed.
- **Colours:** by queue position.

<p><strong>Solved</strong>: all 20 on time (seed 1001495968, 132 steps, 121 clearances):</p>
<video controls preload="metadata" width="100%">
  <source src="../assets/renders/1_32_solved_seed1001495968.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

<p><strong>Solved</strong>: all 20 on time (seed 921959045, 149 steps, 128 clearances):</p>
<video controls preload="metadata" width="100%">
  <source src="../assets/renders/1_32_solved_seed921959045.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

<p><strong>Typical</strong>: all landed, 17 of 20 on time (seed 1181241943):</p>
<video controls preload="metadata" width="100%">
  <source src="../assets/renders/1_32_typical_seed1181241943.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

<p><strong>Loss of separation</strong> at step 72 (seed 27911967); <code>1_29</code> zero-shot kept this
seed clean:</p>
<video controls preload="metadata" width="100%">
  <source src="../assets/renders/1_32_bust_seed27911967.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

The agent issues a clearance on **~90% of steps** (121 of 132, 128 of 149): the
over-commanding pattern seen in earlier runs.

## Stream stability: drift along the queue, and 40-flight streams { #stability }

Same 100 paired seeds, `1_29` zero-shot vs `1_32` final, broken down by queue position.
"Landed" is the share of flights that land at all: a loss of separation ends the episode and
strands every flight behind it. "On time \| landed" is precision among those that did land.

| stream | queue position | landed (1_29 / 1_32) | on time \| landed | median \|dev\| (1_32) |
|---|---|---|---|---|
| 20 | 1–4 | 0.99 / 0.95 | 0.87 / 0.91 | 14 s |
| 20 | 9–12 | 0.87 / 0.84 | 0.80 / 0.81 | 15 s |
| 20 | 17–20 | 0.79 / 0.79 | 0.91 / 0.89 | 0 s |
| 40 | 1–8 | 0.95 / 0.94 | 0.85 / 0.88 | 14 s |
| 40 | 17–24 | 0.63 / 0.69 | 0.71 / 0.68 | 21 s |
| 40 | 25–32 | 0.47 / 0.58 | 0.63 / **0.57** | **40 s** |
| 40 | 33–40 | 0.38 / 0.47 | 0.70 / 0.68 | 15 s |

- **Within the trained length (20 flights), the agent is stable.** Precision is flat along
  the queue; the whole late-queue drop is episodes ending in a loss of separation.
- **At 40 flights, the stability test fails.** Separation is lost in **53%** of episodes
  (`1_29`: 62%), and precision drifts as well (median deviation 40 s at positions 25–32).
  That is the generator's [growing backlog](#generator-not-stationary), well beyond anything
  the 20-flight training showed. `1_32` degrades less than `1_29`, but continuous use needs
  either longer training streams or a backlog the agent can observe.

| 40-flight stream | on time | separation lost | all 40 on time |
|---|---|---|---|
| `1_29` zero-shot | 0.481 | 0.62 | 0.00 |
| `1_32` final | 0.517 (+0.037, n.s.) | 0.53 (21 fixed, 12 new, n.s.) | 0.02 |

## Inference-time conflict shield { #shield }

`render_policy`'s shield refuses a clearance that introduces a near-horizon conflict
do-nothing would not, and issues the best clearance that passes instead (`next_best`).
Applied to `1_32` on the same 100 seeds it is **net harmful**:

- on-time **−0.053** (SE 0.015, significant);
- **12 of the 29** solved seeds lost, 1 gained;
- separation 0.21 → 0.19: 7 busts fixed, 5 new, which is noise.

It can only veto clearances. Busts that come from not acting are out of its reach, which is
also what the [10-aircraft sweep](successful_results.md#refusal-shield-sweep-100-seeds) found.

## Where the compute goes { #compute }

Per environment step, measured on an idle machine:

| component | time | share |
|---|---|---|
| Rust simulator: NOOP prediction rollout | 23.4 ms | **74%** |
| Python observation build | 7.5 ms | 24% |
| rest of `env.step` | ~1 ms | 3% |
| policy forward (single obs, CPU) | 6.4 ms | outside the env |

The PPO update is roughly 20% of wall-clock at 8 workers; the rest is collecting
experience.

The rollout cannot simply run coarser. Measured against 1 s ticks (the rollout's current
resolution):

| tick | rollout cost | predicted-deviation error, median / p95 / max |
|---|---|---|
| 2 s | ×0.62 | 4 s / 203 s / 1182 s |
| 5 s | ×0.35 | 148 s / 308 s / 875 s |

Route following needs the fine integration step. The rollout cost is a floor unless the
simulator itself gets faster.

## Generated scenarios get harder down the queue { #generator-not-stationary }

The scenario generator is not stationary in queue position. Under do-nothing, 20 seeds each:

| flights | ETA gap | \|dev\| 1–10 | 11–20 | 21–30 | 31–40 |
|---|---|---|---|---|---|
| 20 | 251–279 s | 183 s | 368 s | | |
| 40 | 232–249 s | 224 s | 513 s | 687 s | **913 s** |

Landing spacing stays flat while the deviation to recover grows along the queue. The
mechanism is not established: it may be knock-on delay down the trombone, or how the
generator times spawns. The consequence is concrete, though. **A long-stream stability test
also tests backlog handling well beyond the 20-flight training range.** Untrained, `1_29`
lost separation in every 40-flight episode.

## Running it

```bash
# train (warm start from an existing checkpoint with the same ACTION_SET)
python -u main.py --env windowed \
  --init-weights experiments/atc_run_1_29_pbrs_attn_d/best/best_model.zip \
  --n-envs 8 --critic-warmup-steps 300000 --lr-max 3e-5 --final-lr 3e-6 --ent-coef 0.003 \
  --total-timesteps 5000000 --run-suffix windowed_ft
```

A longer stream at evaluation: construct the env with
`WindowedATCEnv({"evaluation_mode": True, "scenario_aircraft_count": 40})`.

| setting (`config/windowed_config.py`) | value |
|---|---|
| `DIFFICULTY` | `VALIDATION_USE_CASE_1` (trombone; independent of `config.py`'s default) |
| `SCENARIO_AIRCRAFT_COUNT` / `WINDOW_SIZE` | 20 / 10 |
| `WINDOW_UNDER_CONTROL_ONLY` / `PENDING_ACTIONABLE` | `False` / `False` |
| `ROLLOUT_LOOKAHEAD_S` / `ROLLOUT_MARGIN_STEPS` | 2880 s / 20 |
| `TIME_SCALE_S` | 7200 s |
| `MAX_EPISODE_STEPS` | 200 (last ETA is 5000–7100 s = 111–158 steps) |
| `CONTINUING_TASK` | `True` |

Metrics land under `window_metrics/` (training) and `eval_window/` (eval): `on_time_rate`,
`n_landed`, `mean/max_abs_landing_dev`, `occupancy_mean`, `overflow_frac`,
`landing_bonus_total`.

!!! warning "Simulator 0.2.80 changes the scenarios"
    This work moved to `flight_simulator` **0.2.80** (from 0.1.52). The API is identical, but
    **the same seed now generates a different scenario**. Numbers from before this point are
    not reproducible on the same seeds.

!!! note "Stitching as the alternative"
    Point-merge was solved by stitching two 10-aircraft agents (up to 99% on the validation
    seeds). On trombone the halves overlap in time — flight 11 spawns before flight 10 lands —
    so stitching needs a hand-off rule. The windowed agent is the version that needs none. It
    has to beat roughly 0.55² ≈ 0.30 all-on-time, which is what two independent 10-flight
    halves would score.
