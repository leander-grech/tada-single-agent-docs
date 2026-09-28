# Over-capacity scenarios

!!! abstract "Summary"
    Some generated scenarios cannot be flown safely at all: flights start so early that absorbing
    the delay would take tens of minutes of holding that the airspace does not have. A handful of
    validation seeds have never been solved by any model, attempt or lookahead, and the worst have
    never been flown without a loss of separation. **49 of the 100 validation seeds** hold a flight
    more than 650 s early at t = 0, the generator's own cap, and they held 16 of `1_33`'s 17
    deterministic losses. On long streams such waves are the norm, not the exception: only 4.5% of
    60-flight and 0.5% of 100-flight generated streams are free of them, and on those the champion
    never loses separation ([Long streams](long-streams.md)). Separation rates should be reported with
    this split in mind; the scenario filter does not catch these seeds.

## Scenarios no agent has flown { #never-solved }

<!-- gen:never-solved -->
17 of the 100 validation seeds were never solved in any of the 16 900 deterministic, sampled or lookahead episodes that 15 windowed models have flown on them (20-flight evaluations, 10 attempts, lookahead).

<table class="tada-table tada-sortable"><thead><tr><th>seed</th><th>earliest flight at t = 0</th><th>predicted losses at t = 0</th><th>episodes flown</th><th>episodes without a loss</th><th>best on-time rate</th></tr></thead><tbody><tr><td>1159417075</td><td>2 550 s (42.5 min)</td><td>9</td><td>169</td><td>2</td><td>0.25</td></tr><tr><td>1566942273</td><td>2 278 s (38.0 min)</td><td>6</td><td>169</td><td>29</td><td>0.20</td></tr><tr><td>1947382419</td><td>1 889 s (31.5 min)</td><td>11</td><td>169</td><td>23</td><td>0.40</td></tr><tr><td>1123251507</td><td>1 690 s (28.2 min)</td><td>8</td><td>169</td><td>97</td><td>0.50</td></tr><tr><td>1351531223</td><td>1 488 s (24.8 min)</td><td>12</td><td>169</td><td>64</td><td>0.55</td></tr><tr><td>1595180635</td><td>1 439 s (24.0 min)</td><td>7</td><td>169</td><td>98</td><td>0.70</td></tr><tr><td>1631775357</td><td>1 392 s (23.2 min)</td><td>6</td><td>169</td><td>122</td><td>0.60</td></tr><tr><td>1051454923</td><td>1 210 s (20.2 min)</td><td>3</td><td>169</td><td>133</td><td>0.75</td></tr><tr><td>941975480</td><td>1 104 s (18.4 min)</td><td>4</td><td>169</td><td>138</td><td>0.95</td></tr><tr><td>1193448329</td><td>905 s (15.1 min)</td><td>6</td><td>169</td><td>131</td><td>0.95</td></tr><tr><td>373399426</td><td>628 s (10.5 min)</td><td>2</td><td>169</td><td>169</td><td>0.95</td></tr><tr><td>1051802512</td><td>563 s (9.4 min)</td><td>5</td><td>169</td><td>169</td><td>0.95</td></tr><tr><td>735034881</td><td>543 s (9.1 min)</td><td>4</td><td>169</td><td>165</td><td>0.95</td></tr><tr><td>999829240</td><td>522 s (8.7 min)</td><td>8</td><td>169</td><td>152</td><td>0.95</td></tr><tr><td>1715412119</td><td>335 s (5.6 min)</td><td>3</td><td>169</td><td>169</td><td>0.95</td></tr><tr><td>1970753705</td><td>305 s (5.1 min)</td><td>1</td><td>169</td><td>167</td><td>0.90</td></tr><tr><td>1392783743</td><td>186 s (3.1 min)</td><td>1</td><td>169</td><td>169</td><td>0.95</td></tr></tbody></table>

