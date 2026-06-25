# Roadmap

The [experiment log](experiments.md) converged on one diagnosis: **conflicts are handled,
but schedule deviation is stuck** (`frac_under_30s ≈ 0.3`, worst aircraft ≈ 360–390 s off)
and exploration/value fixes don't move it. Runs 5–7 since then have **confirmed** this:
grad-clip, a dense goal bonus, longer training, and KL control each improved reward
(best −33) but left the deviation ceiling — and `success_rate = 0` — intact. **Run 8 has since
broken both** (see *Done since*): the 5-tier success ladder lifted success to ~30–50% and pulled
the worst-aircraft deviation from ~360–390 s down to ~99 s. The live frontier is now training
**stability** (the policy oscillates past ~3 M) and validating finer control.

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

- [ ] **Finer / continuous actions** (item 1) — now the prime suspect: every optimisation and
  reward lever has been exhausted without breaking the deviation floor.
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
