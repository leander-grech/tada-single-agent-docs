# Roadmap

The [experiment log](experiments.md) has converged, twice. The first diagnosis — *conflicts are
handled, schedule deviation is stuck* — held from Run 1 through Run 7 and was broken by **Run 8**'s
5-tier ladder (worst-aircraft deviation 360–390 s → ~99 s, success 0 → 30–50 %). The second and
current diagnosis came out of **Run 13** (`atc_run_1_22`): with the *same code* that scored
`tier_mean` 1.0 when resumed onto a flat 3e-5 LR, a **fresh 8 M run on a warm-up→cosine schedule**
reached `success_rate = 1.0`, a **24 s** worst-aircraft deviation and a **positive** eval reward
(+43.8) — the first of each.

So capability is no longer the frontier. **Stability is.** `success_rate` swings between 0.0 and
1.0 across evaluation passes rather than converging, and Run 13 ended on a trough (sustained
~0.41, final 0.00). The second frontier is **generalisation**: the BGY point-merge airspace
([Run 15](experiments.md#run-15)) is learnable but has not come close to the trombone numbers.

## Done since

- [x] **Larger gradient clip** — `max_grad_norm` 0.5 → 1.5 (**Run 5**): `clip_frac` 1.0 → ~0.2,
  reward −51 → −45 best; deviation ceiling held.
- [x] **Dense goal "carrot"** — `MAX·exp(−total_abs_dev/SCALE)` (**Runs 6–7**): best reward −33,
  `frac_under_30s` 0.35, worst aircraft 367 s; still no full success.
- [x] **KL control** — LR decay, `n_epochs` 5, `target_kl` 0.03 (**Run 7**): fixed the KL blow-up
  (0.22 → 0.002), didn't lift the ceiling.
- [x] **5-tier success + autoregressive policy + per-scenario horizon** (**Run 8**): first non-zero
  success (0 → ~30 %, peak 50 %), deviation ceiling broken (→ ~99 s).
- [x] **Finer temporal control — tested and rejected.** `TIME_BETWEEN_ACTIONS` 45 → 22 s got a
  clean from-scratch trial in [Runs 10–11](experiments.md#run-10) (`atc_run_1_17/18/19`, three
  independent runs, up to 5.1 M steps). All floor at **240–275 s** worst-aircraft deviation with
  **zero** successes, versus 45 s reaching 99 s and 30–50 %. More decision points are not the
  missing lever. Reverted in [Run 12](experiments.md#run-12).
- [x] **LR schedule — resolved, and it was the big one.** [Run 13](experiments.md#run-13):
  fresh run + warm-up→cosine `3e-4 → 3e-5` + a full 8 M steps. Same code as `1_21`, which had been
  resumed onto a near-flat 3e-5 and stalled at `tier_mean` 1.0. **Never resume a long run onto an
  end-of-schedule LR** — there is no headroom left to learn.
- [x] **±30 s is physically reachable** — answered empirically by Run 13's **24.3 s**
  worst-aircraft deviation. The success threshold does not need relaxing on capability grounds.
  This retired the open question below and motivated the T6 (±30 s) ladder.
- [x] **Point-merge MDP is well-posed** — `analysis/pms_mdp_sanity.py` (2026-07-27): aircraft
  radius 57 nm vs the ±150 nm extent, 0 % off-map, 0 NaN/Inf, `observation_space.contains` 100 %
  over 529 steps, saturation ≤ MXP everywhere. No obs-norm retuning needed.
- [x] **Conflict semantics pinned down** — see [Loss of separation](separation.md). `severity == 1.0`
  means *zero* separation, not 3 NM; "within 3 NM" is `severity >= 0.7`. The realised-only success
  gate (`SUCCESS_CONFLICT_REALISED_ONLY`) ships in [Run 16](experiments.md#run-16).

- [x] **Realised-only conflict gate shipped and measured** — [Run 16](experiments.md#run-16)
  (`atc_run_1_25_trombone_relaxed`, 8 M). Capability identical to Run 13; the gate change cost
  nothing and **corrected the instrumentation**: `no_near_conflicts_mean` 0.996 → 0.774, i.e.
  ~23 % of episodes contain a real loss of separation where the old metric reported 99.6 % clean.

## In flight

- [ ] *(nothing training)* — next run should be one of the two items below, run **separately**
  so the effects are attributable.

## Next

### 1. Fix the evaluation loop — **do this before anything else**

The "training oscillates 0.0–1.0 instead of converging" problem is **mostly a measurement
artifact**, and until it is fixed no other change on this list can be evaluated. Three
compounding defects:

| # | Defect | Effect |
|---|---|---|
| 1 | `n_eval_episodes = 5` (`main.py:580`) | `success_rate` can only be 0, .2, .4, .6, .8, 1.0; SE ≈ **0.22** at p≈0.4 |
| 2 | `_eval_episode_index` (`single_agent_env.py:185`) is never reset per eval pass | **every pass walks a different 5-seed window** — consecutive eval points measure different scenarios |
| 3 | `best/best_model.zip` = argmax over ~1600 such draws | an extreme-value artifact, not the best policy |

**Measured directly:** `atc_run_1_22`'s `best_model`, saved at a reported `success_rate` of
**1.00**, scores **0.380 (95 % CI 0.291–0.478)** when re-run on the full fixed 100-seed pool.
Corroborated by the last-15 % mean of `success_rate` (0.41) and by the observed 1.6 % frequency
of 5/5 passes, which is what a binomial at p≈0.44 predicts.

Two numbers fix it, at **identical eval compute**:

```python
# main.py
eval_freq=max(100_000 // N_TRAIN_ENVS, 1),   # was 5_000
n_eval_episodes=100,                          # was 5  (== len(Config.SCENARIO_EVAL_SEEDS))
```

Setting `n_eval_episodes` equal to the seed-pool size makes the rolling window wrap exactly, so
**every pass evaluates the identical 100 scenarios**. Cost is unchanged (1600 × 5 = 8000 episodes
before, 80 × 100 = 8000 after); SE drops 0.22 → 0.05 and passes become comparable.

!!! tip "Success is per-scenario, not uniform"
    46.6 % of `1_22`'s eval passes scored exactly 0.0, where a constant p=0.44 predicts 5.5 %.
    That excess means the policy reliably solves some seeds and **never** solves others. A scalar
    `success_rate` is the wrong instrument — dump per-seed outcomes and study the failing subset.

Completed runs can be re-scored after the fact — eval settings do not affect training. Use
`analysis/score_checkpoints.py`, which scores any checkpoint on the full fixed seed pool and
reports a Wilson confidence interval.

### 2. Stop taxing safe spacing in the conflict reward

The conflict term is **~46 % of the per-step reward magnitude**, but decomposing it on Run 13's
best model shows where that goes:

| Closest approach of the charged pair | Share of the conflict penalty |
|---|---|
| > 7 NM | 25.1 % |
| **5–7 NM** | **73.7 %** |
| 3–5 NM | 0.6 % |
| **< 3 NM (an actual conflict)** | **0.6 %** |

Mean severity of charged pairs is 0.167 — about **8.3 NM apart**. So roughly half the agent's
gradient is a proximity tax on normal arrival spacing, and it is **directly opposed to the
deviation objective**: hitting AMAN times requires sequencing aircraft tightly, which this term
punishes. That is the most likely explanation for a deviation ceiling that survived 20 runs of
reward and optimiser tuning.

Cause: `HORIZONTAL_SAFEZONE_RADIUS_NM = 10.0` makes severity non-zero out to 10 NM, and
`NEAR_CONFLICT_TIME_S = 1200 s` means the imminence *ramp* (not the small `CONFLICT_FAR_FLOOR`)
applies for most of an episode.

Fix — a severity deadband. **The idiom already exists in the same file** (`rewards.py:367`,
`compute_weighted_infringement_total`); the newer `infringement_reward_from_world` just dropped it:

```python
severity = _pair_severity(infr)
s0 = float(Config.CONFLICT_SEVERITY_DEADBAND)   # 0.5 == 5 NM
if severity <= s0:
    continue
severity = (severity - s0) / (1.0 - s0)
```

Small diff, **large behavioural change** — it removes ~99 % of the conflict penalty magnitude on
safe episodes. The safety backstop is untouched (`−REWARD_VIOLATION_PENALTY = −15` on a realised
bust, plus the realised-only tier gate), but watch `no_near_conflicts_mean`: it is **0.774**, not
the 0.99 the old metric implied, so there is genuinely less headroom here than it looks. If it
falls below ~0.70, raise `s0` or restore some weight.

### 3. Make the terminal success signal non-negligible

`_tier_bonus()` (`single_agent_env.py:684`) is **defined and never called** — the +1.5 … +13.0
ladder this documentation calls the "primary north star" is not applied as a terminal reward. It
survives only as the coefficients inside the PBRS potential, and PBRS telescopes to a
policy-independent constant per episode.

So the entire terminal payoff for solving the problem is
`REWARD_SUCCESS_BONUS_TIER5_CONFIRM = +1.0`, against an episode return range of roughly −200…+44 —
about **0.4 % of the range**. There is no basin of attraction at the goal: the agent optimises
dense deviation and success is incidental, which is exactly the "gets there, doesn't stay there"
behaviour observed.

The large cliff was removed deliberately (high-variance lump for the critic) and Run 13 was the
best run *with* that design, so do not restore the full ladder. But raise the confirm to **~5**,
and consider a matching small T4 confirm, so there is a real gradient step at the top.

### 4. Finer action granularity (path B)

Still never started, and still the prime suspect for the *residual* deviation floor: ±10/±30 kt
speed buckets and whole 1–4 trombone groups cannot trim a landing time to ±30 s except by luck.

| Path | Mechanism | Effort | Notes |
|------|-----------|--------|-------|
| **B (start here)** | factored `MultiDiscrete([aircraft, type, magnitude])` with per-dim masking | low | already the action-space shape; ~16–20 magnitude levels per type; no custom distribution |
| **A** | hybrid `Discrete(aircraft×type, masked)` + `Box(magnitude)` | high | needs a custom policy + composite distribution; stock SB3 has no masked hybrid space |
| C | more discrete buckets on the flat `Discrete` | trivial | clumsy; inflates the space |

Probes exist and are **unrun on point-merge**: `analysis/cd4_reachability_probe.py`,
`analysis/cd4_granularity_probe.py`. Verdict rule: reachability < 53 % ⟹ interface-bound
(do this first); ≫ 53 % ⟹ policy-bound (do item 1 first).

### 3. Close the point-merge gap

`1_24_pms` and `1_24` reach best success 0.20 / 0.00 against the trombone's 1.00. Now that Run 13
has established the recipe that works — **fresh, 8 M, warm-up→cosine, 45 s** — the obvious next
point-merge run is that recipe applied cleanly, rather than the resumed/aggressive schedules both
PMS runs actually used.

### 4. Reward peaking (calibrate *with* item 2, not before)

- **Staircase threshold bonuses** — per-aircraft `+b` as `|dev|` crosses 120 / 60 / 30 s.
- **Potential-based shaping** — `r += γΦ(s′) − Φ(s)` with a peaked per-aircraft
  `Φ = Σ exp(−|dev|/τ)`. A tier-fraction PBRS potential (`tier_potential`) already exists;
  a per-aircraft one does not.

## Housekeeping

- [ ] **Fix the dead scenario filter** — `check_not_imminent_infringement()` compares against a
  literal `severity >= 1.0`, which is unreachable, so it always passes and the
  initial-conflict-free guarantee is not enforced. Should compare against
  `Config.NEAR_CONFLICT_THRESHOLD`. Deferred because it changes the scenario distribution and
  would confound the `1_25` vs `1_22` comparison. See
  [Loss of separation](separation.md#the-scenario-filter-is-dead-code).
- [ ] **Decide the default scenario** — `config.py` currently ships `VALIDATION_USE_CASE_1`
  (MXP trombone) again for Run 16. The PMS work left it on `USE_CASE_2`; pick one deliberately.
- [ ] **Launch every long run under `setsid nohup`** — `1_24_pms`'s first attempt died with its
  parent CLI session at ~1.27 M steps.

## Open questions

- **Is the oscillation real or measurement noise?** See the tip under item 1 — this gates
  everything else.
- **Success-criteria shape** — with ±30 s now proven reachable, is `all aircraft within ±30 s`
  (T6) the right binary, or should it be a fraction-based criterion that degrades gracefully?

## Parked

- **SAC** — not applicable under masked discrete actions (SB3 SAC is continuous-only).
  Revisit only if the action space becomes continuous.
- **Finer temporal control (22 s)** — tested and rejected; see *Done since*.