No seed that any episode solved had a flight more than 1 254 s (20.9 min) early; 49 of the 100 have one more than 650 s early. Leads and predicted conflicts: `analysis/2026-09-27_scratch/validation_seed_capacity.csv`.

<!-- /gen -->

*Earliest flight* is how early the most-early flight would arrive if nothing were done, from the
do-nothing prediction the agent sees at t = 0. Episodes are pooled over every windowed model's
20-flight evaluations (deterministic, 10 attempts, lookahead).

The worst seed, 1159417075, starts with its earliest flight 42.5 minutes ahead of its slot. In all
those episodes it was flown without a loss of separation exactly once, by a sampled attempt of
`1_40` that delayed every flight: none landed on time, the worst 2 375 s off. There, separation
can be bought only with all of the precision.

## How the best agents do, over 10 attempts { #champion-attempts }

Every validation seed, flown by the champion and its closest rivals: once deterministically and 9
more times with sampled actions, grouped by how early the earliest flight is at t = 0.

<!-- gen:capacity-bands models=1_38,1_36,1_46,1_44,1_37 -->
<table class="tada-table tada-bands"><thead><tr><th>model</th><th>earliest flight</th><th>seeds</th><th>solved, deterministic</th><th>lost, deterministic</th><th>solved in 1 of 10 attempts</th><th>lost, best attempt</th><th>on time, best attempt</th></tr></thead><tbody><tr class="tada-band-first"><td><a href="../../models/1_38/">1_38</a></td><td>≤ 650 s (within cap)</td><td>51</td><td>34</td><td>0</td><td>41</td><td>0</td><td>0.988</td></tr><tr><td></td><td>650–900 s</td><td>21</td><td>18</td><td>0</td><td>21</td><td>0</td><td>1.000</td></tr><tr><td></td><td>900–1 200 s</td><td>19</td><td>11</td><td>0</td><td>14</td><td>0</td><td>0.982</td></tr><tr><td></td><td>over 1 200 s</td><td>9</td><td>0</td><td>3</td><td>0</td><td>2</td><td>0.467</td></tr><tr class="tada-band-first"><td><a href="../../models/1_36/">1_36</a></td><td>≤ 650 s (within cap)</td><td>51</td><td>37</td><td>0</td><td>42</td><td>0</td><td>0.989</td></tr><tr><td></td><td>650–900 s</td><td>21</td><td>19</td><td>0</td><td>21</td><td>0</td><td>1.000</td></tr><tr><td></td><td>900–1 200 s</td><td>19</td><td>9</td><td>1</td><td>16</td><td>0</td><td>0.989</td></tr><tr><td></td><td>over 1 200 s</td><td>9</td><td>0</td><td>8</td><td>1</td><td>2</td><td>0.522</td></tr><tr class="tada-band-first"><td><a href="../../models/1_46/">1_46</a></td><td>≤ 650 s (within cap)</td><td>51</td><td>27</td><td>1</td><td>37</td><td>0</td><td>0.979</td></tr><tr><td></td><td>650–900 s</td><td>21</td><td>14</td><td>1</td><td>16</td><td>0</td><td>0.971</td></tr><tr><td></td><td>900–1 200 s</td><td>19</td><td>3</td><td>2</td><td>3</td><td>0</td><td>0.850</td></tr><tr><td></td><td>over 1 200 s</td><td>9</td><td>0</td><td>3</td><td>0</td><td>1</td><td>0.278</td></tr><tr class="tada-band-first"><td><a href="../../models/1_44/">1_44</a></td><td>≤ 650 s (within cap)</td><td>51</td><td>29</td><td>0</td><td>38</td><td>0</td><td>0.982</td></tr><tr><td></td><td>650–900 s</td><td>21</td><td>8</td><td>1</td><td>13</td><td>0</td><td>0.964</td></tr><tr><td></td><td>900–1 200 s</td><td>19</td><td>0</td><td>1</td><td>0</td><td>0</td><td>0.713</td></tr><tr><td></td><td>over 1 200 s</td><td>9</td><td>0</td><td>4</td><td>0</td><td>2</td><td>0.289</td></tr><tr class="tada-band-first"><td><a href="../../models/1_37/">1_37</a></td><td>≤ 650 s (within cap)</td><td>51</td><td>25</td><td>0</td><td>37</td><td>0</td><td>0.978</td></tr><tr><td></td><td>650–900 s</td><td>21</td><td>9</td><td>0</td><td>15</td><td>0</td><td>0.964</td></tr><tr><td></td><td>900–1 200 s</td><td>19</td><td>0</td><td>1</td><td>2</td><td>0</td><td>0.750</td></tr><tr><td></td><td>over 1 200 s</td><td>9</td><td>0</td><td>3</td><td>0</td><td>1</td><td>0.322</td></tr></tbody></table>

