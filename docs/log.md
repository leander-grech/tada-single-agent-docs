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

### `1_47`, `1_48` — fine-tuning for the hard-solved target (28 Sep) { #run-1-47 }

`1_44` and `1_46` continued for 10M steps with a ±30 s bracket worth 4 added above the ±60 s one,
on stitched 2×20 streams, on a rented host. Neither gained hard-solved streams significantly over
its parent. `1_48` ties the champion on hard-solved streams and on the feasible 40-flight set
(feas40), but solves fewer 20-flight streams at ±60 s; `1_38` stays champion. <a id="run-1-48"></a> [`1_47`](models/1_47.md) · [`1_48`](models/1_48.md).

### `1_49`–`1_51` — the release MDP (28 Sep, training) { #run-1-49 }

A changed MDP: after each step a flight at the front of the landing queue that is locked (predicted
within 30 s of its target, in no predicted conflict) is released from the window and can no longer
be cleared; its bracket is paid at release, the deviation potential is flat, and training streams are
feasible only. `1_49` fine-tunes `1_48` in it; `1_50` trains recipe arm D from scratch in it. Both
are scored in their own environment. `1_49` was stopped at 1.3M steps because redrawing infeasible
training streams at reset slowed training to about 300 steps/s; it restarted as `1_51`, drawing from
a pool of feasible streams screened up front. `1_50` (from scratch) reached 51 solved and 26
hard-solved, level with the champion on hard-solved but with 20 losses of separation; `1_51`
(fine-tuned) fell from `1_48`'s 48 solved to 27. Both trained before a reward fix: a bust now takes
back the release payments of flights still airborne. [Training from scratch](findings/curriculum.md#arm-d-in-the-release-mdp-1_50). <a id="run-1-50"></a> <a id="run-1-51"></a>
[`1_49`](models/1_49.md) · [`1_50`](models/1_50.md) · [`1_51`](models/1_51.md).

### `1_52`, `1_53` — training on point merge (28 Sep) { #run-1-52 }

The MXP agents lose separation on a quarter to a third of point-merge streams zero-shot
([Point merge](findings/point-merge.md)), so these two train on the BGY point merge itself, in the
release MDP with the bust clawback, from pre-screened pools of feasible point-merge streams.
`1_52` fine-tunes `1_50`; `1_53` runs recipe arm D from scratch. Their scores are point-merge
scores. Both lose separation almost only on over-capacity point-merge seeds (52 of the 100):
on the 48 feasible seeds `1_53` loses none, `1_52` one. Few streams are solved (12 and 8), and on
stitched point-merge streams both lose most. <a id="run-1-53"></a> [`1_52`](models/1_52.md) · [`1_53`](models/1_53.md).

### Long streams (27–28 Sep) { #long-streams }

Not a training run: 60- and 100-flight streams, split into feasible and over-capacity, on the
champion and the from-scratch models. A scorer bug that cut long streams short was found and fixed
along the way. [Long streams](findings/long-streams.md).

### 7–8 Oct — the paper campaign: feasible pools, the mask fix, fine-tune stages { #oct-7 }

Both procedures, procedure-specific clearance sets (TMB = MXP trombone, set v2; PMS = BGY canonical point
merge, set v2pms), the release MDP and the ±30 s bracket throughout. Deterministic scores on the 100
validation seeds (solved / losses of separation); the full tables are in the code repo's
`analysis/2026-10-07_curriculum/report/`, and every lineage is on the [progress board](progress.md).

- <a id="run-1-54"></a><a id="run-1-55"></a><a id="run-1-56"></a><a id="run-1-57"></a><a id="run-1-58"></a><a id="run-1-59"></a><a id="run-1-60"></a>**`1_54`–`1_60` (7 Oct): feasible pools and a difficulty curriculum.** Training only on streams with no
  flight more than 900 s off, easiest streams first (four tiers by entry-order inversions and worst
  deviation). TMB: curriculum `1_54` 47 / 18 against the control `1_55` 40 / 14; with the MONAD airport
  mask `1_58` 56 / 17. PMS: `1_56` 15 / 14, control `1_57` 10 / 12.
- **The mask-frame bug** ([Actions](how/actions.md)): turn, skip and vector-to-ILS legality mixed
  the translated waypoints with the untranslated aircraft position. Fixed behind `TADA_MASK_FRAME_FIX`
  (on for new runs).
- <a id="run-1-61"></a><a id="run-1-62"></a><a id="run-1-63"></a><a id="run-1-64"></a><a id="run-1-65"></a><a id="run-1-66"></a><a id="run-1-67"></a>**`1_61`–`1_67` (8 Oct): the best recipes with the fix, three seeds each.** TMB 44.7 ± 4.0 solved
  (`1_61`, `1_63`, `1_65`), PMS 26.3 ± 3.2 (`1_62`, `1_67`, `1_66`; `1_64` crashed at a thread limit).
- <a id="run-1-68"></a><a id="run-1-69"></a><a id="run-1-70"></a><a id="run-1-71"></a><a id="run-1-72"></a><a id="run-1-73"></a><a id="run-1-74"></a><a id="run-1-75"></a>**`1_68`–`1_75` (8 Oct, batch 2).** Removing the ±30 s bracket (`1_68`/`1_70`, `1_69`/`1_71`) and a third
  pick per step (`1_72`, `1_73`) did not help. A low-LR, low-entropy fine-tune did: `1_74` = `1_65` + 5M
  at LR 3e-5 → 3e-6, entropy 0.003: 54 / 13; `1_75` = `1_67` + 5M: 38 / 9.
- <a id="run-1-76"></a><a id="run-1-77"></a><a id="run-1-78"></a><a id="run-1-79"></a>**`1_76`–`1_79` (8 Oct): stage 3**, LR 1e-5 → 1e-6, entropy 0.001, on all streams (`1_76` TMB 59 / 10,
  `1_77` PMS 41 / 9) or feasible streams only (`1_78` 60 / 13, `1_79` 38 / 11).
- **Rollout search** on the stage-3 models: TMB 88 / 2, PMS 54 / 0 ([Search at inference](findings/lookahead.md#rollout-search)).

### 9 Oct — capacity v2, search distillation, a faulty GPU host { #oct-9 }

- **Procedure capacity revised.** The 7 Oct per-flight estimate was a weak greedy, not a bound.
  The revised one puts every seed ever solved inside the feasible set: TMB 100/100, PMS 67/100.
  [Over-capacity scenarios](findings/capacity.md#procedure-capacity).
- <a id="run-1-82"></a>**Search distillation.** The rollout search was cloned into the policy (`1_80`–`1_88`, `1_100`).
  TMB gains +3 to +5 solved streams per 100 (`1_82`: test 61 vs 59, validation 64 vs 59); point merge
  gains nothing. [Search distillation](training/distillation.md).
- **Fresh seed sets.** 100 test seeds and 300 dev seeds, disjoint from validation and from every pool
  ([Evaluation](evaluation.md)). On the test seeds (solved / LoS): `1_82` 61 / 15, `1_76` 59 / 14,
  `1_101` 53 / 13, `1_78` 51 / 17, **`1_38` 46 / 12** (63 / 3 on validation, where it was selected);
  PMS `1_77` 32 / 11, `1_75` 29 / 13, `1_79` 27 / 12. Non-learning baselines on validation (solved / LoS / on time):
  random TMB 0 / 100 / 9%, greedy rule TMB 2 / 74 / 50%, random PMS 0 / 99 / 3%, greedy PMS 0 / 76 / 37%.
- **Turn legality was mirrored** in every model; `TADA_TURN_MASK_FIX` corrects it, off by default
  ([Actions](how/actions.md)).
- **Void runs `1_90`–`1_99`.** The replications of the fine-tune chain (`1_90`–`1_93`, `1_96`–`1_99`) and
  the turn-fix fine-tunes (`1_94`, `1_95`) were trained on a rented host with a CMP 170HX mining GPU.
  Its JAX numerics were inconsistent: PPO's approx-KL was already 0.007–0.18 before any update
  (other hosts: about 1e-9), so every update used corrupted probability ratios, and several runs
  collapsed. Search data and scoring there ran in torch on the CPU and are unaffected. Check the
  critic warm-up's approx-KL (≈ 0) in the first log lines before trusting a new host.
- <a id="run-1-101"></a>**Turn fix, re-run cleanly (`1_101`, laptop).** `1_76` + 5M with corrected turn legality: validation
  66 vs 59, test 53 vs 59, 119 vs 118 over both seed sets, the same safety. No measurable effect.

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
