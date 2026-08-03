# Experiment log

A chronological record of the PPO training runs on branch `UM-lg`, what
changed in each, and what we learned. Runs 1–5 logged to `tb_logs/atc_run_1_N`;
from run `atc_run_1_11` onward each run is a **self-contained directory** under
`experiments/atc_run_1_N/` (TensorBoard + CSV in `tb/`, `checkpoints/`, `best/`, a
`snapshot/` of the source, plus `run_meta.json` and `git_diff.patch` for provenance).
The `atc_run_1_N` suffix increments each launch; the relevant ones are noted per run
(aborted/throwaway launches are skipped).

!!! note "How to read this"
    Each run isolates a small set of changes from the previous one. The **Finding**
    line is the takeaway that motivated the next run.

## Summary

| # | TB run | Steps | Headline change | eval reward | Binding blocker |
|---|--------|-------|-----------------|-------------|-----------------|
| 1 | `atc_run_1_4` | 50k | SB3 baseline (original reward) | −35 → **−20** | acts every step; deviation ≫ conflict; global obs 27% saturated |
| 2 | `atc_run_1_5` | 50k | Reward/obs **redesign** | −176 → **−66** | success gate unsatisfiable; deviation crowded out |
| 3 | `atc_run_1_8` | 500k | **Rebalance** + relaxed gate | −156 → **−60** (plateau ~150k) | deviation stuck; entropy collapse; value_loss huge |
| 4 | `atc_run_1_9` | 500k | Simulator-only deviation + **stability fixes** | −136 → **−51** | deviation **still** stuck; grads saturate clip (`clip_frac`≈1.0) |
| 5 | `atc_run_1_10` | 500k | **`max_grad_norm` 0.5 → 1.5** | −123 → **−45** | `clip_frac` unsaturated ✓; deviation ceiling persists |
| 6 | `atc_run_1_12` | 5M† | **Dense goal bonus** + per-run experiment dirs | −151 → **−33** | **best yet**, but late `approx_kl`→0.22 → regresses; deviation ceiling holds |
| 7 | `atc_run_1_13` | 1M | + **KL control** (LR decay, `n_epochs` 5, `target_kl` 0.03) | −117 → **−37** | KL tamed ✓; peaks @425k then regresses to −60; `all_under_threshold`=0 |
| 8 | `atc_run_1_16` | →7.1M† | **5-tier success** + autoregressive policy + per-scenario horizon + DOF action cost | **50% success peak** (@5.7M), ~30% plateau | worst-aircraft dev → **99 s** (ceiling broken); oscillates, not monotone |
| 9a | `atc_run_1_16_a` | 2→4M | 45 s **control** (Run 8 ckpt @2M continued) | ~40% peak, then drifts | reproduces Run 8 plateau/oscillation |
| 9b | `atc_run_1_16_b` | 2→4M | **½ interval 45→22 s** + warm-restart LR (`--initial-lr 1e-4`) | best per-AC dev (worst 99 s, tier1 0.98) but **regresses to ~0–10%** | 22 s transfer mid-run destabilising; inconclusive |
| 10 | `atc_run_1_17` | 5.1M | **fresh** 22 s run (clean interval test) | −29.3 best | 22 s verdict: **negative**; success 0, worst dev 241 s |
| 11 | `atc_run_1_18`, `atc_run_1_19` | 5.0M, 3.0M | 22 s continued (reward/obs redesign, `e5d64da`) | −35.3 / −29.6 | success still 0; worst dev 259–275 s |
| 12 | `atc_run_1_20`, `atc_run_1_21` | 1.1M, 3.0M | **back to 45 s** + `4×SubprocVecEnv` | −33.9 / −41.8 | `1_21` resumed at a near-flat 3e-5 LR and stalled |
| **13** | **`atc_run_1_22`** | **8M** | **fresh 8M at 45 s, warm-up→cosine LR 3e-4→3e-5** | **+43.8** | **success 1.00 peak / 0.41 sustained; worst dev 24 s — best run to date** |
| 14 | `atc_run_1_23` | 1M (abandoned) | **T6 tier** (±30 s) + action penalty 0.02→0.05 | −24.6 | stopped early; superseded by the point-merge pivot |
| 15 | `atc_run_1_24_pms`, `atc_run_1_24` | 8M, 7.1M | **BGY point-merge (PMS)** — new airspace | −10.0 / −21.6 | success 0.2 / 0.0; worst dev 211 / 158 s |
| 16 | `atc_run_1_25_trombone_relaxed` | 8M *(running)* | **realised-only conflict gate**, 1_22 recipe restored | — | in progress |