100 validation seeds, grouped by how early the earliest flight would arrive with no action (`analysis/2026-09-27_scratch/validation_seed_capacity.csv`). Deterministic policy plus 9 sampled attempts per seed; the best attempt is chosen by the objective. Sources: `analysis/2026-09-26_1_36_multipick/eval_cont/att10.csv`, `analysis/2026-09-26_1_36_multipick/eval/1_36_att10.csv`, `analysis/2026-09-27_scratch/backfill/eval/1_46_att10.csv`, `analysis/2026-09-27_scratch/backfill/eval/1_44_att10.csv`, `analysis/2026-09-26_1_36_multipick/eval_control/att10.csv`.

<!-- /gen -->

- **The generator's 650 s cap is not the champion's capacity.** With the earliest flight 650–900 s
  early, `1_38` solves almost every seed on its first, deterministic try and all of them within 10
  attempts, without a single loss of separation. `1_36` does the same.
- **Between 900 and 1 200 s it stays safe and mostly precise.** No loss of separation in any
  deterministic run or best attempt; it solves over half of these seeds, and where it misses, one to
  three flights are late.
- **Above about 1 200 s (20 min) nothing solves.** The single exception is `1_36` on the seed at
  the edge (1 254 s), once. Losses of separation concentrate here.
- **Only the fine-tuned reselection models carry the 900–1 200 s band.** The one-pick control
  `1_37`, and `1_44` and `1_46` (reselection, but trained from random weights), do respectably on
  seeds within the cap. In this band they solve almost nothing deterministically. Reselection
  alone is not enough: the long fine-tuned lineage is what handles these seeds.

### The champion on the hardest seeds

