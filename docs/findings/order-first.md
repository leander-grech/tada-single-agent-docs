# Order first? (Phase 0)

!!! abstract "Summary"
    Hypothesis: the agent fails because it does not establish the AMAN landing order early enough,
    so forcing the order first should help. **The data say no**, on all 16 windowed agents tested.
    On the same scenario, attempts that solve it do not have better early order than attempts that
    fail (one agent, `1_43`, is the exception). Forcing the order with an inference-time override
    lowers the share of flights on time for every agent, and loses solved streams or separation
    significantly for most. Inversions matter for the *actual* losses of separation, but those are
    predicted a median 12–23 minutes ahead, so they are not a problem of seeing the order too late.

Data: `analysis/2026-09-27_phase0_order_first/` (`order_first.py`, `order_first_report.py`,
`report.txt`). Every windowed agent from `1_32` to `1_48`; 100 validation seeds, the deterministic
policy plus 9 sampled attempts each (1000 episodes per agent), plus the override runs. The tables
below are generated from `report.txt`, so a newly tested agent appears in them automatically; the
[coverage page](../coverage.md) tracks which agent has had which test.

## The tests

| test | question |
|---|---|
| T0 | Where do AMAN-order inversions come from: present at entry, or created later, and on which steps? |
| T1 | On the same seed, do attempts that solve it have fewer early inversions than attempts that fail? Pairing within a seed removes scenario difficulty. Early = the first 20 min; only inversions whose earlier flight is ≥ 600 s from landing. |
| T2 | Are predicted and actual losses of separation between pairs that were out of order in the 20 min before? |
| T3 | Does an **order-first override** help? Among the policy's 4 most likely actions, take the one leaving the fewest predicted inversions (ties keep the policy's choice; never trade into an immediate loss of separation). Paired against the plain deterministic policy. |

## Results

**T0: inversions come from entry or from clearances, never from anything else.** For the early
agents (`1_32`–`1_39`) 63–76% of inversion episodes are present when both flights first come under
control. The from-scratch agents and their fine-tunes (`1_40`–`1_48`) create more of their own:
only 31–57% are inherited, down to 31% for `1_48`. For every agent, **100%** of the inversions
that arise later arise on a step that issued a clearance (71–93% of all steps issue one). 3–10%
are still unresolved at the end of the episode.

**T1: early order does not predict success on the same scenario.**

<!-- gen:phase0 test=T1 -->
<div class="tada-table-wrap"><table class="tada-table tada-sortable"><thead><tr><th>model</th><th>seeds with both solving and failing attempts</th><th>solving attempt has fewer early inversions</th><th>within-seed r, early inversions vs on time</th></tr></thead><tbody><tr><td><a href="../../models/1_32/"><code>1_32</code></a></td><td>20</td><td>40% (p = 0.503)</td><td>+0.13</td></tr><tr><td><a href="../../models/1_33/"><code>1_33</code></a></td><td>25</td><td>52% (p = 1)</td><td>+0.21</td></tr><tr><td><a href="../../models/1_34/"><code>1_34</code></a></td><td>25</td><td>56% (p = 0.69)</td><td>+0.07</td></tr><tr><td><a href="../../models/1_35/"><code>1_35</code></a></td><td>24</td><td>54% (p = 0.839)</td><td>−0.00</td></tr><tr><td><a href="../../models/1_36/"><code>1_36</code></a></td><td>47</td><td>38% (p = 0.144)</td><td>+0.04</td></tr><tr><td><a href="../../models/1_37/"><code>1_37</code></a></td><td>31</td><td>55% (p = 0.72)</td><td>+0.16</td></tr><tr><td><a href="../../models/1_38/"><code>1_38</code></a></td><td>49</td><td>47% (p = 0.775)</td><td>+0.11</td></tr><tr><td><a href="../../models/1_39/"><code>1_39</code></a></td><td>43</td><td>53% (p = 0.761)</td><td>+0.14</td></tr><tr><td><a href="../../models/1_40/"><code>1_40</code></a></td><td>24</td><td>62% (p = 0.307)</td><td>+0.07</td></tr><tr><td><a href="../../models/1_41/"><code>1_41</code></a></td><td>28</td><td>54% (p = 0.851)</td><td>+0.15</td></tr><tr><td><a href="../../models/1_42/"><code>1_42</code></a></td><td>25</td><td>60% (p = 0.424)</td><td>+0.15</td></tr><tr><td><a href="../../models/1_43/"><code>1_43</code></a></td><td>21</td><td>81% (p = 0.0072)</td><td>+0.02</td></tr><tr><td><a href="../../models/1_44/"><code>1_44</code></a></td><td>34</td><td>53% (p = 0.864)</td><td>−0.00</td></tr><tr><td><a href="../../models/1_46/"><code>1_46</code></a></td><td>40</td><td>57% (p = 0.43)</td><td>+0.01</td></tr><tr><td><a href="../../models/1_47/"><code>1_47</code></a></td><td>40</td><td>42% (p = 0.43)</td><td>+0.02</td></tr><tr><td><a href="../../models/1_48/"><code>1_48</code></a></td><td>47</td><td>51% (p = 1)</td><td>+0.09</td></tr></tbody></table></div>

