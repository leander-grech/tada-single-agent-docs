# Point merge

!!! abstract "Summary"
    **Zero-shot, the MXP agents are not safe on the BGY point merge** (`VALIDATION_USE_CASE_2`):
    they keep their sequencing but lose separation on 24–47 of 100 point-merge streams, against
    3–20 on MXP. **Trained on point merge, the agents are safe where the traffic allows it.** More
    than half of the point-merge validation seeds (52 of 100) are over capacity, and nearly every
    loss of separation of the two point-merge agents is on one of them. On the 48 feasible seeds,
    `1_53` (from scratch) loses none and lands 93% of flights on time, against 5 losses and 87% for
    the champion `1_38` zero-shot. Few streams are *solved* even so, because every one of 20 flights
    has to land within ±60 s. On stitched 2×20 point-merge streams both trained agents lose separation
    on most streams.

Data, in the code repo: zero-shot scores in `analysis/2026-09-28_release/zeroshot/` and
`analysis/2026-09-28_pms/eval/` (`<model>_pms_f20.*`); the point-merge runs' own evaluations in
`analysis/2026-09-28_pms/eval/`; the point-merge capacity of the 100 validation seeds in
`analysis/2026-09-28_pms/eval/pms_validation_capacity.csv`. Every agent is scored with
`analysis/score_windowed.py --use-case 2`: 100 validation seeds, 20-flight streams, deterministic.
The do-nothing rows issue no clearances on the same seeds and streams (`--models do-nothing`).

## Results

The table is generated from the evaluation files and lists every agent scored on point merge so
far, zero-shot and trained; the [coverage page](../coverage.md) shows which are still to do.
*Feasible seeds* are the validation seeds on which, flown do-nothing, no flight on point merge would
arrive more than 650 s early. The MXP columns are the same agent's own 20-flight MXP score, on the
same 100 seeds.

<!-- gen:zeroshot-pms -->
<div class="tada-table-wrap"><table class="tada-table tada-sortable"><thead><tr><th>agent</th><th>solved</th><th>hard-solved</th><th>separation lost</th><th>flights on time</th><th>landed of 20</th><th>landed in AMAN position</th><th>feasible seeds (48): solved</th><th>feasible: separation lost</th><th>feasible: on time</th><th>MXP: solved</th><th>MXP: separation lost</th></tr></thead><tbody><tr><td><a href="../../models/1_38/"><code>1_38</code></a></td><td>7</td><td>1</td><td>34</td><td>0.642</td><td>15.8</td><td>0.926</td><td>7</td><td>5</td><td>0.868</td><td>63</td><td>3</td></tr><tr><td><a href="../../models/1_44/"><code>1_44</code></a></td><td>4</td><td>1</td><td>32</td><td>0.569</td><td>16.5</td><td>0.937</td><td>4</td><td>4</td><td>0.817</td><td>37</td><td>6</td></tr><tr><td><a href="../../models/1_46/"><code>1_46</code></a></td><td>5</td><td>2</td><td>31</td><td>0.602</td><td>16.6</td><td>0.943</td><td>5</td><td>4</td><td>0.846</td><td>44</td><td>7</td></tr><tr><td><a href="../../models/1_48/"><code>1_48</code></a></td><td>5</td><td>0</td><td>24</td><td>0.599</td><td>17.0</td><td>0.932</td><td>5</td><td>3</td><td>0.826</td><td>48</td><td>4</td></tr><tr><td><a href="../../models/1_50/"><code>1_50</code></a></td><td>3</td><td>0</td><td>47</td><td>0.589</td><td>14.2</td><td>0.952</td><td>3</td><td>8</td><td>0.796</td><td>51</td><td>20</td></tr><tr><td><a href="../../models/1_51/"><code>1_51</code></a></td><td>1</td><td>0</td><td>25</td><td>0.565</td><td>16.8</td><td>0.907</td><td>1</td><td>6</td><td>0.759</td><td>27</td><td>11</td></tr><tr><td><a href="../../models/1_52/"><code>1_52</code></a> (trained on point merge)</td><td>8</td><td>2</td><td>34</td><td>0.682</td><td>15.9</td><td>0.972</td><td>7</td><td>1</td><td>0.923</td><td>—</td><td>—</td></tr><tr><td><a href="../../models/1_53/"><code>1_53</code></a> (trained on point merge)</td><td>12</td><td>2</td><td>28</td><td>0.705</td><td>16.8</td><td>0.979</td><td>11</td><td>0</td><td>0.932</td><td>—</td><td>—</td></tr><tr><td>do nothing (no clearances)</td><td>0</td><td>0</td><td>98</td><td>0.123</td><td>4.0</td><td>0.750</td><td>0</td><td>46</td><td>0.152</td><td>0</td><td>99</td></tr></tbody></table></div>