<!-- gen:hardest-seeds model=1_38 min_lead=900 -->
<div class="tada-table-wrap"><table class="tada-table tada-sortable"><thead><tr><th>seed</th><th>earliest flight</th><th>predicted losses at t = 0</th><th>deterministic</th><th>of 10 attempts: safe / solved</th><th>best attempt</th><th>lookahead</th></tr></thead><tbody><tr><td>1159417075</td><td>2 550 s</td><td>9</td><td><span class="tada-chip tada-chip--bad">lost</span> 3/20</td><td>0 / 0</td><td><span class="tada-chip tada-chip--bad">lost</span> 3/20, worst flight 133 s</td><td><span class="tada-chip tada-chip--bad">lost</span></td></tr><tr><td>1566942273</td><td>2 278 s</td><td>6</td><td><span class="tada-chip tada-chip--bad">lost</span> 3/20</td><td>0 / 0</td><td><span class="tada-chip tada-chip--bad">lost</span> 4/20, worst flight 719 s</td><td>safe, 1/20 on time</td></tr><tr><td>1947382419</td><td>1 889 s</td><td>11</td><td><span class="tada-chip tada-chip--bad">lost</span> 7/20</td><td>2 / 0</td><td>safe, 6/20 on time, worst flight 1 889 s</td><td>safe, 7/20 on time</td></tr><tr><td>1123251507</td><td>1 690 s</td><td>8</td><td>safe, 6/20 on time</td><td>3 / 0</td><td>safe, 8/20 on time, worst flight 1 691 s</td><td>safe, 5/20 on time</td></tr><tr><td>1351531223</td><td>1 488 s</td><td>12</td><td>safe, 3/20 on time</td><td>8 / 0</td><td>safe, 7/20 on time, worst flight 1 422 s</td><td>safe, 7/20 on time</td></tr><tr><td>1595180635</td><td>1 439 s</td><td>7</td><td>safe, 12/20 on time</td><td>4 / 0</td><td>safe, 12/20 on time, worst flight 1 439 s</td><td>safe, 8/20 on time</td></tr><tr><td>1631775357</td><td>1 392 s</td><td>6</td><td>safe, 8/20 on time</td><td>9 / 0</td><td>safe, 10/20 on time, worst flight 1 387 s</td><td>safe, 8/20 on time</td></tr><tr><td>398340369</td><td>1 254 s</td><td>11</td><td>safe, 18/20 on time</td><td>8 / 0</td><td>safe, 19/20 on time, worst flight 77 s</td><td>safe, 18/20 on time</td></tr><tr><td>1051454923</td><td>1 210 s</td><td>3</td><td>safe, 15/20 on time</td><td>10 / 0</td><td>safe, 15/20 on time, worst flight 1 093 s</td><td>safe, 8/20 on time</td></tr><tr><td>1461364854</td><td>1 141 s</td><td>6</td><td><span class="tada-chip tada-chip--ok">solved</span></td><td>9 / 3</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 56 s</td><td>safe, 17/20 on time</td></tr><tr><td>906164396</td><td>1 107 s</td><td>13</td><td>safe, 17/20 on time</td><td>10 / 0</td><td>safe, 18/20 on time, worst flight 395 s</td><td>safe, 19/20 on time</td></tr><tr><td>941975480</td><td>1 104 s</td><td>4</td><td>safe, 18/20 on time</td><td>10 / 0</td><td>safe, 18/20 on time, worst flight 112 s</td><td>safe, 16/20 on time</td></tr><tr><td>1136108454</td><td>1 074 s</td><td>4</td><td>safe, 18/20 on time</td><td>10 / 0</td><td>safe, 19/20 on time, worst flight 94 s</td><td>safe, 15/20 on time</td></tr><tr><td>1722989659</td><td>1 072 s</td><td>3</td><td><span class="tada-chip tada-chip--ok">solved</span></td><td>10 / 3</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 26 s</td><td>safe, 13/20 on time</td></tr><tr><td>999270936</td><td>1 065 s</td><td>4</td><td><span class="tada-chip tada-chip--ok">solved</span></td><td>10 / 4</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 59 s</td><td>safe, 19/20 on time</td></tr><tr><td>1137651678</td><td>1 053 s</td><td>4</td><td><span class="tada-chip tada-chip--ok">solved</span></td><td>10 / 4</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 53 s</td><td><span class="tada-chip tada-chip--ok">solved</span></td></tr><tr><td>1699226064</td><td>1 047 s</td><td>2</td><td><span class="tada-chip tada-chip--ok">solved</span></td><td>10 / 6</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 55 s</td><td>safe, 16/20 on time</td></tr><tr><td>1477278577</td><td>1 008 s</td><td>5</td><td>safe, 18/20 on time</td><td>10 / 0</td><td>safe, 19/20 on time, worst flight 120 s</td><td>safe, 19/20 on time</td></tr><tr><td>202363285</td><td>992 s</td><td>8</td><td><span class="tada-chip tada-chip--ok">solved</span></td><td>10 / 5</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 49 s</td><td><span class="tada-chip tada-chip--ok">solved</span></td></tr><tr><td>1840109255</td><td>977 s</td><td>4</td><td><span class="tada-chip tada-chip--ok">solved</span></td><td>10 / 7</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 60 s</td><td><span class="tada-chip tada-chip--ok">solved</span></td></tr><tr><td>415393687</td><td>969 s</td><td>6</td><td><span class="tada-chip tada-chip--ok">solved</span></td><td>9 / 2</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 27 s</td><td><span class="tada-chip tada-chip--ok">solved</span></td></tr><tr><td>1929338154</td><td>949 s</td><td>3</td><td><span class="tada-chip tada-chip--ok">solved</span></td><td>10 / 3</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 53 s</td><td><span class="tada-chip tada-chip--ok">solved</span></td></tr><tr><td>667779376</td><td>918 s</td><td>5</td><td>safe, 18/20 on time</td><td>10 / 2</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 59 s</td><td><span class="tada-chip tada-chip--ok">solved</span></td></tr><tr><td>390452952</td><td>910 s</td><td>9</td><td>safe, 19/20 on time</td><td>10 / 5</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 52 s</td><td>safe, 18/20 on time</td></tr><tr><td>196814233</td><td>906 s</td><td>3</td><td><span class="tada-chip tada-chip--ok">solved</span></td><td>10 / 6</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 28 s</td><td><span class="tada-chip tada-chip--ok">solved</span></td></tr><tr><td>1193448329</td><td>905 s</td><td>6</td><td>safe, 19/20 on time</td><td>10 / 0</td><td>safe, 19/20 on time, worst flight 77 s</td><td>safe, 15/20 on time</td></tr><tr><td>1554762903</td><td>905 s</td><td>9</td><td>safe, 17/20 on time</td><td>10 / 3</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 55 s</td><td>safe, 19/20 on time</td></tr><tr><td>599310825</td><td>901 s</td><td>1</td><td><span class="tada-chip tada-chip--ok">solved</span></td><td>9 / 5</td><td><span class="tada-chip tada-chip--ok">solved</span>, worst flight 30 s</td><td>safe, 19/20 on time</td></tr></tbody></table></div>