<!-- /gen -->

For 15 of the 16 agents the solving attempt has fewer early inversions on 38–62% of seeds, no
different from a coin flip. The exception is `1_43`: 81% of 21 seeds (p = 0.007). With 16 agents
tested, one p-value that low is not strong evidence on its own (a Bonferroni threshold would be
0.003), and its within-seed correlation (r = +0.02) shows no link either. The correlation is
positive for 14 agents: attempts with more early inversions are, if anything, slightly *more* on
time.

**T2: predicted conflicts are only mildly associated with order; actual losses strongly.**

<!-- gen:phase0 test=T2 -->
<div class="tada-table-wrap"><table class="tada-table tada-sortable"><thead><tr><th>model</th><th>predicted losses: out of order before, vs base rate</th><th>predicted losses between AMAN neighbours</th><th>actual losses: out of order before</th><th>actual: at entry / put out of order later</th><th>actual: first predicted, median min before</th><th>actual never predicted</th></tr></thead><tbody><tr><td><a href="../../models/1_32/"><code>1_32</code></a></td><td>33% vs 18.1% (1.8×)</td><td>61%</td><td>59% of 184</td><td>37% / 22%</td><td>16.6</td><td>0</td></tr><tr><td><a href="../../models/1_33/"><code>1_33</code></a></td><td>34% vs 17.8% (1.9×)</td><td>62%</td><td>49% of 164</td><td>32% / 17%</td><td>19.8</td><td>0</td></tr><tr><td><a href="../../models/1_34/"><code>1_34</code></a></td><td>37% vs 20.9% (1.8×)</td><td>57%</td><td>66% of 138</td><td>51% / 14%</td><td>18.7</td><td>0</td></tr><tr><td><a href="../../models/1_35/"><code>1_35</code></a></td><td>37% vs 23.1% (1.6×)</td><td>56%</td><td>59% of 81</td><td>33% / 26%</td><td>19.1</td><td>0</td></tr><tr><td><a href="../../models/1_36/"><code>1_36</code></a></td><td>39% vs 30.3% (1.3×)</td><td>50%</td><td>66% of 70</td><td>26% / 40%</td><td>14.7</td><td>0</td></tr><tr><td><a href="../../models/1_37/"><code>1_37</code></a></td><td>37% vs 23.7% (1.5×)</td><td>56%</td><td>63% of 57</td><td>40% / 23%</td><td>22.5</td><td>0</td></tr><tr><td><a href="../../models/1_38/"><code>1_38</code></a></td><td>39% vs 29.6% (1.3×)</td><td>50%</td><td>87% of 61</td><td>36% / 51%</td><td>16.5</td><td>0</td></tr><tr><td><a href="../../models/1_39/"><code>1_39</code></a></td><td>36% vs 23.9% (1.5×)</td><td>57%</td><td>73% of 62</td><td>47% / 26%</td><td>17.8</td><td>0</td></tr><tr><td><a href="../../models/1_40/"><code>1_40</code></a></td><td>35% vs 23.7% (1.5×)</td><td>56%</td><td>80% of 87</td><td>33% / 47%</td><td>16.7</td><td>0</td></tr><tr><td><a href="../../models/1_41/"><code>1_41</code></a></td><td>34% vs 24.3% (1.4×)</td><td>57%</td><td>86% of 78</td><td>35% / 51%</td><td>14.2</td><td>0</td></tr><tr><td><a href="../../models/1_42/"><code>1_42</code></a></td><td>34% vs 23.1% (1.5×)</td><td>58%</td><td>83% of 87</td><td>21% / 62%</td><td>17.0</td><td>2</td></tr><tr><td><a href="../../models/1_43/"><code>1_43</code></a></td><td>31% vs 22.5% (1.4×)</td><td>59%</td><td>87% of 84</td><td>29% / 58%</td><td>16.2</td><td>0</td></tr><tr><td><a href="../../models/1_44/"><code>1_44</code></a></td><td>33% vs 21.3% (1.6×)</td><td>60%</td><td>77% of 69</td><td>33% / 43%</td><td>18.8</td><td>0</td></tr><tr><td><a href="../../models/1_46/"><code>1_46</code></a></td><td>33% vs 22.4% (1.5×)</td><td>58%</td><td>89% of 57</td><td>26% / 63%</td><td>15.9</td><td>0</td></tr><tr><td><a href="../../models/1_47/"><code>1_47</code></a></td><td>34% vs 23.7% (1.4×)</td><td>56%</td><td>76% of 66</td><td>36% / 39%</td><td>17.7</td><td>1</td></tr><tr><td><a href="../../models/1_48/"><code>1_48</code></a></td><td>32% vs 21.6% (1.5×)</td><td>59%</td><td>82% of 50</td><td>26% / 56%</td><td>11.9</td><td>0</td></tr></tbody></table></div>

