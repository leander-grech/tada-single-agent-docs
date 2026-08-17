# How an agent is tested

!!! abstract "TL;DR"
    Every number on this site comes from one of **four** instruments, and they answer
    different questions. **Deterministic scoring** asks *what does this policy do*;
    **attempts-to-solution** asks *what could it do*; the **clean set** separates "missed the
    clock" from "was unsafe"; the **shield sweep** asks whether eval-time postprocessing helps.

    **The in-training `success_rate` is not one of the four.** It is a 5-episode rolling
    binomial on a seed window that moves every pass, and `best_model.zip` is the argmax over
    ~1600 such draws. It once read **1.00** for a run whose true rate was **0.38**. Never quote
    it.

    This page defines every term the [test log](analysis_log.md) and the
    [v1 vs v2 comparison](analysis_v1_v2.md) use. If a word is used there, its meaning is here.

Source: `analysis/score_checkpoints.py`, `analysis/attempts_to_solve.py`,
`analysis/track_run.py`, `analysis/ordering_sensitivity.py`, `atc_env/single_agent_env.py`,
`config/config.py`.

---

## The unit of measurement: one episode { #episode }

One episode is one arrival scenario: up to 10 aircraft inbound to Milan Malpensa, generated
from a scenario **seed**. The agent issues one clearance every 45 s until the episode ends.
Nothing is averaged over anything smaller — the seed is the sample.

### `end_reason` — the five ways an episode can stop { #end-reason }

Classified at the terminal step (`single_agent_env.py:1001 _check_terminated`,
`:1054 _check_truncated`). Exactly one fires.

| `end_reason` | what happened | counts as |
|---|---|---|
| `success` | every aircraft landed **and** the episode reached Tier 5 | solved |
| `delayed` | every aircraft landed, but below Tier 5 | failed on precision |
| `separation` | a **realised** loss of separation — episode ends *immediately* | failed on safety |
| `airspace_exit` | an aircraft left controlled airspace — ends immediately | failed on safety |
| `timeout` | the per-scenario step horizon expired | — |

!!! note "`timeout` has never been observed"
    Zero occurrences in 800 scored episodes across eight checkpoints. Every episode ends by
    landing or by a bust; the horizon does not bind in practice. This matters because
    `global.time_s` encodes progress toward a deadline that never arrives — see
    [Observations](observations.md).

---

## Instrument 1 — deterministic scoring { #deterministic }

`analysis/score_checkpoints.py`, wrapped by `analysis/track_run.py` for whole runs.

Replays a checkpoint with `deterministic=True` (greedy argmax, no sampling) over a **fixed pool
of 100 evaluation seeds** (`config/eval_seeds.txt`). Same seeds, same order, every time — which
is what makes two runs comparable at all.

```bash
python analysis/score_checkpoints.py --seeds 100 \
  --models experiments/atc_run_1_27_actionset_v2/best/best_model.zip
```

### `success` — the one definition { #success }

`success = bool(tier == 5)` — `single_agent_env.py:884`. Nothing else is called success
anywhere in this project. Tier 5 requires **all aircraft landed and every one of them within
±60 s of its AMAN target**, with no realised loss of separation.

### The tier ladder { #tiers }

Graduated partial credit, so that a policy that is *nearly* right gets a gradient instead of a
zero. Highest tier reached wins; they do not stack. Thresholds from `config/config.py:392–405`.

| tier | requirement | reward weight |
|---|---|---|
| T1 | ≥ 50% of aircraft within ±120 s | 1.5 |
| T2 | ≥ 80% within ±100 s | 3.0 |
| T3 | ≥ 80% within ±70 s **and** worst aircraft < 200 s | 6.0 |
| T4 | ≥ 80% within ±60 s **and** worst aircraft < 120 s | 9.0 |
| **T5 — "solved"** | **all landed and *every* aircraft within ±60 s** | 13.0 |

Every tier additionally requires that no realised loss of separation occurred. Since run 1_26
terminates the episode on one, that condition is automatic.

!!! warning "`tier_mean` is not comparable across all runs"
    A **6-tier** ladder ending at ±30 s was used by runs `1_23`, `1_24` and `1_24_pms` only, and
    the rungs were re-valued between the two ladders. A `tier_mean` of 2.2 on the 6-tier ladder
    is not worse than 2.6 on the 5-tier one. Runs `1_25` onward are all 5-tier.

### `separation_rate` and what a "bust" is { #separation }

The fraction of episodes with `had_separation == True`
(`single_agent_env.py:914 _episode_violations`). That flag is set when some pair was inside
**both 3 NM horizontally and 500 ft vertically** at a real timestep of the **live** world —
`severity == 1.0`, the operational loss of separation.

Purely *predicted* conflicts never count, however imminent. The agent is shown a much wider
10 NM detection band, but it is only ever *charged* for closeness inside 5 NM. See
[Loss of separation](separation.md) for why the raw simulator event is not the same thing.