`1_38`, every validation seed whose earliest flight is more than 900 s early. Sources: `analysis/2026-09-26_1_36_multipick/eval_cont/att10.csv`, `analysis/2026-09-26_1_36_multipick/eval_cont/la4.csv`.

<!-- /gen -->

- **Three seeds are beyond it.** With the earliest flight 31–42 minutes early and 6–11 losses of
  separation already predicted at t = 0, `1_38` loses separation deterministically on all three.
  In 10 attempts it never flies the two worst safely. The lookahead flies two of the three
  safely, but with only 1 and 7 of 20 flights on time.
- **On the next tier (23–28 min early) it keeps everyone separated and gives up one flight.** On
  most of these seeds the best attempt's worst flight is off by almost exactly the seed's lead
  (for example 1 439 s on a seed whose earliest flight is 1 439 s early). The earliest flight
  lands about as early as it would have with no action at all, and the agent protects the rest of
  the stream. This is an inference from the numbers, not something the evaluation records
  directly.
- **The hardest seed it solves** has its earliest flight 1 141 s (19 min) early: solved
  deterministically and by 3 of its 10 attempts.

### The champion's solutions, rendered

Its hardest solve: the earliest flight 19 minutes early, all 20 on time.

<!-- gen:render file=1_38_overcap_solved_deterministic_seed1461364854.mp4 -->
<figure class="tada-render" title="metadata: render-meta/2026-09-28_1_38_overcapacity/1_38_overcap_solved_deterministic_seed1461364854_solutions.json">
<video controls preload="metadata" src="../../assets/renders/1_38_overcap_solved_deterministic_seed1461364854.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_38</span> (final_model.zip) · seed 1461364854 · earliest flight 1 141 s early · deterministic · 20 of 20 on time, worst 56 s, 157 clearances</figcaption>
</figure>
<!-- /gen -->

28 minutes early: the best of 10 attempts keeps every aircraft separated and lands all 20, but only
8 on time. Its worst flight is off by 1 691 s against the seed's 1 690 s lead, so that flight lands
about as early as it would have if nothing were done.

