# Point merge, zero-shot

!!! abstract "Summary"
    Can an agent trained only on the MXP trombone fly the BGY point merge (`VALIDATION_USE_CASE_2`)
    unchanged? **Not safely.** The four MXP agents scored so far keep their sequencing (about 93% of
    landed flights in AMAN position) but lose separation on 24–34 of 100 point-merge streams, against
    3–7 on MXP, and solve at most 7. Doing nothing is equally hopeless on both scenarios (98 and 99
    losses of 100), so the gap is the agents', not the scenario's baseline. Point merge needs its
    own training, which is next.

Data: `analysis/2026-09-28_release/zeroshot/` in the code repo (`<model>_pms_f20.csv` and `.txt`,
`donothing_pms_f20.*`, `donothing_mxp_f20.*`). Each agent is scored exactly as trained, with
`analysis/score_windowed.py --use-case 2`: 100 validation seeds, 20-flight streams, deterministic.
The do-nothing rows issue no clearances on the same seeds and streams (`--models do-nothing`).

## Results

The table is generated from the evaluation files and lists every agent scored on point merge so far;
the [coverage page](../coverage.md) shows which are still to do. The MXP columns are the same
agent's own 20-flight score, on the same 100 seeds.

<!-- gen:zeroshot-pms -->
<div class="tada-table-wrap"><table class="tada-table tada-sortable"><thead><tr><th>agent</th><th>solved</th><th>hard-solved</th><th>separation lost</th><th>flights on time</th><th>landed of 20</th><th>landed in AMAN position</th><th>MXP: solved</th><th>MXP: separation lost</th></tr></thead><tbody><tr><td><a href="../../models/1_38/"><code>1_38</code></a></td><td>7</td><td>1</td><td>34</td><td>0.642</td><td>15.8</td><td>0.926</td><td>63</td><td>3</td></tr><tr><td><a href="../../models/1_44/"><code>1_44</code></a></td><td>4</td><td>1</td><td>32</td><td>0.569</td><td>16.5</td><td>0.937</td><td>37</td><td>6</td></tr><tr><td><a href="../../models/1_46/"><code>1_46</code></a></td><td>5</td><td>2</td><td>31</td><td>0.602</td><td>16.6</td><td>0.943</td><td>44</td><td>7</td></tr><tr><td><a href="../../models/1_48/"><code>1_48</code></a></td><td>5</td><td>0</td><td>24</td><td>0.599</td><td>17.0</td><td>0.932</td><td>48</td><td>4</td></tr><tr><td>do nothing (no clearances)</td><td>0</td><td>0</td><td>98</td><td>0.123</td><td>4.0</td><td>0.750</td><td>0</td><td>99</td></tr></tbody></table></div>

<!-- /gen -->

Counts are streams of 100. *Landed in AMAN position*: mean share of landed flights per stream that
land in their AMAN sequence position.

- **Sequencing transfers, separation does not.** Every agent lands 93–94% of its flights in AMAN
  position on point merge, but loses separation 4 to 11 times as often as on MXP.
- **The champion is not the safest here.** `1_38` solves the most point-merge streams (7) but has
  the most losses (34); `1_48` has the fewest (24).
- **Doing nothing gives no floor to speak of** on either scenario, so none of the agents' safety on
  MXP came from easy traffic.
- One point-merge stream, seed 438989805, outlasts the episode cap that training uses (200 steps
  per 20-flight segment), and the scorer flags it in every file. It changes no score: every agent
  lands all 20 flights on it, and do-nothing loses separation at step 55, before the cap. Scoring
  now runs every stream to its own horizon (code commit `cbead99`); MXP streams never reach the cap.

The earlier point-merge agents, `1_24_pms` and `1_30_pms` ([archive](../archive/point-merge.md)),
were 10-aircraft agents on an older simulator and are not comparable with these numbers.