<!-- /gen -->

Predicted losses of separation are between pairs that were out of order 1.3–1.9 times as often
as the base rate. Actual losses are between such pairs in 49–89% of cases. Almost all were
predicted beforehand: 3 actual losses in all were never predicted, 2 for `1_42` and 1 for `1_47`.

**T3: forcing order first hurts.** Override at threshold 0 s against the plain deterministic
policy, paired on the same 100 seeds. **Bold**: |z| ≥ 1.96, or on time more than 1.96 standard
errors from zero.

<!-- gen:phase0 test=T3 -->
<div class="tada-table-wrap"><table class="tada-table tada-sortable"><thead><tr><th>model</th><th>solved</th><th>hard-solved</th><th>separation lost</th><th>flights on time</th><th>overrides per episode</th></tr></thead><tbody><tr><td><a href="../../models/1_32/"><code>1_32</code></a></td><td>29 → 19 (+3 / −13, <strong>z −2.50</strong>)</td><td>4 → 3 (+2 / −3, z −0.45)</td><td>21 → 23 (+9 / −7, z +0.50)</td><td><strong>−0.070 (SE 0.017)</strong></td><td>16.8</td></tr><tr><td><a href="../../models/1_33/"><code>1_33</code></a></td><td>20 → 14 (+4 / −10, z −1.60)</td><td>1 → 2 (+2 / −1, z +0.58)</td><td>17 → 21 (+9 / −5, z +1.07)</td><td><strong>−0.075 (SE 0.014)</strong></td><td>18.0</td></tr><tr><td><a href="../../models/1_34/"><code>1_34</code></a></td><td>21 → 11 (+2 / −12, <strong>z −2.67</strong>)</td><td>0 → 0 (+0 / −0, z +0.00)</td><td>13 → 19 (+9 / −3, z +1.73)</td><td><strong>−0.080 (SE 0.023)</strong></td><td>21.2</td></tr><tr><td><a href="../../models/1_35/"><code>1_35</code></a></td><td>24 → 17 (+5 / −12, z −1.70)</td><td>0 → 1 (+1 / −0, z +1.00)</td><td>8 → 11 (+4 / −1, z +1.34)</td><td><strong>−0.083 (SE 0.013)</strong></td><td>25.5</td></tr><tr><td><a href="../../models/1_36/"><code>1_36</code></a></td><td>65 → 52 (+4 / −17, <strong>z −2.84</strong>)</td><td>29 → 20 (+5 / −14, <strong>z −2.06</strong>)</td><td>9 → 5 (+1 / −5, z −1.63)</td><td><strong>−0.033 (SE 0.012)</strong></td><td>40.8</td></tr><tr><td><a href="../../models/1_37/"><code>1_37</code></a></td><td>34 → 22 (+2 / −14, <strong>z −3.00</strong>)</td><td>1 → 4 (+3 / −0, z +1.73)</td><td>4 → 12 (+10 / −2, <strong>z +2.31</strong>)</td><td><strong>−0.104 (SE 0.015)</strong></td><td>23.5</td></tr><tr><td><a href="../../models/1_38/"><code>1_38</code></a></td><td>63 → 51 (+2 / −14, <strong>z −3.00</strong>)</td><td>24 → 21 (+6 / −9, z −0.77)</td><td>3 → 8 (+5 / −0, <strong>z +2.24</strong>)</td><td><strong>−0.052 (SE 0.013)</strong></td><td>36.9</td></tr><tr><td><a href="../../models/1_39/"><code>1_39</code></a></td><td>40 → 32 (+5 / −13, z −1.89)</td><td>5 → 3 (+1 / −3, z −1.00)</td><td>5 → 10 (+7 / −2, z +1.67)</td><td><strong>−0.084 (SE 0.020)</strong></td><td>27.8</td></tr><tr><td><a href="../../models/1_40/"><code>1_40</code></a></td><td>22 → 16 (+2 / −8, z −1.90)</td><td>2 → 6 (+4 / −0, <strong>z +2.00</strong>)</td><td>9 → 17 (+12 / −4, <strong>z +2.00</strong>)</td><td><strong>−0.066 (SE 0.022)</strong></td><td>30.6</td></tr><tr><td><a href="../../models/1_41/"><code>1_41</code></a></td><td>14 → 15 (+5 / −4, z +0.33)</td><td>2 → 1 (+1 / −2, z −0.58)</td><td>9 → 13 (+6 / −2, z +1.41)</td><td><strong>−0.104 (SE 0.017)</strong></td><td>28.4</td></tr><tr><td><a href="../../models/1_42/"><code>1_42</code></a></td><td>16 → 14 (+5 / −7, z −0.58)</td><td>1 → 1 (+0 / −0, z +0.00)</td><td>7 → 15 (+12 / −4, <strong>z +2.00</strong>)</td><td><strong>−0.085 (SE 0.019)</strong></td><td>28.9</td></tr><tr><td><a href="../../models/1_43/"><code>1_43</code></a></td><td>22 → 16 (+4 / −10, z −1.60)</td><td>6 → 4 (+1 / −3, z −1.00)</td><td>6 → 13 (+8 / −1, <strong>z +2.33</strong>)</td><td><strong>−0.077 (SE 0.012)</strong></td><td>23.8</td></tr><tr><td><a href="../../models/1_44/"><code>1_44</code></a></td><td>37 → 34 (+5 / −8, z −0.83)</td><td>13 → 8 (+1 / −6, z −1.89)</td><td>6 → 13 (+8 / −1, <strong>z +2.33</strong>)</td><td><strong>−0.047 (SE 0.011)</strong></td><td>27.2</td></tr><tr><td><a href="../../models/1_46/"><code>1_46</code></a></td><td>44 → 42 (+6 / −8, z −0.53)</td><td>13 → 12 (+5 / −6, z −0.30)</td><td>7 → 10 (+8 / −5, z +0.83)</td><td><strong>−0.039 (SE 0.018)</strong></td><td>26.8</td></tr><tr><td><a href="../../models/1_47/"><code>1_47</code></a></td><td>36 → 37 (+9 / −8, z +0.24)</td><td>9 → 12 (+7 / −4, z +0.90)</td><td>8 → 6 (+4 / −6, z −0.63)</td><td><strong>−0.039 (SE 0.017)</strong></td><td>33.2</td></tr><tr><td><a href="../../models/1_48/"><code>1_48</code></a></td><td>48 → 40 (+6 / −14, z −1.79)</td><td>21 → 25 (+12 / −8, z +0.89)</td><td>4 → 10 (+8 / −2, z +1.90)</td><td><strong>−0.071 (SE 0.015)</strong></td><td>25.8</td></tr></tbody></table></div>