<!-- gen:render file=1_38_overcap_safe_best_seed1123251507.mp4 -->
<figure class="tada-render" title="metadata: render-meta/2026-09-28_1_38_overcapacity/1_38_overcap_safe_best_seed1123251507_solutions.json">
<video controls preload="metadata" src="../../assets/renders/1_38_overcap_safe_best_seed1123251507.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_38</span> (final_model.zip) · seed 1123251507 · earliest flight 1 690 s early · best of 10 attempts (attempt 9 of 10, chosen by the objective) · 8 of 20 on time, worst 1691 s, 90 clearances</figcaption>
</figure>
<!-- /gen -->

The worst seed, 42.5 minutes early with 9 losses of separation already predicted at t = 0: even the
best of 10 attempts loses separation, with 5 flights landed.

<!-- gen:render file=1_38_overcap_worst_best_seed1159417075.mp4 -->
<figure class="tada-render" title="metadata: render-meta/2026-09-28_1_38_overcapacity/1_38_overcap_worst_best_seed1159417075_solutions.json">
<video controls preload="metadata" src="../../assets/renders/1_38_overcap_worst_best_seed1159417075.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_38</span> (final_model.zip) · seed 1159417075 · earliest flight 2 550 s early · best of 10 attempts (attempt 9 of 10, chosen by the objective) · 3 of 20 on time, loss of separation at step 36, 52 clearances</figcaption>
</figure>
<!-- /gen -->

The other renders on this page are by earlier agents (`1_33`, `1_36`).

## How early is the earliest flight?

For each seed: how early the most-early flight would arrive if nothing were done, grouped by
`1_33`'s outcome over 10 attempts (`analysis/scenario_capacity.py`,
`analysis/2026-09-26_attempts/scenario_capacity.txt`):

| outcome over 10 attempts | seeds | largest early arrival, median | predicted losses at t = 0, median |
|---|---|---|---|
| solved at least once | 44 | 531 s | 3 |
| precision-bound | 51 | 839 s | 4 |
| **safety-bound** | 5 | **1 889 s** | **11** |

The deterministic policy lost separation on **16 of the 49** seeds that hold a flight more than
650 s early, against **1 of the other 51**. 650 s (`max_extra_ttl_s`) is not a hard limit: seeds
needing up to ~900 s were solved with speed and vectoring as well as the trombone. But the
safety-bound seeds need ~30 minutes of absorption and start with a pile-up already predicted.

<!-- gen:render file=1_33_safety_best_seed1159417075.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-26_renders_failed_1_33/1_33_safety_best_seed1159417075_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_33_safety_best_seed1159417075.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_33</span> (final_model.zip) · seed 1159417075 · best of 10 attempts (attempt 2 of 10, chosen by the objective) · 2 of 20 on time, loss of separation at step 12, 11 clearances</figcaption>
</figure>
<!-- /gen -->

At t = 0 in this seed every flight is predicted early, by up to 2 549 s, and the side view already
shows a string of predicted losses on final. Every attempt loses separation; the best one lasts to
step 12.

<!-- gen:render file=1_36_safety_best_seed1566942273.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-26_renders_failed_1_36/1_36_safety_best_seed1566942273_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_36_safety_best_seed1566942273.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_36</span> (final_model.zip) · seed 1566942273 · best of 10 attempts (attempt 4 of 10, chosen by the objective) · 2 of 20 on time, loss of separation at step 39, 65 clearances</figcaption>
</figure>
<!-- /gen -->

Seed 1566942273: one flight 38 minutes early and six losses of separation predicted at t = 0. Every
attempt of `1_36`, and of `1_35`, loses separation before step 40.