<!-- /gen -->

Counts are streams of 100 (of 48 in the feasible columns). *Landed in AMAN position*: mean share of
landed flights per stream that land in their AMAN sequence position.

### Point merge has less spare capacity

52 of the 100 validation seeds are over capacity on point merge, against 49 on MXP; 29 are feasible
on both. Of freshly generated candidates, 36.5% of 20-flight point-merge streams are feasible, and
12.8–13.4% of stitched 2×20 ones (the job's screens, `analysis/2026-09-28_pms/pool/` and `seeds/`).

### Zero-shot: sequencing transfers, separation does not

- Every MXP agent lands 91–95% of its landed flights in AMAN position on point merge, but loses
  separation 2 to 11 times as often as on MXP.
- The champion is not the safest here: `1_38` loses separation on 34 streams, `1_48` on 24, and the
  release-MDP `1_50` on 47. On the feasible seeds the MXP agents still lose 3–8.
- Doing nothing loses separation on 98 point-merge and 99 MXP streams, so none of the agents'
  safety on MXP came from easy traffic.

### Trained on point merge: `1_52` and `1_53`

Both train in the release MDP with the bust clawback, from pools of feasible point-merge streams
with the validation candidates removed: `1_52` fine-tunes `1_50` on stitched 2×20 streams, `1_53`
runs recipe arm D (10- then 20-flight streams) from scratch ([log](../log.md#run-1-52)).

- **Their losses sit on over-capacity seeds.** All 28 of `1_53`'s losses of separation and 33 of
  `1_52`'s 34 are on the 52 over-capacity seeds.
- **Where the traffic allows it, they are safe and more precise.** On the 48 feasible seeds `1_53`
  loses none and lands 0.932 of flights on time; `1_38` zero-shot loses 5 there, at 0.868. The
  on-time gain is significant (+0.065, paired SE 0.026); the 5 losses it avoids (5 fixed, none new)
  fall just short (p = 0.06). `1_52` loses 1 there, against 8 for its parent `1_50` zero-shot (8
  fixed, 1 new, p = 0.04).
- **Few streams are solved.** `1_53` solves 11 of the 48 feasible seeds. At 93% of flights on time, if
  flights missed independently, all 20 within ±60 s would happen on about a quarter of streams
  (0.93²⁰ ≈ 0.23).
- **Over all 100 seeds they are not significantly better than `1_38` zero-shot:** `1_53` solves 12
  against 7 (p = 0.18) and loses 28 against 34 (p = 0.36); `1_52` 8 and 34. Against its parent's
  zero-shot, `1_52` loses fewer (34 against 47, p = 0.01).
- **Stitched point-merge streams are still unsolved.** On stitched 2×20 streams `1_52` loses
  separation on 71 of 100 and `1_53` on 63, and each solves 1. On the feasible stitched sets
  feas40 and test51 they lose 1–4 streams and solve at most 4; the cards have the figures.
- **Lookahead buys safety, not precision:** with the 4-candidate lookahead both lose separation on
  18 streams instead of 28 and 34, and solve 3 and 6.

### Notes

- One point-merge stream, seed 438989805, outlasts the episode cap that training uses (200 steps
  per 20-flight segment), and the scorer flags it in each of the first zero-shot files (`analysis/2026-09-28_release/zeroshot/`). It changes no score: every
  agent lands all 20 flights on it, and do-nothing loses separation at step 55, before the cap.
  Scoring now runs every stream to its own horizon (code commit `cbead99`); MXP streams never reach
  the cap.
- The earlier point-merge agents, `1_24_pms` and `1_30_pms` ([archive](../archive/point-merge.md)),
  were 10-aircraft agents on an older simulator and are not comparable with these numbers.
