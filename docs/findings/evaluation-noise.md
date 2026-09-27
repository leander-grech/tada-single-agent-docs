# Evaluation noise

!!! abstract "Summary"
    Several of the project's early conclusions came from instruments that could not support them.
    The in-training success rate is a 5-episode rolling window: it once read 1.00 for a run whose
    true rate was 0.38. The saved "best model" is the maximum of ~1600 such draws. On 100 seeds a
    success-rate difference under ~0.14 is noise unless the comparison is paired. A single
    intermediate checkpoint once suggested a reversal that the next one erased. The rules that
    followed: score offline on the fixed 100 seeds, pin the observation frame, compare seed by
    seed, and read the endpoint rather than a band.

## The in-training success rate measured nothing

`atc_run_1_22` reported a peak `eval_custom/success_rate` of 1.00 and appeared to oscillate between
0 and 1. Three defects compounded:

- `n_eval_episodes` was 5, so the rate took one of six values (SE ≈ 0.22 at p ≈ 0.4);
- the eval seed index never reset between passes, so consecutive points measured different
  scenarios;
- `best_model.zip` is the argmax over ~1600 such draws, an extreme-value statistic.

Three independent estimates put the true rate near 0.42. Deterministic scoring on the full 100-seed
pool returned **0.38**. And 46.6% of the eval passes scored exactly 0.0, where a constant p = 0.44
predicts 5.5%: the policy reliably solved some seeds and never others, so a scalar rate was the wrong
instrument regardless of its variance. Every cross-run claim resting on the in-training rate was
withdrawn, and `score_checkpoints.py` / `track_run.py` (later `score_windowed.py` /
`track_windowed.py`) became the only sanctioned instruments.

`best_model` stays unreliable in the windowed track too: `1_32`'s best model loses separation less
often but solves fewer seeds than its final model.

## How big a difference has to be

On 100 seeds at p ≈ 0.6, SE ≈ 0.049, so an **unpaired** difference below about 0.14 does not support
a claim. Because every model plays the identical 100 scenarios, the windowed comparisons are
**paired**: McNemar's test on the seeds where two models disagree, and the SE of the per-seed
difference for on-time rates. That is far more sensitive. `1_38` fixing 6 of `1_36`'s losses and
adding none is significant, while an unpaired 9 → 3 would sit near the threshold. The generator
marks a delta as significant only when the paired test says so.

## The observation frame

Each episode's observation is translated by a random offset. In the 10-aircraft scorer that offset
came from a global RNG that `reset()` never reseeded, so the same deterministic checkpoint on the
same scenario could act differently in another process. `1_27` at 10M solved seed 41 in one
invocation and stalled at tier 4 in another. Re-scoring `1_26` and `1_27` the same day moved them by
1 and 4 seeds (0.70 → 0.69, 0.64 → 0.60). **A few seeds of movement is the floor on that
instrument.** The windowed scorer (`score_windowed.py`) pins the frame per seed, so every model
plays the identical episode. Any single-episode A/B render must pin `--rng-seed` on both sides.

## Small subsets and single bands mislead

- A 25-seed probe of `1_26` gave 0.80 deterministic; the full 100 seeds gave 0.63. That subset was
  simply easier.
- At 9M `1_27a` scored 0.65, ahead of `1_26`'s 0.61; one band later it was 0.64 and behind.
  Publishing off that point would have announced a reversal that did not exist. **The endpoint is
  the number; intermediate bands show shape.**
- `1_33`'s 2M checkpoint looked significantly better than `1_32`'s on two measures, and neither
  gain held at any later checkpoint ([Sequencing](sequencing.md)).

## What the protocol does now

[Evaluation protocol](../evaluation.md): fixed validation seeds never used in training, a pinned
frame, the four-part battery, paired tests, and cards generated from the evaluation files so that
no number is copied by hand.