### The clean set, and clean-subset success { #clean-set }

There is **no `clean_set` object in the code** — "clean" is a filter, applied inline at
`score_checkpoints.py:113`:

```python
[r["ep_return"] for r in rows if not r["had_separation"]]
```

- **The clean set** = the episodes in which no loss of separation occurred, *regardless of
  whether they succeeded*. At a 0.07 separation rate that is 93 of the 100 seeds.
- **Clean-subset success** = `success / (1 − separation_rate)`. The success rate *among the
  episodes the agent flew safely*.

**Why it is the number to watch.** Raw success conflates two failure modes. A policy can raise
success by flying so conservatively that it never busts but lands everything late, or by cutting
things fine and busting more often. Clean-subset success asks the isolated question: *when it
keeps everyone apart, how often does it also hit the clock?* It is the metric that sat pinned
near **53.7%** across twenty runs of reward and optimiser tuning before run 1_26 moved it.

- **`return_clean_min` / `return_clean_max`** — the episode-return range over the clean set.
  This is not a performance metric; it is the calibration target for
  `REWARD_VIOLATION_PENALTY`, which has to be large enough that a bust scores below a
  comparable clean episode.

### `max_dev_mean` — worst-aircraft deviation { #max-dev }

Per episode, the largest `|schedule deviation|` over all aircraft; then averaged over the 100
seeds. **It is a tail statistic, not an average error** — one aircraft 200 s late gives the same
`max_dev` whether the other nine are perfect or mediocre. Because T5 requires *every* aircraft
inside ±60 s, this is the quantity that actually gates success, which is why it is reported
alongside the mean total deviation rather than instead of it.

### Wilson intervals, and how big a difference has to be { #wilson }

`success` is a binomial over 100 seeds, reported with a **Wilson score interval**
(`score_checkpoints.py:40`) rather than the normal approximation — the normal approximation
misbehaves near p = 0 and p = 1, which is exactly where early checkpoints live.

At n = 100 and p ≈ 0.6, **SE ≈ 0.049**. Two runs comparing a difference of less than about
**0.14** are inside the noise band and the comparison does not support a claim. When exactly two
models are passed, the script prints this test directly.

---

## Instrument 2 — attempts-to-solution { #attempts }

`analysis/attempts_to_solve.py`. The probe that separates **capability** from **reliability**.

Deterministic scoring collapses a policy to a single greedy rollout per scenario, and so cannot
distinguish two very different failures:

- **Capability-bound** — no rollout this policy can produce solves the scenario. More sampling
  will not help; the *interface* or the policy has to change.
- **Reliability-bound** — a solving rollout is inside the policy's distribution, but the greedy
  argmax path is not it. Sampling finds it in a few tries.

Those call for opposite responses. The probe samples each scenario **stochastically** until it
is solved or a cap is hit.

```bash
python analysis/attempts_to_solve.py --model <ckpt>.zip --seeds 100 --max-attempts 20
```

| term | definition |
|---|---|
| **attempt** | one full stochastic rollout of a pinned scenario, with the policy sampling instead of taking the argmax |
| **attempts-to-solve** | the index of the first attempt that reaches T5 |
| **censored** | never solved within the cap. The true value is "more than the cap", not a number |
| **pass@k** | fraction of seeds whose first success came at attempt ≤ k. `pass@1` is the single-shot stochastic rate; the asymptote is roughly what the policy *can* solve at all |
| **deterministic baseline** | one greedy attempt per seed, drawn as a reference line |
| **pooled attempt success** | success pooled over *every* attempt. **Biased low** — hard seeds contribute many failed attempts — and is not the single-shot rate. Do not quote it |

**The gap between `pass@1` and the pass@k asymptote is pure reliability**, and it is
recoverable at inference time — by best-of-n, or a shield — with no retraining at all. The gap
between the asymptote and 1.0 is capability, and only a design change moves it.

!!! note "Two sources of randomness per attempt"
    Each attempt re-rolls both the policy's action sampling *and* the observation frame
    (`sample_translation_matrix()` draws from the global numpy RNG, which `reset()` never
    reseeds). Pass `--pin-frame` to hold the frame fixed and isolate policy stochasticity.
    Re-running one seed without it is therefore not reproducible.

### Classifying the residual failures { #residual-split }

Seeds that survive the cap are split by **what their attempts did**, using one rule applied
identically to every run so the runs stay comparable:

| class | rule | what it means |
|---|---|---|
| **safety-bound** | busts separation on **≥ 50%** of attempts | the geometry is the problem. Sampling more finds a bust, not a solution |
| **precision-bound** | busts on **< 20%** of attempts and **never** reaches T5 | it flies the traffic safely and misses the clock. An action-space / control-authority problem |
| **mixed** | anything in between | |

This is the split that produced the case for `SHORTEN_TROMBONE` — see
[22 clearances vs 15](analysis_v1_v2.md).

