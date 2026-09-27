# Training from scratch, and the traffic curriculum

!!! abstract "Summary"
    Every model up to `1_39` descends from the 10-aircraft agent `1_29` through a chain of
    fine-tunes. The from-scratch recipe asks whether the final design (lexicographic objective,
    sequence observations, reselection, attention) can be learned from random weights in 10M
    steps. It can learn a working policy, but at 10M steps it is well short of the fine-tuned
    lineage, and two seeds of the same recipe differ about as much as the recipe's variants do.
    A traffic curriculum (arm C, `1_43`) is still training.

Recipe and how to run it: [Training](../training/index.md).

## The arms

| arm | run(s) | what it is |
|---|---|---|
| A | [`1_40`](../models/1_40.md) (seed 1), [`1_42`](../models/1_42.md) (seed 2) | the design as trained by the fine-tunes, from step 0 |
| B | [`1_41`](../models/1_41.md) (seed 1) | A with flat (un-ramped) sequence and conflict potentials |
| C | [`1_43`](../models/1_43.md) (seed 1) | A with a traffic curriculum in one run: 10-flight streams to 2.5M, 20-flight to 5.5M, stitched 2×20 to 10M, with policy, optimiser, reward normalisation and LR schedule carried across stages |

All four use the same hyperparameters (`recipes/windowed_from_scratch.sh`: 32 workers, LR 3e-4 →
3e-5 with 8% warm-up, entropy 0.01) and are scored every 1M steps on the 100 validation seeds by
`analysis/track_windowed.py`.

## At 10M steps

<!-- gen:compare models=1_40,1_42,1_41,1_38 batteries=f20,s2x20,att10,la4 -->
<table class="tada-table tada-compare"><thead><tr><th>100 seeds, deterministic unless stated</th><th><a href="../../models/1_40/">1_40</a></th><th><a href="../../models/1_42/">1_42</a></th><th><a href="../../models/1_41/">1_41</a></th><th><a href="../../models/1_38/">1_38</a></th></tr></thead><tbody><tr><td>20-flight: solved</td><td>22</td><td>16</td><td>14</td><td>63</td></tr><tr><td>20-flight: hard-solved</td><td>2</td><td>1</td><td>2</td><td>24</td></tr><tr><td>20-flight: separation lost</td><td>9</td><td>7</td><td>9</td><td>3</td></tr><tr><td>20-flight: flights on time</td><td>0.779</td><td>0.790</td><td>0.793</td><td>0.927</td></tr><tr><td>20-flight: clearances / stream</td><td>161.9</td><td>155.8</td><td>158.1</td><td>121.9</td></tr><tr><td>20-flight: AMAN swaps / stream</td><td>0.98</td><td>0.62</td><td>0.60</td><td>0.54</td></tr><tr><td>stitched 2×20: solved</td><td>1</td><td>1</td><td>3</td><td>32</td></tr><tr><td>stitched 2×20: hard-solved</td><td>0</td><td>0</td><td>0</td><td>9</td></tr><tr><td>stitched 2×20: separation lost</td><td>13</td><td>21</td><td>20</td><td>15</td></tr><tr><td>stitched 2×20: flights on time</td><td>0.729</td><td>0.701</td><td>0.723</td><td>0.860</td></tr><tr><td>pass@10 (seeds)</td><td>38</td><td>37</td><td>34</td><td>76</td></tr><tr><td>separation lost, best of 10</td><td>0</td><td>1</td><td>2</td><td>2</td></tr><tr><td>with lookahead: solved</td><td>19</td><td>29</td><td>22</td><td>30</td></tr><tr><td>with lookahead: hard-solved</td><td>0</td><td>1</td><td>1</td><td>8</td></tr><tr><td>with lookahead: separation lost</td><td>7</td><td>5</td><td>2</td><td>1</td></tr><tr><td>with lookahead: flights on time</td><td>0.802</td><td>0.817</td><td>0.835</td><td>0.893</td></tr></tbody></table>

<!-- /gen -->

`1_38` is the fine-tuned champion, for reference: its lineage has seen roughly 45M windowed and
10-aircraft steps, though a best-model checkpoint in the chain makes that an upper bound (see its
card).

- **The recipe works but is not yet competitive.** From random weights, 10M steps give a policy
  that solves some streams and loses separation on under a tenth of seeds, far from the fine-tuned
  lineage.
- **Seed variance is as large as the design change.** Arm A's two seeds differ by about as much as
  arm A differs from arm B, so a single-seed comparison of arms cannot separate them. More seeds
  per arm are needed before calling one better.
- **Flat potentials (arm B) did not help.**
- **10M steps is not converged.** On both arm A seeds the solved count is still climbing steeply
  over the last million steps; arm B peaked at 7–8M and fell back. Separation losses bounce around
  a noisy floor from mid-run on (curves on each card).

## The curriculum (arm C)

`1_43` starts on 10-flight streams, where the window holds every flight, and moves to 20-flight and
then stitched streams. It is **in progress**. Validation is always on 20-flight streams, so its
curve is directly comparable with arm A's step for step. Its early checkpoints, trained only on
10-flight streams, are well ahead of arm A's at the same step; later ones are noisy, and the
verdict waits for 10M.
