# Evaluation protocol

!!! abstract "Summary"
    Every model is scored on the same **100 validation seeds**, which training never draws, with
    the observation frame pinned per seed, so every model flies the identical 100 episodes. The
    standard **battery** has four parts: 20-flight streams (deterministic), stitched 2×20 streams,
    10 attempts per seed, and a critic-guided lookahead. Models are compared **seed by seed**:
    McNemar's test for solved/lost counts, the paired standard error for on-time rates. The report
    cards are generated from the evaluation files, so no number on them is typed by hand.

Source: `analysis/score_windowed.py`, `analysis/track_windowed.py`, `analysis/lookahead.py`;
10-aircraft: `analysis/score_checkpoints.py`, `analysis/track_run.py`, `analysis/attempts_to_solve.py`.

## Seeds and episodes

- **Validation seeds:** `config/eval_seeds.txt`, 100 scenario seeds. Training workers draw from their
  own seeded generators (`seed × 1000 + worker index` in the from-scratch recipe) and never draw
  a validation seed.
- **Pinned frame:** `score_windowed.py` fixes the scenario and the random observation translation
  per seed, so a deterministic model reproduces its episode exactly and two models are compared on
  identical inputs.
- **The seed is the sample.** Nothing is averaged over anything smaller than an episode.
- **Dev and test seeds (9 Oct 2026).** The 100 validation seeds had picked the best of about 25 runs,
  so they are no longer an unbiased measurement. Two fresh sets of 100 seeds, disjoint from the
  validation seeds and from every training pool, are in `analysis/2026-10-09_distill/seeds/`:
  `dev.txt` selects distillation epochs and rounds, and `test.txt` is used only for the final numbers.
- **What the test seeds showed.** Selection on the validation seeds inflates a model's score there. The
  former champion `1_38` (chosen as the best of many runs on the validation seeds) solves 63 of them but
  46 of the test seeds, with 12 losses of separation instead of 3; `1_76`, never selected against other
  runs on validation, solves 59 on both. Deterministic test-seed results (solved / LoS / on time):

| TMB | test seeds | | PMS | test seeds |
|---|---|---|---|---|
| `1_82` (distilled) | 61 / 15 / 0.871 | | `1_77` | 32 / 11 / 0.749 |
| `1_76` | 59 / 14 / 0.873 | | `1_75` | 29 / 13 / 0.746 |
| `1_101` (turn fix) | 53 / 13 / 0.864 | | `1_79` | 27 / 12 / 0.752 |
| `1_78` | 51 / 17 / 0.845 | | rule-based | 0 / 87 / 0.282 |
| `1_38` | 46 / 12 / 0.855 | | random | 0 / 100 / 0.021 |
| rule-based | 0 / 75 / 0.453 | | | |
| random | 0 / 98 / 0.091 | | | |

Tables: `analysis/2026-10-07_curriculum/report_test/` (`paper_tables.py --test-seeds`).

## The battery

| part | command | what it answers |
|---|---|---|
| **f20** 20-flight, deterministic | `score_windowed.py --models M --seeds 100` | what the policy does |
| **s2x20** stitched 2×20 | `… --segments 2 --gap 120 900` | does it hold up over a long stream? |
| **att10** 10 attempts | `… --attempts 9` | what does the policy *hold*? deterministic + 9 sampled, same frame |
| **la4** lookahead | `… --lookahead 4` | what does deployable search add? ([Lookahead](findings/lookahead.md)) |

With `TADA_SEQUENCE_OBS=1` and `TADA_MAX_PICKS=2` set to match the model. Each run writes one CSV
row per seed and attempt: `on_time, sep, all_on_time, landed, n_flights, mean_dev, max_dev,
end_reason, clearances, swaps, bracket_score, …`. `track_windowed.py` runs f20 on every 1M-step
checkpoint while a model trains and appends to `<run>/track.csv`.

## Metrics

Full definitions in the [glossary](glossary.md). Computed by the generator from the CSVs:

| metric | per seed | reported as |
|---|---|---|
| solved | `all_on_time and not sep` | seeds of 100 |
| hard-solved | `not sep and landed ≥ n_flights and max_dev ≤ 30` | seeds of 100 |
| separation lost | `sep` | seeds of 100 |
| flights on time | `on_time` (share of all flights within ±60 s; unlanded flights count as misses) | mean |
| pass@10 | any of the 10 attempts solved | seeds of 100 |
| pass@1 | a sampled attempt solved | share of the 900 sampled attempts |
| best attempt | fewest losses, then highest bracket score, then fewest clearances | its separation and on-time |
| never solved | safety-bound if the best attempt loses separation, else precision-bound | seeds |

"All 20 on time" is roughly the per-flight rate to the 20th power, so it is a demanding headline;
*flights on time* is comparable across stream lengths.

## Significance

Two models on the same 100 seeds are compared **paired**:

- **Solved, hard-solved, separation lost, pass@10:** McNemar's test. Only the seeds where the two
  disagree count; the exact two-sided sign test on those gives the p-value, and z = (gained − lost)
  / √(gained + lost) is reported. A card marks a delta **bold** only if p < 0.05.
- **Flights on time:** mean of the per-seed differences and its standard error; significant if
  |mean| ≥ 1.96 SE.

Unpaired, on 100 seeds, a rate difference under ~0.14 is noise ([Evaluation
noise](findings/evaluation-noise.md)).

## The champion rule

Among windowed models with a 20-flight evaluation: exclude any that lose separation on more than
**5** of 100 seeds; rank the rest by most solved, then fewer losses, then more hard-solved, then
fewer clearances. Safety first: more solves do not outrank a worse safety record. The rule is set
in `models.yaml` and applied by the generator. The current result is on the
[leaderboard](models/index.md).

## Renders

`render_policy.py` replays exactly the episode the scorer played and writes a `*_solutions.json`
(every clearance issued, the outcome, the attempt chosen) next to the video. The docs generator
refuses a video without metadata. Every video's caption names the model, checkpoint, seed and mode
(deterministic, best of 10 attempts, or lookahead). Each card has three standard slots: the shared
comparison seed 599310825, the model's best deterministic solve, and its most typical failure. Missing
renders are listed in [BACKFILL](backfill.md).

## The 10-aircraft instruments

The archived track used `score_checkpoints.py` (deterministic, 100 seeds, success = tier 5, Wilson
intervals), `attempts_to_solve.py` (sample until solved, cap 20; pass@k and the
capability/reliability split), a stochastic benchmark with a clearance log, and the refusal-shield
sweep. Their definitions and caveats are in [Archive → 10-aircraft tests](archive/ten-aircraft-tests.md).

## Never quote

| signal | why |
|---|---|
| in-training `eval_custom/success_rate`, `rollout/success_rate` | 5 episodes per pass on a moving seed window; read 1.00 for a true 0.38 |
| `best/best_model.zip` as "the best" | the argmax over ~1600 noisy draws |
| TensorBoard `end_reason/*` before commit `c030072` | logged presence-only; every series averages to 1.0 |
| a single intermediate checkpoint | [one band nearly produced a false reversal](findings/evaluation-noise.md) |
