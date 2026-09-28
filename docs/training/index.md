# Training: the from-scratch recipe

!!! abstract "Summary"
    `recipes/windowed_from_scratch.sh SEED ARM` trains the windowed agent from random weights in
    10M steps, with no checkpoint needed. Everything that defines the run is in the script: the
    design, the hyperparameters and the seed. With the same seed a run draws the same training
    scenarios and starts from the same weights. Score it while it trains with `track_windowed.py`
    and compare your curve with the reference runs. This page is the student guide; the
    [reference](reference.md) has every flag, and [compute](compute.md) has the hardware.

## 1. Set up

From `reinforcement_learning/single_agent_rllib/`, Python 3.12:

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r recipes/requirements-windowed.txt
pip install simulator/wheels/flight_simulator-0.2.81-cp312-cp312-manylinux_2_34_x86_64.whl
# optional, ~5 min: checks this machine computes what ours does
TADA_SEQUENCE_OBS=1 TADA_MAX_PICKS=2 JAX_PLATFORMS=cpu python tests/test_multi_pick.py
```

## 2. Train

```bash
recipes/windowed_from_scratch.sh 1 D      # SEED=1, ARM=D (the default)
```

| arm | what it trains |
|---|---|
| A | the design the fine-tuned models ended up with, from step 0, on stitched 2×20 streams |
| B | A with flat (un-ramped) sequence and conflict potentials |
| C | A with a traffic curriculum: 10-flight streams to 2.5M, 20-flight to 5.5M, stitched 2×20 to 10M |
| **D** (default) | the same curriculum without the stitched stage: 10-flight streams to 2.5M, then 20-flight streams to 10M |

**Which arm.** D gives the best 20-flight agent from scratch in the standard MDP; C is safer on
stitched and long streams. (Arm D in the release MDP, `1_50`, is more precise but loses separation
far more often; see [Training from scratch](../findings/curriculum.md).) Pick D unless long-stream safety matters more than 20-flight precision
([Training from scratch](../findings/curriculum.md)). Each has been run on one seed.

The design is fixed by environment variables read at import time:

| setting | value | meaning |
|---|---|---|
| `TADA_ACTION_SET` | `v2` | the [15 clearances](../how/actions.md) |
| `TADA_SEQUENCE_OBS` | `1` | [AMAN-sequence observations](../how/observations.md) |
| `TADA_MAX_PICKS` | `2` | [reselection](../how/actions.md#reselection) |

The script then runs `main_jax.py` with the windowed env, the [lexicographic
objective](../how/objective.md) (`--reward-mode outcome_pbrs`), stitched 2×20 streams with a
120–900 s gap, 32 workers, 10M steps, LR 3e-4 → 3e-5 (8% warm-up, cosine), entropy 0.01,
value coefficient 0.25, target KL 0.05, a checkpoint every 25k steps. Extra flags are passed through
and override the recipe (argparse keeps the last): `--total-timesteps 4096` makes a smoke test.

Output goes to `experiments/atc_run_1_<N>_scratch_<arm>_s<SEED>/`: checkpoints, VecNormalize,
TensorBoard, `run_meta.json`, and a `snapshot/` of the source packages.

## 3. Score it while it trains

In a second terminal:

```bash
python analysis/track_windowed.py --run experiments/atc_run_1_<N>_scratch_d_s1 --every 1000000 --workers 8
```

Every 1M steps it scores the newest checkpoint deterministically on the 100 validation seeds (which
training never draws), then the final model, appending to `<run>/track.csv`:
`step, solved, hard_solved, separation_lost, all_on_time, on_time, clearances`. The per-seed rows go
to `<run>/track_scores/`.

## 4. Compare with the reference runs

The same recipe on our hardware. Curves are on each card:

| run | arm, seed | status |
|---|---|---|
| [`1_40`](../models/1_40.md) | A, 1 | complete |
| [`1_42`](../models/1_42.md) | A, 2 | complete |
| [`1_41`](../models/1_41.md) | B, 1 | complete |
| [`1_43`](../models/1_43.md) | C, 1 | complete |
| [`1_44`](../models/1_44.md) | **D**, 1 | complete |

<!-- gen:compare models=scratch batteries=f20,s2x20,att10,la4 -->
<table class="tada-table tada-compare"><thead><tr><th>100 seeds, deterministic unless stated</th><th><a href="../models/1_40/">1_40</a></th><th><a href="../models/1_41/">1_41</a></th><th><a href="../models/1_42/">1_42</a></th><th><a href="../models/1_43/">1_43</a></th><th><a href="../models/1_44/">1_44</a></th><th><a href="../models/1_46/">1_46</a></th><th><a href="../models/1_47/">1_47</a></th><th><a href="../models/1_48/">1_48</a></th><th><a href="../models/1_50/">1_50</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th></tr></thead><tbody><tr><td>20-flight: solved</td><td>22</td><td>14</td><td>16</td><td>22</td><td>37</td><td>44</td><td>36</td><td>48</td><td>51</td></tr><tr><td>20-flight: hard-solved</td><td>2</td><td>2</td><td>1</td><td>6</td><td>13</td><td>13</td><td>9</td><td>21</td><td>26</td></tr><tr><td>20-flight: separation lost</td><td>9</td><td>9</td><td>7</td><td>6</td><td>6</td><td>7</td><td>8</td><td>4</td><td>20</td></tr><tr><td>20-flight: flights on time</td><td>0.779</td><td>0.793</td><td>0.790</td><td>0.801</td><td>0.817</td><td>0.852</td><td>0.849</td><td>0.863</td><td>0.844</td></tr><tr><td>20-flight: clearances / stream</td><td>161.9</td><td>158.1</td><td>155.8</td><td>140.6</td><td>153.7</td><td>158.7</td><td>180.5</td><td>158.2</td><td>136.9</td></tr><tr><td>20-flight: AMAN swaps / stream</td><td>0.98</td><td>0.60</td><td>0.62</td><td>1.05</td><td>1.07</td><td>0.56</td><td>0.86</td><td>0.60</td><td>0.01</td></tr><tr><td>stitched 2×20: solved</td><td>1</td><td>3</td><td>1</td><td>8</td><td>10</td><td>17</td><td>13</td><td>16</td><td>—</td></tr><tr><td>stitched 2×20: hard-solved</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>3</td><td>1</td><td>0</td><td>—</td></tr><tr><td>stitched 2×20: separation lost</td><td>13</td><td>21</td><td>21</td><td>11</td><td>17</td><td>8</td><td>8</td><td>6</td><td>—</td></tr><tr><td>stitched 2×20: flights on time</td><td>0.730</td><td>0.725</td><td>0.704</td><td>0.745</td><td>0.738</td><td>0.818</td><td>0.818</td><td>0.827</td><td>—</td></tr><tr><td>pass@10 (seeds)</td><td>38</td><td>34</td><td>37</td><td>34</td><td>51</td><td>56</td><td>57</td><td>62</td><td>—</td></tr><tr><td>separation lost, best of 10</td><td>0</td><td>2</td><td>1</td><td>1</td><td>2</td><td>1</td><td>0</td><td>1</td><td>—</td></tr><tr><td>with lookahead: solved</td><td>19</td><td>22</td><td>29</td><td>24</td><td>31</td><td>37</td><td>37</td><td>25</td><td>—</td></tr><tr><td>with lookahead: hard-solved</td><td>0</td><td>1</td><td>1</td><td>4</td><td>7</td><td>19</td><td>17</td><td>17</td><td>—</td></tr><tr><td>with lookahead: separation lost</td><td>7</td><td>2</td><td>5</td><td>1</td><td>4</td><td>4</td><td>1</td><td>2</td><td>—</td></tr><tr><td>with lookahead: flights on time</td><td>0.802</td><td>0.835</td><td>0.817</td><td>0.788</td><td>0.825</td><td>0.849</td><td>0.865</td><td>0.818</td><td>—</td></tr></tbody></table>

<!-- /gen -->

**Your numbers will not be bit-identical.** GPU arithmetic differs between machines. Compare
statistically, against the spread between our two arm-A seeds, which is large
([Findings → training from scratch](../findings/curriculum.md)). Arm D has one reference seed and
its last checkpoints are noisy (14, 26, 37 solved at 8, 9, 10M), so expect a wide spread there too.

## 5. Run the full battery

When training ends, score the final model the way every card is scored ([Evaluation
protocol](../evaluation.md)):

```bash
export TADA_SEQUENCE_OBS=1 TADA_MAX_PICKS=2
M=experiments/atc_run_1_<N>_scratch_d_s1/final_model.zip
python analysis/score_windowed.py --models $M --seeds 100 --attempts 9
python analysis/score_windowed.py --models $M --seeds 100 --segments 2 --gap 120 900
python analysis/score_windowed.py --models $M --seeds 100 --lookahead 4
```

## Time

~1 400 steps/s on a 32-core Threadripper with an RTX 4090 (2 h for 10M); a laptop with a GPU does
~300 steps/s (9 h). Without a GPU the PPO updates add several hours. Why per-core speed matters more
than core count: [Compute](compute.md).

## Fine-tuning instead

Every model up to `1_39` was trained by warm-starting from the previous one (`--init-weights`, a
critic warm-up, a 10× lower learning rate). Each card's *Reproduce* section gives its command, and
the [reference](reference.md#fine-tuning) explains why a warm start onto a new reward needs a
fine-tuning schedule.
