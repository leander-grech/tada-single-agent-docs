# Search at inference: lookahead and shields

!!! abstract "Summary"
    A critic-guided one-step lookahead is deployable: it needs only the simulator and 4 trial steps
    per 45 s decision. With a critic trained on the old dense reward (`1_33`) it bought safety by
    giving up most of the precision. With critics trained on the lexicographic objective it still
    trades precision for safety on one-pick policies. **On the reselection policies it keeps most
    of both**, and `1_38` with lookahead has the lowest separation rate of any configuration. A
    refusal shield, which vetoes clearances that create a near-term conflict, was net harmful in
    both tracks: it cannot fix losses that come from not acting.

## The lookahead

`analysis/lookahead.py`, `score_windowed.py --lookahead 4`:

1. At each decision take the policy's 4 most likely actions.
2. Try each for one real step on an exact snapshot of the environment.
3. Score it as r + γ·V(s′) with the policy's **own** critic, in the units it was trained in.
4. Act with the best.

Snapshot and restore are verified exact: episodes that try and undo 4 candidates per step are
identical to plain runs.

### With a critic from the old reward (`1_33`)

| `1_33`, 100 paired seeds | deterministic | with lookahead |
|---|---|---|
| separation lost | 17 | **7** (12 fixed, 2 new; McNemar z +2.67) |
| flights on time | 0.750 | 0.684 |
| all 20 on time | 20 | 4 |
| AMAN swaps per stream | 0.95 | 2.51 |

`1_33`'s critic learned a reward where the dense conflict cost dominated, so it trades timing for
conflict avoidance: by the objective, per seed it is better on 27 seeds and worse on 72
(`analysis/2026-09-26_lookahead/1_33_final_la4.csv`).

### With critics that learned the lexicographic objective

The same 4-candidate lookahead, deterministic vs lookahead, 100 seeds (numbers from the cards'
evaluation files):

<!-- gen:compare models=1_35,1_37,1_36,1_38,1_39 batteries=f20,la4 -->
<table class="tada-table tada-compare"><thead><tr><th>100 seeds, deterministic unless stated</th><th><a href="../../models/1_35/">1_35</a></th><th><a href="../../models/1_37/">1_37</a></th><th><a href="../../models/1_36/">1_36</a></th><th><a href="../../models/1_38/">1_38</a></th><th><a href="../../models/1_39/">1_39</a></th></tr></thead><tbody><tr><td>20-flight: solved</td><td>24</td><td>34</td><td>65</td><td>63</td><td>40</td></tr><tr><td>20-flight: hard-solved</td><td>0</td><td>1</td><td>29</td><td>24</td><td>5</td></tr><tr><td>20-flight: separation lost</td><td>8</td><td>4</td><td>9</td><td>3</td><td>5</td></tr><tr><td>20-flight: flights on time</td><td>0.826</td><td>0.832</td><td>0.916</td><td>0.927</td><td>0.858</td></tr><tr><td>20-flight: clearances / stream</td><td>86.8</td><td>80.6</td><td>128.3</td><td>121.9</td><td>125.2</td></tr><tr><td>20-flight: AMAN swaps / stream</td><td>0.85</td><td>1.02</td><td>0.07</td><td>0.54</td><td>0.66</td></tr><tr><td>with lookahead: solved</td><td>8</td><td>7</td><td>39</td><td>30</td><td>26</td></tr><tr><td>with lookahead: hard-solved</td><td>0</td><td>0</td><td>10</td><td>8</td><td>6</td></tr><tr><td>with lookahead: separation lost</td><td>5</td><td>7</td><td>2</td><td>1</td><td>5</td></tr><tr><td>with lookahead: flights on time</td><td>0.781</td><td>0.774</td><td>0.896</td><td>0.893</td><td>0.833</td></tr></tbody></table>

<!-- /gen -->

- On one-pick policies (`1_35`, `1_37`) search still buys safety with most of the precision; on the
  control it does not even buy safety.
- On reselection policies it keeps most of both. The critic that learned to use a second pick
  values the candidates well enough to steer without flattening the policy.

## The refusal shield

`render_policy.py`'s shield refuses a clearance that introduces a near-horizon conflict that
do-nothing would not, and issues the best clearance that passes instead (`next_best`). On `1_32`,
100 seeds (`analysis/2026-09-25_windowed_evals/f20_shield.csv`):

- on-time **−0.053** (SE 0.015, significant);
- **12 of the 29** solved seeds lost, 1 gained;
- separation 21 → 19: 7 losses fixed, 5 new, which is noise.

It can only veto clearances; losses that come from not acting are out of its reach. The same held
on the 10-aircraft track: for the tier-trained `1_16` the raw policy beat every shield variant
([`1_16`](../models/1_16.md), [Archive](../archive/ten-aircraft-tests.md#shield)): a policy
near-optimal for its own objective leaves little for a greedy override to recover.
