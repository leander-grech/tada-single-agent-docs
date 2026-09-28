# Training from scratch, and the traffic curriculum

!!! abstract "Summary"
    Every model up to `1_39` descends from the 10-aircraft agent `1_29` through a chain of
    fine-tunes. The from-scratch recipe asks whether the final design (lexicographic objective,
    sequence observations, reselection, attention) can be learned from random weights in 10M
    steps. It can. **You get what you train on:** a curriculum that ends on 20-flight streams
    (arm D, `1_44`) is the best from-scratch agent on the 20-flight validation seeds, while one that
    ends on stitched streams (arm C, `1_43`) is safer on long streams. All of this rests on one
    training seed per arm, with noisy curves. Continuing `1_43` for 10M more steps (`1_46`, not from
    scratch) adds precision. The warm-started champion `1_38` is still clearly better than all of
    them.

Recipe and how to run it: [Training](../training/index.md).

## The arms

| arm | run(s) | what it is |
|---|---|---|
| A | [`1_40`](../models/1_40.md) (seed 1), [`1_42`](../models/1_42.md) (seed 2) | the design as trained by the fine-tunes, from step 0 |
| B | [`1_41`](../models/1_41.md) (seed 1) | A with flat (un-ramped) sequence and conflict potentials |
| C | [`1_43`](../models/1_43.md) (seed 1) | A with a traffic curriculum in one run: 10-flight streams to 2.5M, 20-flight to 5.5M, stitched 2×20 to 10M, with policy, optimiser, reward normalisation and LR schedule carried across stages |
| **D** (default) | [`1_44`](../models/1_44.md) (seed 1) | the same curriculum without the stitched stage: 10-flight streams to 2.5M, then 20-flight streams to 10M |
| C + 10M | [`1_46`](../models/1_46.md) | `1_43` continued for 10M steps on 20-flight streams (LR 1e-4 → 1e-5, 100k critic warm-up); 20M in all, not from scratch |

All from-scratch arms use the same hyperparameters (`recipes/windowed_from_scratch.sh`: 32 workers,
LR 3e-4 → 3e-5 with 8% warm-up, entropy 0.01) and are scored every 1M steps on the 100 validation
seeds by `analysis/track_windowed.py`.

## At 10M steps

<!-- gen:compare models=1_40,1_42,1_41,1_43,1_44,1_46,1_38 batteries=f20,s2x20,att10,la4 -->
<table class="tada-table tada-compare"><thead><tr><th>100 seeds, deterministic unless stated</th><th><a href="../../models/1_40/">1_40</a></th><th><a href="../../models/1_42/">1_42</a></th><th><a href="../../models/1_41/">1_41</a></th><th><a href="../../models/1_43/">1_43</a></th><th><a href="../../models/1_44/">1_44</a></th><th><a href="../../models/1_46/">1_46</a></th><th><a href="../../models/1_38/">1_38</a></th></tr></thead><tbody><tr><td>20-flight: solved</td><td>22</td><td>16</td><td>14</td><td>22</td><td>37</td><td>44</td><td>63</td></tr><tr><td>20-flight: hard-solved</td><td>2</td><td>1</td><td>2</td><td>6</td><td>13</td><td>13</td><td>24</td></tr><tr><td>20-flight: separation lost</td><td>9</td><td>7</td><td>9</td><td>6</td><td>6</td><td>7</td><td>3</td></tr><tr><td>20-flight: flights on time</td><td>0.779</td><td>0.790</td><td>0.793</td><td>0.801</td><td>0.817</td><td>0.852</td><td>0.927</td></tr><tr><td>20-flight: clearances / stream</td><td>161.9</td><td>155.8</td><td>158.1</td><td>140.6</td><td>153.7</td><td>158.7</td><td>121.9</td></tr><tr><td>20-flight: AMAN swaps / stream</td><td>0.98</td><td>0.62</td><td>0.60</td><td>1.05</td><td>1.07</td><td>0.56</td><td>0.54</td></tr><tr><td>stitched 2×20: solved</td><td>1</td><td>1</td><td>3</td><td>8</td><td>10</td><td>17</td><td>34</td></tr><tr><td>stitched 2×20: hard-solved</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>3</td><td>9</td></tr><tr><td>stitched 2×20: separation lost</td><td>13</td><td>21</td><td>21</td><td>11</td><td>17</td><td>8</td><td>15</td></tr><tr><td>stitched 2×20: flights on time</td><td>0.730</td><td>0.704</td><td>0.725</td><td>0.745</td><td>0.738</td><td>0.818</td><td>0.865</td></tr><tr><td>pass@10 (seeds)</td><td>38</td><td>37</td><td>34</td><td>34</td><td>51</td><td>56</td><td>76</td></tr><tr><td>separation lost, best of 10</td><td>0</td><td>1</td><td>2</td><td>1</td><td>2</td><td>1</td><td>2</td></tr><tr><td>with lookahead: solved</td><td>19</td><td>29</td><td>22</td><td>24</td><td>31</td><td>37</td><td>30</td></tr><tr><td>with lookahead: hard-solved</td><td>0</td><td>1</td><td>1</td><td>4</td><td>7</td><td>19</td><td>8</td></tr><tr><td>with lookahead: separation lost</td><td>7</td><td>5</td><td>2</td><td>1</td><td>4</td><td>4</td><td>1</td></tr><tr><td>with lookahead: flights on time</td><td>0.802</td><td>0.817</td><td>0.835</td><td>0.788</td><td>0.825</td><td>0.849</td><td>0.893</td></tr></tbody></table>