<!-- /gen -->

- **Flights on time** fall for all 16 agents, significantly for every one (−0.033 to −0.104).
- **Solved streams** fall for 14 agents, significantly for 5 (`1_32`, `1_34`, `1_36`, `1_37`,
  `1_38`). They rise by one stream, not significantly, for `1_41` and `1_47`.
- **Losses of separation** rise for 14 agents, significantly for 6 (`1_37`, `1_38`, `1_40`,
  `1_42`, `1_43`, `1_44`). They fall, not significantly, for `1_36` and `1_47`.
- **Hard-solved** moves either way: significantly down for `1_36` (29 → 20), significantly up for
  `1_40` (2 → 6).
- The override fires on 17–41 decisions per episode.

With the threshold at 600 s (only inversions still far from landing) the direction is the same,
though which agents cross significance changes. On time falls significantly for all 16, and solved
streams never rise (14 fall, 2 tie). Losses of separation rise significantly for `1_37`, `1_38` and
`1_48`; for `1_48`, 4 → 16 (z +3.21). `report.txt` has both thresholds.

## What it means

- The policy's own ordering is not the bottleneck, and overriding it with a greedy order rule
  trades away both precision and safety.
- For `1_38` in particular, most actual losses of separation involve a pair it put out of order
  after entry (51%), and it saw each one coming a median 16.5 min ahead. The later agents look the
  same: 39–63% put out of order after entry for `1_40`–`1_48`, seen a median 12–19 min ahead. The remaining losses are
  a control problem on pairs the agent can see, not a perception problem.
- This closes Phase 0 of the "order first" idea. See the [roadmap](../roadmap.md).
