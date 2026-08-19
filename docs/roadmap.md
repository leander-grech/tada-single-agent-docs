# Roadmap

!!! abstract "TL;DR"
    The deviation ceiling **broke** in run 1_26 — see the [experiment log](experiments.md#recent-runs).
    Run 1_27's reduced clearance set **did not build on it**, and the run that would settle why
    has not been done. What remains splits cleanly: about two-thirds of residual failures are a
    *precision* problem, one-third *reliability*, and there is a queue of designed-but-unbuilt
    observation fixes.

    **Done since:** the learning-rate confound on run 1_27 was removed by re-running its second
    half on the correct cosine (`1_27a`). It changed nothing — same 0.64 success, and no
    deviation gain at all among clean episodes. The reduced clearance set's disadvantage is a
    property of the action set. See [the corrected run](analysis_v1_v2.md#corrected-run).

    **Top of the list now:** make `SHORTEN_TROMBONE` worth learning. Two runs on two schedules
    both issue it about once per thousand clearances, so the capability exists and the incentive
    does not. [Potential-based advice](pbrs.md#fix-advice) is the principled mechanism for that,
    and it also removes a policy-distorting action cost on the way.

    **Ruled out:** a bigger network. Measured, the encoder uses ~14% of its width and the context
    ~4% — [see the test log](analysis_log.md#t-embedding-capacity). The productive change is
    shape, not size.

## Where the frontier actually is

Measured, not inferred — from `analysis/attempts_to_solve.py` over all 100 eval seeds:

- Deterministic **0.63**, pass@1 **0.56**, pass@20 **0.82**. The gap from the single-shot rate
  to the asymptote — **0.26** — is **reliability**, recoverable at inference by best-of-n, a
  shield, or a lower sampling temperature, with no retraining at all. This is the cheapest win
  available.
- Of the 18 never solved in 20 attempts: **12 precision-bound** (under 20% of attempts bust,
  tier 4 on 73% of attempts, tier 5 never) and **6 safety-bound** (four bust on 100% of
  attempts, the others on 95% and 70%). Classification rule and seed lists on the
  [test log](analysis_log.md#t-attempts-1_26).

Those need opposite fixes, which is why a plain success rate was never going to tell us what
to build next.

## Designed, not built

Each has a worked-out design and measurements behind it.

| item | why | evidence |
|---|---|---|
| **Drop or replace `global.time_s`** | It normalises against a 2880 s fallback horizon while episodes run 3105–5715 s, so it is pinned at +1 for the last ~23% of every episode | `timeout` fires in **zero** of 800 scored episodes, so the deadline it encodes never arrives |
| **Δt-stamped action history** | History rows carry no time and per-aircraft buffers are mutually unaligned | the `step` field already exists in `_action_history` and is discarded at the observation boundary. **Now also measured:** the history GRU spans 4.5 of 64 effective directions — [test log](analysis_log.md#t-embedding-capacity) |
| **Pairwise aircraft interaction** | The context is a masked *mean* over aircraft, which cannot represent "*i* and *j* are converging" — the core relation in a separation problem | context effective rank 3–4% of 256; mean cosine between aircraft embeddings 0.70. One self-attention block over the ten slots, same parameter budget |
| **Continuous tier potential** | Φ moves only when an aircraft crosses a band edge, because it depends on *counts* of aircraft; between crossings the shaping is ~zero | [PBRS](pbrs.md#diagnosis) |
| **Action cost as potential-based advice** | The action cost is not potential-based, so it changes which policy is optimal | [PBRS](pbrs.md#fix-advice); Harutyunyan et al. (2015) |
| **`time_to_conflict` should match the reward** | Observable ramps linearly over 20 min; the [conflict penalty](reward.md#conflict-penalty) decays exponentially with a 4-min half-life | at 240 s out the reward has halved while the observable still reads 0.80 |
| **Action cost waived under urgency** | Scale the cost by `(1 − urgency)` rather than switching on a conflict flag | a binary switch is exploitable — hovering a pair at 4.9 NM costs ~0.025/step and would waive up to 0.30; the continuous form is self-policing at ~33:1 |
| **Finer clearance magnitudes (CD2)** | The 12 precision-bound seeds reach tier 4 and cannot cross it | **tested and did not deliver.** v2's MEDIUM steps and `SHORTEN_TROMBONE` left worst-aircraft deviation at 87 s against 1_26's 43 s — [the head-to-head](analysis_v1_v2.md#head-to-head) |

## Tried and abandoned

- **NOOP rollout horizon cut** — built, measured **0.96×**, reverted. The rollout stops once
  every aircraft lands, so the requested step count is a cap that never binds; cost tracks
  airborne aircraft. It remains **71% of an env step** and is unaddressed. Cutting it means
  computing deviation less often, which is a behavioural change needing its own experiment.
- **Multi-select CHOOSE/STEP head** — deprioritised: the precision-bound seeds never lose
  separation, so intra-step coordination is not their problem.

## Never run

- **The `USE_LOG_DEVIATION_OBS = False` ablation.** Run 1_26 shipped three changes together,
  so its result attributes to the bundle and not to a part. The flag exists to make this cheap.
- [x] ~~**A clean v2 re-run**~~ — **done** as `1_27a` (18 Aug): resumed from `1_27`'s own
  4.98M checkpoint on the correct cosine. The confound accounted for a quarter of the deviation
  gap on paper and none of it among clean episodes.
- **`cd4_reachability_probe.py` / `cd4_granularity_probe.py`** — would answer the reachability
  question directly rather than by inference. Still hardcode v1 action names, so they need a
  small fix before they run under v2.
- **PMS transfer.** More attractive than it was: point-merge's known blocker was the
  observation norms, which is exactly what the log-scaling fixed
  (`time_to_target` saturation 71.4% → 15.1% on PMS).

---

## Historical (pre-1_26)

## Done since

- [x] **Larger gradient clip** — `max_grad_norm` 0.5 → 1.5. Shipped in **Run 5**
  (`atc_run_1_10`): `clip_frac` dropped 1.0 → ~0.2 and reward improved (−51 → −45 best), but
  the deviation ceiling held.
- [x] **Dense goal "carrot"** (a flat, non-potential version of item 2 below) —
  `MAX·exp(−total_abs_dev/SCALE)`. Shipped in **Runs 6–7**: best reward yet (−33) and the best
  deviation numbers (`frac_under_30s` 0.35, worst aircraft 367 s), but still no full success.
- [x] **KL control** — LR decay `3e-4→3e-5`, `n_epochs` 5, `target_kl` 0.03 (**Run 7**) fixed
  Run 6's late-training KL blow-up (`approx_kl` 0.22 → 0.002) but didn't lift the ceiling.
- [x] **5-tier success + autoregressive policy + per-scenario horizon** — Run 8 (`atc_run_1_16`):
  the graduated terminal ladder (replacing the all-or-nothing ±30 s gate) gave the first non-zero
  success (**0 → ~30%**, peak **50%** by ~7 M) and **broke the deviation ceiling** — worst-aircraft
  deviation 360–390 s → **~99 s**. Remaining issue: training oscillates past ~3 M rather than
  converging.

## In flight

- [x] **Reduced clearance set (v2, 15 actions)** — Run 1_27, complete at 10M on 12 Aug. Success
  0.64 against 1_26's 0.70 (a tie), worst-aircraft deviation **87 s against 43 s** (not a tie).
  Markedly more sample-efficient early — 0.25 success at 2M where 1_26 is at 0.00 — then
  plateaus. **Confounded by a mid-run crash and resume**; a clean re-run is item 1 above.
- [ ] **Finer / continuous actions** (item 1) — still open. Note that 1_27 moved *coarser* on
  turns and the trombone while adding MEDIUM speed steps, so it is not a test of this.
- [~] **Finer temporal control** — `TIME_BETWEEN_ACTIONS` 45 → 22 s so the agent acts ~2× as often
  per scenario (a *structural* limit distinct from item 1: only one aircraft can be commanded per
  step). **First data (Run 9):** a 22 s warm-restart of Run 8's 2 M checkpoint (`atc_run_1_16_b`)
  transiently hit the best worst-aircraft deviation of any run (~99 s) but regressed harder than the
  45 s control — transferring an off-regime policy mid-run is destabilising, so the result is
  **inconclusive**. A clean fresh 22 s run (`atc_run_1_17`, Run 10) is in early training. See
  [experiments](experiments.md).

## Next (on hold, agreed)

### 1. Finer / continuous actions
Speed comes in ±10/±30 kt buckets and trombone in whole 1–4 groups — too coarse to trim a
landing time to ±30 s. Options, increasing effort:

| Path | Mechanism | Effort | Notes |
|------|-----------|--------|-------|
| **B (start here)** | factored `MultiDiscrete([aircraft, type, magnitude_bucket])` with per-dim masking | low | fully supported by MaskablePPO; ~16–20 magnitude levels per type; no custom distribution |
| **A** | hybrid `Discrete(aircraft×type, masked)` + `Box(magnitude)` | high | true continuous; needs a **custom policy + composite distribution** (MaskableCategorical × DiagGaussian) — stock SB3 has no masked hybrid space |
| C | more discrete buckets on the flat `Discrete` | trivial | clumsy; inflates the 220-space |

**Plan:** try **B** first to confirm finer control helps before investing in **A**.

### 2. Reward peaking / marginal-progress bonus
A first, **dense flat** carrot shipped in Runs 6–7 — `goal = MAX·exp(−total_abs_dev/SCALE)`
(`MAX=2.0`, `SCALE=400 s`). It lifted reward and nudged deviation but did **not** clear the
ceiling, so the remaining variants are still open:

- **Staircase threshold bonuses** — per-aircraft `+b` as `|dev|` crosses 120 s / 60 s / 30 s,
  and/or a step bonus `+k·frac_under_30s` (sharper, per-aircraft gradient than the global
  `exp` already tried).
- **Potential-based shaping** — `r += γΦ(s′)−Φ(s)` with a *peaked* `Φ = Σ exp(−|dev|/τ)`
  (per-aircraft and provably policy-preserving, unlike the flat bonus shipped so far).

Note the dense bonus alone helped little **without finer actions** — likely best calibrated
*together* with item 1. Thresholds/coefficients to be tuned jointly.

## Open questions

- **Is ±30 s physically reachable** for these scenarios? Needs a per-action probe
  (does a speed/trombone change actually move predicted landing time enough?). If not, the
  success threshold itself needs revisiting.
- **Success-criteria relaxation** beyond the near-conflict gate (e.g. total-only vs
  per-aircraft) if 30 s proves too strict.
- **LR schedule** — *tried* in Run 7 (linear `3e-4→3e-5`); it tamed KL but may have capped
  late improvement (best @425k, then flat). Revisit the decay shape/floor alongside item 1.

## Parked

- **SAC** — not applicable under masked discrete actions (SB3 SAC is continuous-only).
  Revisit only if the action space becomes continuous.