---

## Instrument 3 — the stochastic benchmark with a clearance log { #solutions }

`render_policy.py --all-eval-seeds --no-video --stochastic --attempts N --solutions-json …`

Covers the same ground as instrument 2, but additionally exports **every clearance the agent
issued**, per aircraft, per step. That is the only way to answer questions of the form *does the
agent actually use this action?* — which is how a clearance earns or loses its place in the
action set.

Outputs a `…_results.md` (per-seed table plus an aggregate) and a `…_solutions.json`
(`schema: tada-single-agent-solutions/1`) carrying `commands`, `raw_actions` and the clearance
name map for the action set in force.

!!! warning "Raw actions, not a tidy plan"
    `cleanup.applied` is `false`: consecutive speed changes are **not** accumulated and no-op
    clearances are **not** filtered out. The clearance counts are what the policy emitted, not
    a minimal equivalent plan.

---

## Instrument 4 — the refusal shield sweep { #shield }

`analysis/2026-06-24_shield_benchmark/shield_benchmark.py`. Asks whether **eval-time
postprocessing** extracts more from a fixed checkpoint, with no retraining.

A *refusal shield* is a read-only one-step lookahead (`env.peek_action` / `env.peek_clearances`)
that vetoes the policy's proposed clearance and substitutes a fallback:

- `--refuse-on-reward-drop` — veto a clearance whose one-step reward is worse than doing nothing.
- `--refuse-on-critical-conflict` — veto a clearance that introduces a near-horizon conflict.
- `--refuse-fallback {do_nothing, next_best}` — what to issue instead.

Measured on `atc_run_1_16`: shields lifted the mean bonus tier 0.03 → 0.43 but needed ~49
refusals per episode, and `next_best` beat `do_nothing` decisively. On the later tier-trained
checkpoints the **raw policy is already the strongest variant** and every shield degrades it.

!!! danger "The shield was silently broken for months"
    `deepcopy` on the route store raises `TypeError` — `RoutePoint` is a PyO3 type — and
    `peek_clearances` swallowed it with a bare `except`. From commit `f9ecc24` until `9560f92`
    the shield **dropped every trombone clearance** from its candidate set. Any shield result
    from that window understates `next_best`.

---

## What is deliberately *not* measured this way { #not-measured }

| signal | why it is not evidence |
|---|---|
| `eval_custom/success_rate` | 5 episodes per pass, on a **rolling** seed window that never resets — consecutive points measure different scenarios. SE ≈ 0.22 |
| `best/best_model.zip` selection | argmax over ~1600 such draws: an extreme-value statistic, not a quality ranking |
| `rollout/success_rate` | training-distribution episodes, not the fixed pool |
| any run before `c030072` | `end_reason/*` was logged presence-only, so every series averages to exactly 1.0 and the separation rate is simply absent from TensorBoard |

The fix costs nothing at equal compute: `n_eval_episodes = 100` makes the rolling window wrap
exactly, so every pass evaluates the identical 100 scenarios and SE drops 0.22 → 0.05. It has
not been applied to the training loop; `track_run.py` sidesteps it instead by scoring offline.

---

## Reproducibility notes { #repro }

- **`reset(seed=…)` does not pin the scenario** in evaluation mode. `_select_scenario_seed()`
  ignores it and walks `Config.SCENARIO_EVAL_SEEDS` in order. `score_checkpoints.py` lines up
  only because it iterates that same pool in the same order; `attempts_to_solve.py` pins
  explicitly via `options['sim_kw']`.
- **A checkpoint can only be loaded into the action set it was trained on.**
  `actions/action_set.py::check_checkpoint_compatible` reads the clearance-head width out of the
  `.zip` and exits with the remedy rather than a raw tensor-shape error. Replaying anything up
  to and including run 1_26 needs `TADA_ACTION_SET=v1`.
- **A single episode is not a controlled comparison.** The observation frame is drawn by
  `sample_translation_matrix()` from the *global* numpy RNG, which `reset()` never reseeds — so
  two processes replaying the same scenario seed with the same deterministic checkpoint can
  still take different actions and reach different outcomes. Measured directly: run `1_27` at
  10M solves eval seed `41` at tier 5 in one invocation and stalls at tier 4 in another, with
  no change but the frame.

    Over the 100-seed pool this averages out, which is why the scored tables are trustworthy.
    For any **side-by-side of two policies on one scenario** — an A/B render, a worked example —
    pass `--rng-seed` identically to both sides, or the difference you are looking at is partly
    frame noise.

- **Slot ordering is inert** — verified, not assumed. See the
  [test log](analysis_log.md#t-ordering).
- Run `python analysis/action_set_selftest.py` under both `v1` and `v2` before trusting any
  cross-set comparison. It is seconds of work and it catches a mis-set `TADA_ACTION_SET`
  silently poisoning the result.