<!-- /gen -->

`1_38` is the fine-tuned champion, for reference: its lineage has seen roughly 45M windowed and
10-aircraft steps, though a best-model checkpoint in the chain makes that an upper bound (see its
card). It solves significantly more 20-flight streams than `1_46` (25 gained, 6 lost, p = 0.001)
and `1_44` (30 gained, 4 lost, p < 0.001).

- **The recipe works but is not yet competitive.** From random weights, 10M steps give a policy
  that solves some streams and loses separation on under a tenth of seeds, far from the fine-tuned
  lineage.
- **Seed variance is as large as the design change.** Arm A's two seeds differ by about as much as
  arm A differs from arm B, so a single-seed comparison of arms cannot separate them. More seeds
  per arm are needed before calling one better.
- **Flat potentials (arm B) did not help.**
- **Arm D is the best from-scratch agent on 20-flight streams.** It solves more than arm A seed 1
  (37 vs 22; 21 gained, 6 lost, p = 0.006) and more than arm C, which shares its first 5.5M steps
  (next section).
- **10M steps is not converged.** On both arm A seeds the solved count is still climbing steeply
  over the last million steps; arm B peaked at 7–8M and fell back. Separation losses bounce around
  a noisy floor from mid-run on (curves on each card).

## The curriculum: C vs D

`1_43` (C) and `1_44` (D) use the same seed and the same curriculum up to 5.5M steps, and their
scored checkpoints to 5M are identical. From 5.5M, C trains on stitched 2×20 streams and D stays on
20-flight streams. **So C vs D is a controlled comparison of the last 4.5M steps.**

- **D wins on the 20-flight target:** 37 vs 22 solved, 23 seeds solved only by D and 8 only by C
  (exact McNemar p = 0.011), with equal separation losses (6 and 6).
- **C is safer on stitched and long streams:** fewer stitched 2×20 losses (11 vs 17, not
  significant, p = 0.21), and no loss on any feasible long stream where D loses one 60-flight and
  one 100-flight stream ([Long streams](long-streams.md)).
- **Caveats:** one training seed each, and D's curve is noisy at the end (14, 26, 37 solved at
  8M, 9M and 10M), so its exact 10M number is partly luck of the checkpoint.

The recipe default is now **arm D**. Choose **arm C** when long-stream safety matters more than
20-flight precision.

Earlier, against all three other from-scratch runs before D existed, 5 of 42 paired tests on `1_43`
were significant at 5% (about 2 expected by chance), four of them on stitched streams in its
favour. That is the same "you get what you train on" pattern.

## Continuing C: `1_46`

`1_46` takes `1_43` and trains 10M more steps on 20-flight streams, at a lower learning rate. It
solves twice as many 20-flight streams as `1_43` (44 vs 22; 28 gained, 6 lost, p < 0.001); its 9M
checkpoint scored higher still (49). Against arm D it is ahead but not significantly (44 vs 37,
p = 0.28). On long streams it keeps unfiltered streams clean about as often as the champion but
loses one feasible 60-flight stream, like D: its last 10M steps were on 20-flight streams too.
