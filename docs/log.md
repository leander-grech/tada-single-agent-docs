# Experiment log

!!! abstract "Summary"
    Every run, in order, with what it changed and what it taught. Scores are on each run's
    [report card](models/index.md). Launch dates are from `run_meta.json`. The early runs (1–7)
    are summarised together; their full narrative is in [Archive → early runs](archive/early-runs.md).

## 10-aircraft track

### Runs 1–7 (`1_4`–`1_13`, June) { #runs-1-7 }

The SB3 baseline and six rounds of reward, observation and optimiser tuning: imminence-weighted
conflicts, a relaxed success gate, simulator-only deviation, entropy and VecNormalize fixes, a larger
gradient clip, a dense goal bonus, KL control. Conflicts were brought under control, but schedule
deviation hit a ceiling that none of this moved. No episode ever met the old all-within-±30 s
success gate. [Details](archive/early-runs.md).

### `1_16` — tiered success, autoregressive policy (24 Jun) { #run-1-16 }

A five-tier success ladder instead of the all-or-nothing gate, an aircraft-then-clearance
autoregressive policy, a per-scenario horizon and a degrees-of-freedom action cost. The first
non-zero success rate and the first break in the deviation ceiling; training oscillated rather than
converging. Every refusal shield scored below the raw policy. [Card](models/1_16.md).

### `1_16_a`, `1_16_b`, `1_17` — the 22 s interval (24–25 Jun) { #run-1-16-a }

`1_16_a` and `1_16_b` spun off `1_16` at 2M: a 45 s control and a 22 s interval with a warm LR
restart. The 22 s arm briefly had the best per-aircraft deviation, then regressed harder.
 <a id="run-1-16-b"></a> `1_17` tested 22 s cleanly from scratch and lost. Acting twice as often doubled the
credit-assignment horizon. Every later run is on 45 s. <a id="run-1-17"></a>
[`1_16_a`](models/1_16_a.md) · [`1_16_b`](models/1_16_b.md) · [`1_17`](models/1_17.md).

### `1_18`–`1_21` (26–29 Jun) { #run-1-18 }

Back on 45 s; parallel training (4 workers) arrived here. Not otherwise documented, and not
replayable on today's code. <a id="run-1-19"></a> <a id="run-1-20"></a> <a id="run-1-21"></a>
[`1_18`](models/1_18.md) · [`1_19`](models/1_19.md) · [`1_20`](models/1_20.md) · [`1_21`](models/1_21.md).

### `1_22` — the best of its era, and a broken meter (30 Jun) { #run-1-22 }

Its in-training success rate read 1.00; offline scoring on 100 seeds found far less. That exposed the
in-training eval as noise and led to `score_checkpoints.py` and `track_run.py`
([Evaluation noise](findings/evaluation-noise.md)). Replaying it also showed that the forecast-based
success gate had hidden real losses of separation ([Separation](how/separation.md)).
[Card](models/1_22.md).

### `1_23`, `1_24` — a six-tier ladder (Jul) { #run-1-23 }

A sixth tier down to ±30 s. The tier means are not comparable with the five-tier runs. Not otherwise
documented. <a id="run-1-24"></a> [`1_23`](models/1_23.md) · [`1_24`](models/1_24.md).

### `1_24_pms` — point merge (27 Jul) { #run-1-24-pms }

The BGY point-merge scenario, which stayed near the do-nothing floor.
[Archive → point merge](archive/point-merge.md) · [Card](models/1_24_pms.md).

### `1_25` — realised-only success gate (3 Aug) { #run-1-25 }

`1_22`'s code with the success gate on real, not predicted, losses of separation: a semantics fix,
not a capability change (the difference is inside the noise). It fixed the clean-subset ceiling the
next runs aimed at. [Card](models/1_25.md).

### `1_26` — the severity redesign (10 Aug) { #run-1-26 }

A 3–5 NM severity band, termination on a real loss with a horizon-aware penalty, and log-scaled time
observations, shipped together. Clean-subset success moved for the first time in twenty runs while
separation losses halved; `1_25`'s policy scored far worse under the new rules, so the gain was not an
easier MDP. The bundle was never ablated. The 10-aircraft champion. [Card](models/1_26.md).

### `1_27`, `1_27a` — 15 clearances instead of 22 (11–17 Aug) { #run-1-27 }

The reduced clearance set learned much faster and converged to worse precision; `SHORTEN_TROMBONE`,
its one new capability, was issued about once per thousand clearances. `1_27` crashed and resumed onto
the wrong learning-rate schedule; `1_27a` re-ran the second half on the right one and changed
nothing. <a id="run-1-27a"></a> [Archive → 22 clearances vs 15](archive/clearance-sets.md) ·
[`1_27`](models/1_27.md) · [`1_27a`](models/1_27a.md).

### `1_28` — a learning-rate schedule (17 Aug) { #run-1-28 }

Meant to test a 1% warm-up and a 3e-6 floor, but stopped after 20 480 steps, 6 minutes in:
never trained, so there is nothing to score. [Card](models/1_28.md).

### `1_29` — continuous shaping and attention (19–20 Aug) { #run-1-29 }

The tier potential made continuous (it had been a staircase that paid only at band crossings), and a
masked self-attention block over the aircraft slots. Trained to 10M, then continued to 20M
(`1_29_pbrs_attn_d`). Its best checkpoint is the starting point of the windowed track.
[Card](models/1_29.md).