† Run 6 targeted 5M but was stopped at ~3.14M. `atc_run_1_11` (the launch that introduced
the goal bonus + experiment-dir scaffolding) aborted at ~2k steps and was relaunched as run 6.
`success_rate = 0` for runs 1–7: no episode ever gets *all* aircraft within the old ±30 s gate.
Run 8 replaces that gate with a 5-tier system; extended in-place to ~7.1M it reaches a **50% success
peak** (~30% plateau) with the worst-aircraft deviation down to ~99 s. Runs 9a/9b spin off its 2M
checkpoint to test the halved 22 s interval against a 45 s control; Runs 10–11 give the 22 s regime
a clean from-scratch trial and it **fails to beat 45 s**, which Run 12 reverts. Run 13
(`atc_run_1_22`) is the breakthrough: the same code as `1_21`, but launched **fresh at 8M with a
warm-up→cosine LR**, reaching the first `success_rate = 1.0` evaluations and a 24 s worst-aircraft
deviation. Runs 14–15 pivot to a new airspace (BGY point-merge) and have not yet matched it.

!!! tip "The conflict side has been solved since Run 3"
    `eval_success/no_near_conflicts_mean` sits at **0.99–1.00 in every run from `1_17`
    onward**. Every failure since has been a **schedule-deviation** failure. See
    [Loss of separation](separation.md#measured-the-predicted-gate-never-bound) for the
    measurement showing the conflict gate has never been the binding constraint.

---

## Run 1 — Baseline (`atc_run_1_4`, 50k) { #run-1 }

First real run after the RLlib → sb3-contrib **MaskablePPO** migration, with the
*original* reward.

**Config:** reward `total = deviation + conflict` only (action penalty & bonus
**excluded**); conflict = flat weight 1.0 within a 6-min lookahead then exponential
decay; deviation from the rollout `MISS_TIMED_LANDING`; `Discrete(220)` action space;
**11** per-aircraft obs features; global features normalized to `[0,1]`; **no** terminal
success.

**Results:** `ep_rew_mean` −60.6 → −25.4; `eval/mean_reward` −35.5 → −19.5 (best) → −22;
value function recovered (EV ≈ 0.74); eval conflict −0.086 → −0.042, eval deviation
−0.62 → −0.50; eval `do_nothing_frac` 0.04 → **0.00**; `global` obs saturation **~27%**.

**Finding:** it learns to roughly halve both delay and conflict, but (a) it intervenes
**every step**, (b) **deviation dominates conflict ~10:1** so safety is under-weighted,
(c) `global` obs are mis-scaled (pinned at the bound 27% of the time), and (d) there is
no terminal/success notion at all.

![Run 1 eval metrics](assets/eval/run_1.png)

---

## Run 2 — Reward/obs redesign (`atc_run_1_5`, 50k) { #run-2 }

Implemented the target-policy design: imminent conflicts must dominate, schedule
deviation is secondary, fewer actions are better.

**Changes vs Run 1:**

- **Conflict:** imminence-dominant ramp `w(ttc)=max(floor, ((T_near−ttc)/T_near)^p)`,
  `weight 1→10`, `T_near=1200 s`, `p=2`, `floor=0.005`; dedup pairs by earliest ttc.
- **Deviation:** rollout deviation weighted linearly by **landing proximity**
  (baseline 0.2 → 1.0 at landing); scale 4000.
- **Action penalty:** `0.5 → 0.02` per command and **included** in `total()`.
- **Terminal success:** all-landed AND each `|dev|≤30 s` AND total `≤ n·30 s` AND
  **no near-conflict ever** + success bonus in `total()`.
- **Obs:** added per-aircraft `time_to_conflict` (**11 → 12** features); global
  renormalized `[0,1] → [-1,1]`; infringement horizon 6 min → full 48-min rollout.

**Results:** `eval/mean_reward` −176 → **−65.9**; eval conflict −2.66 → −1.04
(dominates *and* learns down); eval `do_nothing_frac` 0.16 → **0.52** (fewer actions ✓);
`global` saturation 27% → **17%**; `success_rate = 0`. Sub-criteria: `all_landed → 1.0`,
but `no_near_conflicts = 0` **always**, `frac_under_30s` 0.13 → 0.30, `max_aircraft_dev`
1060 → ~435 s.

**Finding:** imminence-dominant conflict + the "fewer actions" objective worked. But the
**"no near-conflict *ever*" success gate is unsatisfiable** (one near-conflict anywhere
fails it), and the conflict term so dominates that **deviation barely gets optimized**.

![Run 2 eval metrics](assets/eval/run_2.png)

---

## Run 3 — Rebalance + relaxed gate (`atc_run_1_8`, 500k) { #run-3 }

First long run, addressing Run 2's two blockers.

**Changes vs Run 2:**

- `REWARD_SCALE_DEVIATION` **4000 → 2000** (give deviation real gradient).
- `CONFLICT_TIME_EXPONENT` **2 → 3** (cheaper mid-range conflicts so deviation matters
  when conflicts aren't imminent; <5 min still dominates).
- Success near-conflict gate relaxed from "ever" to **"clear for the final 3 steps"**
  (`SUCCESS_NEAR_CONFLICT_CLEAR_STEPS=3`); added `ever_near_conflict` /
  `steps_since_near_conflict` diagnostics.
- `total_timesteps` 50k → **500k**.

**Results:** `eval/mean_reward` −156 → −60 but **plateaus by ~150k**; `no_near_conflicts`
→ **~1.0** (relaxed gate works ✓); `all_landed → 1.0`; conflict −4.2 → −1.3. **But**
`frac_under_30s ≈ 0.2` and `max_aircraft_dev ≈ 500 s` stay **flat**; `success_rate = 0`.
Two pathologies surfaced: **`value_loss` initialises ~7210** (returns reach ±390), and
**entropy collapses** 3.17 → 0.70 with `approx_kl → 0.005` (the SB3 default `ent_coef=0`).

**Finding:** the conflict side is solved (all land, near-conflict gate satisfied), so the
**binding constraint is now schedule deviation — and it's stuck**. The policy converges by
~150k and stops exploring (entropy collapse) → plateau.

![Run 3 eval metrics](assets/eval/run_3.png)

---

## Run 4 — Simulator-only deviation + stability fixes (`atc_run_1_9`, 500k) { #run-4 }

Hygiene pass targeting Run 3's plateau + value-loss + observation consistency.

**Changes vs Run 3:**

- **Removed `compute_dynamic_deviation`**: the observation's schedule deviation now comes
  *only* from the simulator rollout (`MISS_TIMED_LANDING`), matching the reward.
- `ent_coef` **0.0 → 0.01** (combat entropy collapse).
- **`VecNormalize(norm_reward=True)`** around the train env (value targets ~O(1)).
- Added **pre-clip gradient-norm logging** (`instr/grad/*`).

**Results (@120k):** `value_loss` **7210 → ~0.03** (✓ `returns_absmax` 390 → ~3);
entropy retained better (`entropy_norm` 0.72 vs Run 3's 0.59 at the same step), `approx_kl`
~0.04 (actively updating, not frozen). **But** `frac_under_30s ≈ 0.2` and
`max_aircraft_dev ≈ 470 s` are **still flat**, and `eval/mean_reward` hovers ~−65.
New signal: **`grad/clip_frac ≈ 0.95–1.0`** — gradients saturate the `max_grad_norm=0.5`
clip on nearly every update.

**Final (@500k):** `eval/mean_reward` −136 → best **−51** (@385k) → −63; `clip_frac` stayed
pinned at **0.85–1.0** the whole run; `frac_under_30s` peaked 0.30 then drifted to 0.21;
`max_aircraft_dev` floored ~400 s; `success_rate = 0`.

**Finding:** the value/entropy fixes are healthy hygiene but do **not** move the deviation
ceiling — strong evidence the bottleneck is **action granularity + a flat reward gradient
near the goal**, not exploration or value learning.

![Run 4 eval metrics](assets/eval/run_4.png)

---

## Run 5 — Larger grad clip (`atc_run_1_10`, 500k) { #run-5 }

The change staged at the end of Run 4, run on its own to isolate the effect.

**Change vs Run 4:**

- `max_grad_norm` **0.5 → 1.5** (Run 4's gradients were saturating the clip, so every
  update was effectively halved). Nothing else changed.

**Results:** `instr/grad/clip_frac` **0.95–1.0 → 0.15–0.28** (peak 0.28) — gradients no
longer clipped on most updates ✓, and `grad/norm_mean` 1.5 → ~1.0. `eval/mean_reward`
−123 → best **−45** (@350k) → −63, a clear lift over Run 4's −51 best. Conflict side stays
solved (`no_near_conflicts` 0.8 → 1.0, `all_landed` → 1.0). Value learning healthy
(`value_loss` 0.41 → 0.05, `explained_variance` −0.34 → 0.77). **But** the deviation metrics
barely budge: `frac_under_30s` 0.17 → 0.20 (peak 0.31), `max_aircraft_dev` floors ~388 s,
`total_abs_dev` ~1500 s; `success_rate = 0`.

**Finding:** the grad clip *was* a real handbrake — releasing it improved reward by ~6 pts —
but it does **not** break the deviation ceiling. As predicted, this confirms the
[roadmap](roadmap.md) thesis: the bottleneck is **action granularity + a flat reward gradient
near the goal**, not optimisation hygiene. Motivates a reward "carrot" near the goal (Run 6).

![Run 5 eval metrics](assets/eval/run_5.png)

---

## Run 6 — Dense goal bonus + experiment scaffolding (`atc_run_1_12`, 5M → stopped ~3.14M) { #run-6 }

First attempt at the roadmap's "reward peaking" idea, plus a longer horizon. Also the first
run on the new self-contained `experiments/` layout (the launch that introduced it,
`atc_run_1_11`, aborted at ~2k steps and was relaunched as this run).

**Changes vs Run 5:**

- **Dense goal-closeness bonus** (`actions/rewards.py::_goal_bonus`): a positive, saturating
  term `bonus = REWARD_GOAL_BONUS_MAX · exp(−total_abs_dev / REWARD_GOAL_BONUS_SCALE)`
  (`MAX=2.0`, `SCALE=400 s`), added to `total()`. It sharpens the gradient exactly as the
  predicted schedule deviation approaches zero — the only positive term besides the
  (never-firing) full-success bonus.
- `total_timesteps` 500k → **5M** (test whether the plateau is just under-training).
- Per-run experiment directory + source snapshot + git provenance; `n_eval_episodes` 20 → 10.

**Results:** `eval/mean_reward` −151 → best **−33** (@1.25M) — the **best of any run** — then
**regresses to −45** by 3.14M. The goal term behaves as designed: `reward_goal_mean`
0.035 → 0.21 (peak 0.29) as deviation falls. Conflicts solved (`no_near_conflicts` → 1.0,
`all_landed` 0.5 → 1.0). Deviation improves *slightly* past the ceiling — `frac_under_30s`
peak **0.35**, `max_aircraft_dev` floor **367 s**, `total_abs_dev` floor **1433 s** — the best
deviation numbers so far, but still far from "all within ±30 s" (`success_rate = 0`). The
regression has a clear cause: **`approx_kl` climbs 0.015 → 0.11 (peak 0.22)** and
`clip_fraction` 0.17 → 0.39 (peak 0.47) — the policy drifts too far per update in late
training and degrades after its peak.

**Finding:** the goal bonus + more steps give the best reward and the best deviation yet, so
the carrot helps — but **long-horizon training is unstable**: KL/clip blow up after ~1.25M and
the policy regresses. Need to cap policy drift before pushing the horizon further.

![Run 6 eval metrics](assets/eval/run_6.png)

---

## Run 7 — KL control (`atc_run_1_13`, 1M) { #run-7 }

Targets Run 6's late-training instability with three standard PPO drift controls.

**Changes vs Run 6:**

- **LR linear decay** `3e-4 → 3e-5` over training (`main.py::linear_schedule`) — smaller steps
  late, when KL was rising.
- `n_epochs` **10 → 5** — fewer passes over each rollout ⇒ less policy drift per update.
- `target_kl = 0.03` — hard early-stop of the update once `approx_kl` exceeds it.
- `total_timesteps` 5M → **1M** (KL controls vetted at a shorter horizon first).

**Results:** the KL controls **work** — `approx_kl` peaks 0.117 early then settles to **0.002**
(vs Run 6's 0.22), `clip_fraction` 0.15 → **0.016** (vs 0.39). Value learning fine
(`value_loss` → 0.06, `explained_variance` → 0.74). **But** the eval curve still **peaks early
and regresses**: `eval/mean_reward` −117 → best **−37** (@425k) → **−60** by 1M — a worse peak
than Run 6's −33, and the same post-peak decline despite the tamed KL. Deviation ceiling
unbroken: `frac_under_30s` peak 0.30, `max_aircraft_dev` floor **361 s**; crucially
**`all_under_threshold = 0` for the entire run** — no eval episode ever gets *every* aircraft
within ±30 s, which is exactly why `success_rate` stays 0.

**Finding:** capping KL removes the *instability mechanism* but not the regression or the
deviation ceiling — and the aggressive LR decay may itself cap late improvement (best at 425k,
then nothing). Tellingly, `all_under_threshold = 0` everywhere: the success gate is now bound
**purely** by per-aircraft deviation, not conflicts or optimisation. Across Runs 5–7 the
deviation floor (`frac_under_30s ≈ 0.3`, worst aircraft ≈ 360–390 s) is essentially fixed —
strong, repeated evidence that the dense bonus and tuning have hit their limit and the next
lever must be **action granularity** (finer/continuous control) per the [roadmap](roadmap.md).

![Run 7 eval metrics](assets/eval/run_7.png)

---

## Run 8 — 5-tier success + autoregressive policy (`atc_run_1_16`, 1.91M†) { #run-8 }

Bundles four simultaneous changes motivated by the Runs 5–7 deviation ceiling, plus the
switch to finer-grained action control.

† Interrupted at 1.91 M / 2.0 M steps. Resume/spinoff in progress; see [training docs](training.md#resume-lr-schedule).

**Changes vs Run 7:**

- **5-tier graduated success bonus** — replaces the all-or-nothing ±5.0 terminal. All tiers
  require the relaxed near-conflict gate (conflicts clear for ≥ 3 final steps):
    - *Tier 1* (+1.5): ≥ 50% of aircraft within ±120 s.
    - *Tier 2* (+3.0): ≥ 80% within ±100 s.
    - *Tier 3* (+6.0): ≥ 80% within ±70 s **and** `max_aircraft_dev` < 200 s.
    - *Tier 4* (+9.0): ≥ 80% within ±60 s **and** `max_aircraft_dev` < 120 s.
    - *Tier 5* (+13.0): all landed **and** every aircraft within ±60 s ("solved").
  Tiers 3 and 4 add an explicit `max_dev` cap to provide terminal gradient signal for the
  worst-case aircraft — the binding constraint observed in Runs 1–7. A hard violation applies
  `−15.0` (`REWARD_VIOLATION_PENALTY` > T5 bonus) and suppresses any tier. Highest tier wins; no stacking.
- **Extended goal bonus** — `_goal_bonus` now includes both `exp(−total_dev/400)` and
  `exp(−max_dev/200)`, so the per-step dense signal also targets the worst aircraft.
- **Autoregressive policy** (`ATCAutoregressivePolicy`) on vanilla `PPO` — aircraft head →
  clearance head conditioned on the sampled aircraft index. Finer `MultiDiscrete([10, 22])`
  action space vs the old flat `Discrete(220)`. `Config.USE_AUTOREGRESSIVE_ACTIONS = True`.
- **Per-scenario episode horizon** (`Config.USE_PER_SCENARIO_HORIZON = True`) — each episode
  is sized to the scenario's latest arrival ETA + margin rather than a fixed 64-step cap,
  preventing the structural timeouts that affected all eval seeds.
- **DOF action cost** (`REWARD_ACTION_DOF_K = 3.0`) — acting late (few remaining waypoints)
  costs more than acting early, discouraging last-moment interventions.

**Results (extended in-place to ~7.1 M steps):** `success_rate` rises from **0% → ~30%** between
1 M and 2 M and, with continued training, reaches a **best of 50%** (@5.7 M), averaging ~30% over the
last 1 M — the first non-zero success rate across all runs and a clear validation of the tiered
approach. Critically, the **deviation ceiling is broken**: the worst-aircraft deviation falls to
**~99 s** (@6.4 M) and total absolute deviation to **~305 s**, versus the ~360–390 s worst-aircraft /
~1430 s total floor that held across Runs 1–7; tier-1/tier-2 fractions reach **0.98 / 0.96**. The
conflict side stays solved (`all_landed` and `no_near_conflicts` ≈ 1.0). Training is **not monotone**,
though — `success_rate` oscillates ~0.2–0.5 rather than climbing steadily.

**Finding:** the tiered terminal bonus breaks **both** the 0%-success *and* the deviation ceiling —
the `max_dev` caps at Tiers 3–4 give the agent explicit terminal feedback about the worst-case
aircraft, not just the mean. What remains is **stability**: past ~3 M the policy oscillates instead
of converging. This motivates the finer-temporal-control experiment (Run 9) and a clean longer
run (Run 10).

![Run 8 eval metrics](assets/eval/run_8.png)

---

## Run 9 — Finer temporal control: 22 s interval (`atc_run_1_16_a` 45 s control vs `atc_run_1_16_b` 22 s) { #run-9 }

**Motivation.** On the hardest scenarios the binding limitation is **structural to the action
interface**: only **one aircraft can be commanded per env step**. At a 45 s interval the agent
runs out of decision points to issue all the clearances needed to interleave control across several
converging aircraft, so it cannot both resolve conflicts *and* trim every landing time. Rather than
widen the per-step choice to multiple aircraft, this run attacks the orthogonal **temporal**
granularity — the agent simply gets to act more often. (Item 1 on the [roadmap](roadmap.md), by
contrast, attacks action *magnitude* granularity.)

**Design (A/B from one checkpoint).** Both arms spin off Run 8's **2 M checkpoint** and add ~2 M
steps (→4 M), differing only in the simulation interval:

- **`atc_run_1_16_a` — 45 s control:** continues unchanged (resume from the checkpoint LR).
- **`atc_run_1_16_b` — 22 s:** `TIME_BETWEEN_ACTIONS` 45 → 22 s with every step-count duration
  doubled in tandem (`EPISODE_STEPS` 64→128, `MAX_EPISODE_STEPS` 130→260,
  `SCENARIO_INITIAL_CONFLICT_FREE_STEPS` 6→12, `SUCCESS_NEAR_CONFLICT_CLEAR_STEPS` 3→6, …) so
  wall-clock semantics are preserved. Warm-restarted with `--initial-lr 1e-4` (decaying to 1e-5).

**Results (2 M → 4 M):**

| Metric (best over the run) | 45 s control (`16_a`) | 22 s (`16_b`) |
|---|---|---|
| `success_rate` | **0.40** @2.7 M | 0.30 @2.1 M |
| worst-aircraft dev | 113 s @2.9 M | **99 s** @3.8 M |
| total abs dev | 363 s | **333 s** |
| frac ≤ tier1 / tier2 | 0.95 / 0.91 | **0.98 / 0.94** |
| `success_rate` (final, oscillating) | ~0.3 | **~0.0–0.1 (collapsed)** |

The 22 s arm **transiently reaches the best per-aircraft deviation numbers of any run** (worst
aircraft 99 s, tier-1 0.98) — weak evidence that the extra decision points help the tail aircraft.
But it is also **less stable**: re-entering a 45 s-trained policy into the 22 s regime (with the LR
warm restart) is disruptive, and `16_b` regresses *harder* than the 45 s control — late
`success_rate` collapses to ~0–10 %, `tier_mean` drifts to 1.5–2.5, and total deviation climbs to
600–870 s. The 45 s control just reproduces Run 8's plateau/oscillation (~40 % peak, then drift).

**Finding: inconclusive, leaning negative for the warm-restart path.** Transferring a 45 s-trained
policy into 22 s mid-run conflates a regime change with the interval benefit and destabilises
training. The per-aircraft deviation gain is real but did not hold. The interval change needs a
**clean from-scratch test** before any verdict — see Run 10.

---

## Run 10 — Fresh 22 s run (`atc_run_1_17`, 5.1 M) { #run-10 }

The clean from-scratch test of the 22 s interval that Run 9 called for — no warm restart, no
regime transfer, 5 M-step target. The doubled per-episode env-steps made it the most
compute-heavy run to that point.

**Results:** `eval/mean_reward` best **−29.3**. Conflict side solved as always
(`no_near_conflicts` = 1.00 throughout). But the deviation numbers land squarely in the
Runs 5–7 band: `max_aircraft_dev` floor **241 s**, `total_abs_dev` floor **956 s**,
`tier_mean` peak **1.5**, and **`success_rate = 0` for the entire run**.

**Finding: the 22 s verdict is negative.** Given a clean run, halving the action interval does
**not** reproduce Run 9b's transient per-aircraft gains, and does not approach Run 8's 45 s
results (worst dev ~99 s, 30–50 % success). More decision points are not the missing lever;
the extra steps mostly dilute the per-step credit assignment. Temporal granularity is closed
as a line of attack — action *magnitude* granularity (roadmap item 1) remains open.

---

## Run 11 — 22 s continued (`atc_run_1_18` 5 M, `atc_run_1_19` 3 M) { #run-11 }

Two further 22 s runs on the `e5d64da` reward/obs redesign, both resumed and extended in place,
to confirm Run 10 was not a single unlucky seed.

**Results:** `atc_run_1_18` — best reward **−35.3**, worst dev floor **275 s**, `tier_mean`
peak 1.7, success 0. `atc_run_1_19` — best reward **−29.6**, worst dev floor **259 s**,
`tier_mean` peak 1.6, success 0.

**Finding:** confirms Run 10. Three independent 22 s runs all floor at 240–275 s worst-aircraft
deviation with zero successes, versus 45 s runs reaching 99 s and 30–50 % success. The interval
change is reverted from here on.

---

## Run 12 — Back to 45 s + parallel envs (`atc_run_1_20` 1.1 M, `atc_run_1_21` 3 M) { #run-12 }

Reverts `TIME_BETWEEN_ACTIONS` to **45 s** and lands the `9812215` parallelism work
(`4 × SubprocVecEnv`, rollout buffer `4 × 1024 = 4096`, plus the per-env metrics-callback fix).

**Results:** `atc_run_1_20` — 1.14 M steps, best reward −33.9, worst dev 334 s, success 0.
`atc_run_1_21` — resumed from its own 3 M checkpoint at a **starting LR of 3.02e-5** decaying to
3e-5, i.e. effectively flat and ~10× below peak; best reward −41.8, `tier_mean` peak 1.0,
worst dev 354 s, success 0. It reached only 3.0 M of its 8 M target.

**Finding:** neither run is a fair read on 45 s. `1_20` was stopped early and `1_21` was
resumed onto a near-flat, near-minimum LR schedule — there was no headroom left to learn
anything. The lesson is about **LR scheduling on resume**, not about the interval: a resume
that inherits an end-of-schedule LR cannot make progress. This directly motivates Run 13.

---

## Run 13 — Fresh 8 M with warm-up→cosine LR (`atc_run_1_22`, 8 M) — **breakthrough** { #run-13 }

!!! success "Best run to date"
    The first run ever to reach `success_rate = 1.0` on an evaluation pass, and the first to
    push worst-aircraft deviation below the ±30 s target.

**Changes vs Run 12:** *none in the code.* `atc_run_1_21` and `atc_run_1_22` are
**byte-identical** across `config.py`, `rewards.py`, `single_agent_env.py`, `observations.py`,
`rlm.py` and `main.py`. The only differences are how it was launched:

- **Fresh run**, not a resume — so the LR schedule starts from scratch.
- **Warm-up → cosine LR**: ramp `0 → 3e-4` over the first `--warmup-frac 0.04` of training,
  then half-period cosine `3e-4 → 3e-5` over the remainder.
- **8 M steps**, and it actually completed them (`1_21` stalled at 3 M of 8 M).

**Results:**

| Metric | Best | Sustained (last 15 % of evals) | Final |
|---|---|---|---|
| `success_rate` | **1.00** | 0.41 | 0.00 |
| `tier_mean` | **5.00** | 3.60 | 2.60 |
| `max_aircraft_dev` | **24.3 s** | 172 s | 281 s |
| `total_abs_dev` | **65.8 s** | — | 761 s |
| `eval/mean_reward` | **+43.8** | — | −59.9 |

The worst-aircraft deviation of **24.3 s** finally clears the ±30 s bar that had been
unreachable since Run 1, and `eval/mean_reward` goes **positive** for the first time
(+43.8 vs the previous best of −33).

**Finding:** the deviation ceiling was never a reward-design problem or an action-interface
problem — it was a **learning-rate-schedule and horizon** problem. A fresh warm-up→cosine
schedule over a full 8 M steps at 45 s gets there with the *same code* that scored `tier_mean`
1.0 when resumed onto a flat 3e-5 LR. **But the oscillation from Run 8 persists and is now the
dominant issue**: `success_rate` swings between 0.0 and 1.0 across evaluation passes rather
than converging, and the run ends on a trough. Peak performance is solved; *stability* is not.

---

## Run 14 — T6 tier + higher action cost (`atc_run_1_23`, 1 M of 8 M, abandoned) { #run-14 }

Tightens the ladder now that Run 13 showed ±30 s is physically reachable.

**Changes vs Run 13:**

- **New Tier 6** — all landed **and** every aircraft within **±30 s**, which becomes the binary
  `success` flag. The bonus ladder shifts up one slot (T6 takes the old T5 payout of +13.0;
  T1–T5 drop to 0.75 / 1.5 / 3.0 / 6.0 / 9.0) so the top payout still lands on true success.
- `REWARD_ACTION_PENALTY_WEIGHT` **0.02 → 0.05**, with per-action multipliers
  (`DO_NOTHING` 0.001 up to 1.6 for the harder manoeuvres), to curb over-commanding once
  `DO_NOTHING` had been made nearly free.
- DOF factor normalised against each aircraft's **own route length** instead of the global
  `MAX_WAYPOINTS` cap, so acting early is genuinely cheap.

**Results:** stopped at **1 M of 8 M**. Best reward −24.6, `tier_mean` peak 1.6, worst dev
floor 265 s, `success_rate` 0, `all_under_tier6` 0.

**Finding:** too short to judge — 1 M steps is well inside the warm-up phase for an 8 M cosine
schedule, and Run 13 did not reach its own peak until much later. Not evidence against T6.
Abandoned in favour of the point-merge pivot rather than for any result it produced.

!!! warning "Tier numbers are not comparable across the T5/T6 boundary"
    Runs ≤ `1_22` use the 5-tier ladder where **T5 = success**. Runs `1_23`, `1_24` and
    `1_24_pms` use the 6-tier ladder where **T6 = success** and every lower rung was
    re-valued. A `tier_mean` of 2.2 under the 6-tier ladder is *not* worse than 2.6 under
    the 5-tier one — they measure different things.

---

## Run 15 — Point-merge pivot: BGY (`atc_run_1_24_pms` 8 M, `atc_run_1_24` 7.1 M) { #run-15 }

The first runs on a **completely new airspace**: Bergamo (BGY) with a **point-merge system**
instead of MXP's trombone. `DEFAULT_TRAINING_DIFFICULTY` / `DEFAULT_EVALUATION_DIFFICULTY`
switch to `VALIDATION_USE_CASE_2`. Both runs carry Run 14's T6 ladder and action costs.

**Pre-flight sanity check.** `analysis/pms_mdp_sanity.py` verified the new MDP is well-posed
before any training: aircraft radius 57 nm against the ±150 nm observation extent (more compact
than MXP's 117 nm), **0 % off-map**, **0 NaN/Inf**, `observation_space.contains` **100 % over
529 steps**, and saturation at or below MXP everywhere (global 7 % vs 16 %). Conclusion: no
observation-normalisation retuning needed; `VecNormalize` adapts online from a fresh start.

**`atc_run_1_24_pms`** — the first-ever BGY point-merge run. Launched 2026-07-27 for 8 M steps,
interrupted at ~1.27 M when its parent CLI session died, resumed 2026-07-28 from
`ppo_tada_1270000_steps.zip` (detached), and later resumed again from 5.25 M. LR on the final
resume: linear **1.38e-4 → 1e-5**. Completed 8.0 M.

**`atc_run_1_24`** — a fresh 10 M-step point-merge run launched 2026-07-30 with a much more
aggressive schedule (`warmup_frac` 0.01, `lr_min` **3e-6**). Reached 7.12 M.

**Results:**

| Metric | `atc_run_1_24_pms` | `atc_run_1_24` |
|---|---|---|
| Steps | 8.0 M / 8 M | 7.12 M / 10 M |
| `eval/mean_reward` best | **−10.0** | −21.6 |
| `success_rate` best | **0.20** | 0.00 |
| `tier_mean` best | **2.20** | 2.00 |
| `all_under_tier6` best | 0.20 | 0.00 |
| `max_aircraft_dev` floor | 211 s | **158 s** |
| `total_abs_dev` floor | 751 s | **659 s** |
| `no_near_conflicts_mean` | 1.00 | 1.00 |

**Finding:** point-merge is **learnable but not yet solved**. The conflict side is clean from the
start (`no_near_conflicts` = 1.00 throughout, exactly as on the trombone), and deviation improves
steadily — but neither run approaches Run 13's trombone numbers. The shape is the same as the
early MXP runs: *conflicts free, deviation wide open*. `1_24_pms` reaches a better reward and the
only non-zero success; `1_24`'s more aggressive LR floor gets the better raw deviation but never
converts it into a tier-6 episode.

Both runs suffered launch fragility — `1_24_pms` died with its parent CLI session on the first
attempt. **All long runs are now launched under `setsid nohup`.**

---

## Run 16 — Realised-only conflict gate (`atc_run_1_25_trombone_relaxed`, 8 M) — *in progress* { #run-16 }

Returns to the **MXP trombone** to test one change against Run 13's breakthrough, with
everything else restored to Run 13's exact code state.

**Motivation.** A team review of what `LOSS_OF_SEPARATION` actually means concluded that a
severity-≥-threshold conflict should count **only if it actually materialises** — both aircraft
inside 3 NM at a real timestep — rather than being inferred from the NOOP-rollout forecast.
See [Loss of separation](separation.md) for the full semantics.

**Changes vs Run 13:**

- **`Config.SUCCESS_CONFLICT_REALISED_ONLY = True`** — the tier gate now reads
  `_episode_violations()` (live world, severity ≥ 0.7) instead of
  `_steps_since_near_conflict >= 3` (NOOP forecast).
- New `no_near_conflicts_predicted` metric logs the legacy gate alongside the new one, so both
  regimes are measurable on identical episodes.
- Everything else — `config.py`, `rewards.py`, `single_agent_env.py`, `observations.py`,
  `rlm.py`, `autoregressive_policy.py`, the callbacks — restored **byte-identical** to Run 13's
  snapshot. That means back to the **5-tier** ladder, `REWARD_ACTION_PENALTY_WEIGHT = 0.02`,
  the `MAX_WAYPOINTS`-based DOF factor, and `VALIDATION_USE_CASE_1`. Only `main.py` is kept at
  the newer revision (corrupt-checkpoint detection and `--run-suffix`; no hyperparameter
  changes).

**Launch:** fresh 8 M at 45 s, `lr_max 3e-4 → lr_min 3e-5`, `warmup_frac 0.04`, `vf_coef 0.25`,
`target_kl 0.05` — identical to Run 13.

!!! warning "Expected to tighten the flag, not relax it"
    Instrumenting both gates on Run 13's own checkpoints showed the predicted gate was open in
    **every episode at every checkpoint** (0 relaxations in 95 episode-evaluations). The change
    is a **semantics correction**, not a loosening: `success` can no longer be reported `True`
    on an episode that actually busted 3 NM. Reported success rate should fall slightly and
    become trustworthy. Full measurement in
    [Loss of separation](separation.md#measured-the-predicted-gate-never-bound).