<!-- gen:render file=1_36_precision_best_seed1595180635.mp4 -->
<figure class="tada-render" title="metadata: analysis/2026-09-26_renders_failed_1_36/1_36_precision_best_seed1595180635_solutions.json · file verified identical">
<video controls preload="metadata" src="../../assets/renders/1_36_precision_best_seed1595180635.mp4"></video>
<figcaption><span class="tada-render__by">Rendered by 1_36</span> (final_model.zip) · seed 1595180635 · best of 10 attempts (attempt 7 of 10, chosen by the objective) · 14 of 20 on time, worst 1167 s, 164 clearances</figcaption>
</figure>
<!-- /gen -->

Precision-bound, seed 1595180635: safe, but at best 14 of 20 on time. One flight is 24 minutes
early at t = 0, far over the 650 s cap. `1_35`'s best attempt on this seed gets 8 of 20.

**Consequence.** The headline separation rate is largely a statement about scenario capacity, so it
should be reported split by feasibility. The scenario filter (no realised loss in the first ~270 s)
does not reject over-capacity scenarios; whether it should is an open item on the
[roadmap](../roadmap.md).

## Generated scenarios get harder down the queue

Under do-nothing, 20 seeds each (`analysis/2026-09-25_windowed_evals/`):

| flights | ETA gap | \|dev\| 1–10 | 11–20 | 21–30 | 31–40 |
|---|---|---|---|---|---|
| 20 | 251–279 s | 183 s | 368 s | | |
| 40 | 232–249 s | 224 s | 513 s | 687 s | **913 s** |

Landing spacing stays flat while the deviation to recover grows along the queue. The mechanism is
not established (knock-on delay down the trombone, or how the generator times spawns).

## Stability along a stream

`1_29` zero-shot vs `1_32`, 100 paired seeds, by queue position. *Landed* is the share of flights
that land at all (a loss of separation strands everything behind it); *on time | landed* is
precision among those that did.

| stream | queue position | landed (1_29 / 1_32) | on time \| landed | median \|dev\| (1_32) |
|---|---|---|---|---|
| 20 | 1–4 | 0.99 / 0.95 | 0.87 / 0.91 | 14 s |
| 20 | 9–12 | 0.87 / 0.84 | 0.80 / 0.81 | 15 s |
| 20 | 17–20 | 0.79 / 0.79 | 0.91 / 0.89 | 0 s |
| 40 | 1–8 | 0.95 / 0.94 | 0.85 / 0.88 | 14 s |
| 40 | 17–24 | 0.63 / 0.69 | 0.71 / 0.68 | 21 s |
| 40 | 25–32 | 0.47 / 0.58 | 0.63 / **0.57** | **40 s** |
| 40 | 33–40 | 0.38 / 0.47 | 0.70 / 0.68 | 15 s |

- **Within 20 flights the agent is stable:** precision is flat along the queue; the late-queue drop
  is entirely episodes ending in a loss of separation.
- **At 40 generated flights it is not:** most episodes lose separation and precision drifts (median
  deviation 40 s at positions 25–32). That is the backlog above.

**Stitched 2×20 streams** (`1_32`, same seeds, gap 120–900 s):

| `1_32`, 40 flights | flights 1–20: landed / on time \| landed | flights 21–40: landed / on time \| landed | separation lost |
|---|---|---|---|
| generated in one sequence | 0.85 / 0.80 | 0.55 / **0.63** | 53% |
| **stitched 2×20** | 0.90 / 0.84 | 0.68 / **0.81** | **41%** |

The second stitched segment is landed as precisely as the first (0.81 vs 0.84), so the collapse at
40 contiguous flights was the generator's backlog, not drift in the agent. What limits continuous
use is the per-stretch loss rate compounding: two independent 20-flight episodes at 21% each would
lose separation 1 − 0.79² ≈ 38% of the time, close to the 41% observed. Every later model is
scored on stitched streams as part of the standard battery. The current numbers are on the
[leaderboard](../models/index.md).

For 60- and 100-flight streams, with the over-capacity waves separated from the feasible ones, see
[Long streams](long-streams.md).