### `1_30_pms` — point merge again (24 Aug) { #run-1-30-pms }

Not documented beyond its run name. Scored in September on its own scenario: the best point-merge
agent so far, still far below MXP and losing separation often. [Card](models/1_30_pms.md).

## Windowed track

### `1_31` — the first stream run (24 Sep) { #run-1-31 }

`1_29`'s weights on 20-flight streams with a fresh-run learning-rate schedule. The critic, trained on
another reward's scale, gave bad advantages at full step size, and the policy got worse than its
start. Stopped at 2M. Lesson: a warm start onto a new reward needs a fine-tuning schedule.
[Card](models/1_31.md).

### `1_32` — the fine-tune done properly (24 Sep) { #run-1-32 }

Critic warm-up, a 10× lower learning rate, less entropy. All-on-time streams rose several-fold
(McNemar-significant), precision was flat and separation unchanged. Separation became the lever.
[Card](models/1_32.md).

### `1_33` — sequence observations (25 Sep) { #run-1-33 }

Four AMAN-sequence columns per aircraft, reward unchanged. No gain held across checkpoints; the
agent could see the sequence but was not paid to keep it ([Sequencing](findings/sequencing.md)).
[Card](models/1_33.md).

### `1_34` — the lexicographic objective (26 Sep) { #run-1-34 }

The reward became the objective (safety, then per-flight deviation bracket, then fewest clearances)
plus potential-based shaping ([Objective](how/objective.md)). Stopped at 0.8M in favour of `1_35`.
[Card](models/1_34.md).

### `1_35` — JAX learner, fast simulator, stitched streams (26 Sep) { #run-1-35 }

`1_34`'s design on the JAX learner and simulator 0.2.81, trained on stitched 2×20 streams. The best
windowed agent at the time on every measure, with far fewer clearances: the economy criterion was
being optimised, not traded for timing. Stopped at 93% when the laptop throttled. Every later
fine-tune starts from it. [Card](models/1_35.md).

### `1_36`, `1_37` — reselection and its control (26 Sep) { #run-1-36 }

`1_36` may ask for a second clearance per 45 s step; `1_37` is the identical run without it. Solved
streams roughly doubled and AMAN swaps almost vanished, at some cost in safety. The first run on a
rented GPU host. <a id="run-1-37"></a> [Reselection](findings/reselection.md) · [`1_36`](models/1_36.md) ·
[`1_37`](models/1_37.md).

### `1_38`, `1_39` — reselection continued; a bigger penalty (26 Sep) { #run-1-38 }

`1_38` continued `1_36` for 5M steps and removed its safety cost on 20-flight streams: the current
champion. `1_39` did the same with the separation penalty at 240 and lost precision everywhere, with
fewer losses only on stitched streams (not significant); not adopted. <a id="run-1-39"></a> [`1_38`](models/1_38.md) ·
[`1_39`](models/1_39.md).

### Phase 0 — order first? (27 Sep) { #phase-0 }

Not a training run: a test of whether establishing the AMAN order early is a route to solving
streams, on `1_35`, `1_37` and `1_38`. It is not. [Order first?](findings/order-first.md).

### `1_40`–`1_44`, `1_46` — from scratch, and a continuation (27–28 Sep) { #run-1-40 }

The whole design from random weights in 10M steps (`recipes/windowed_from_scratch.sh`): arm A twice
(`1_40`, `1_42`), arm B with flat potentials (`1_41`), arm C with a curriculum ending on stitched
streams (`1_43`), arm D with one ending on 20-flight streams (`1_44`). D is the best from-scratch
20-flight agent and became the recipe default; C is safer on long streams. `1_46` continued `1_43`
for 10M more steps on 20-flight streams. None reaches the champion `1_38`. <a id="run-1-41"></a>
<a id="run-1-42"></a> <a id="run-1-43"></a> <a id="run-1-44"></a> <a id="run-1-46"></a>
[Training from scratch](findings/curriculum.md).

### Long streams (27–28 Sep) { #long-streams }

Not a training run: 60- and 100-flight streams, split into feasible and over-capacity, on the
champion and the from-scratch models. A scorer bug that cut long streams short was found and fixed
along the way. [Long streams](findings/long-streams.md).

## Changes outside the MDP

Tooling and infrastructure bugs that changed what could be seen or trusted:

| what | impact |
|---|---|
| `end_reason/*` logged only when it fired | every series averaged to 1.0; separation rate unreadable in TensorBoard before `c030072` |
| `deepcopy` of the route store failed silently inside the shield | the shield dropped every trombone clearance from `f9ecc24` until `9560f92` |
| run-id generator ignored suffixed directories | `--run-suffix` runs never advanced the counter; `1_27` first launched under a wrong name |
| `Config.USE_GPU` never passed to SB3 | every run used CUDA regardless of the flag |
| snapshots copied a curated file list | once the action modules became facades, a snapshot held no clearance definitions; now whole packages |
| `reset(seed=…)` did not pin the scenario in eval mode | the 10-aircraft scorer was right only by iterating the pool in order |
| observation build spent 42% of its time in `np.clip` on scalars | 1.93× slower than necessary, bit-identical after the fix |
| render: airport marker at the origin, `--seed` not pinning the scenario, blank conflict readout | renders now replay exactly what the scorer played, with the altitude-vs-time side view |
