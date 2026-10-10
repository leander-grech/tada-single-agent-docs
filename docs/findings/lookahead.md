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

<!-- gen:compare models=all batteries=f20,la4 -->
<table class="tada-table tada-compare"><thead><tr><th>100 seeds, deterministic unless stated</th><th><a href="../../models/1_31/">1_31</a></th><th><a href="../../models/1_32/">1_32</a></th><th><a href="../../models/1_33/">1_33</a></th><th><a href="../../models/1_34/">1_34</a></th><th><a href="../../models/1_35/">1_35</a></th><th><a href="../../models/1_36/">1_36</a></th><th><a href="../../models/1_37/">1_37</a></th><th><a href="../../models/1_38/">1_38</a></th><th><a href="../../models/1_39/">1_39</a></th><th><a href="../../models/1_40/">1_40</a></th><th><a href="../../models/1_41/">1_41</a></th><th><a href="../../models/1_42/">1_42</a></th><th><a href="../../models/1_43/">1_43</a></th><th><a href="../../models/1_44/">1_44</a></th><th><a href="../../models/1_46/">1_46</a></th><th><a href="../../models/1_47/">1_47</a></th><th><a href="../../models/1_48/">1_48</a></th><th><a href="../../models/1_50/">1_50</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_51/">1_51</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_54/">1_54</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_55/">1_55</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_58/">1_58</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_61/">1_61</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_63/">1_63</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_65/">1_65</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_68/">1_68</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_70/">1_70</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_72/">1_72</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_74/">1_74</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_76/">1_76</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_78/">1_78</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_82/">1_82</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th><th><a href="../../models/1_101/">1_101</a><br><span class="tada-chip tada-chip--muted" title="Trained and scored in the release MDP: locked flights leave the window">release MDP</span></th></tr></thead><tbody><tr><td>20-flight: solved</td><td>1</td><td>29</td><td>20</td><td>21</td><td>24</td><td>65</td><td>34</td><td>63</td><td>40</td><td>22</td><td>14</td><td>16</td><td>22</td><td>37</td><td>44</td><td>36</td><td>48</td><td>51</td><td>27</td><td>47</td><td>40</td><td>56</td><td>40</td><td>47</td><td>47</td><td>50</td><td>48</td><td>47</td><td>54</td><td>59</td><td>60</td><td>64</td><td>66</td></tr><tr><td>20-flight: hard-solved</td><td>0</td><td>4</td><td>1</td><td>0</td><td>0</td><td>29</td><td>1</td><td>24</td><td>5</td><td>2</td><td>2</td><td>1</td><td>6</td><td>13</td><td>13</td><td>9</td><td>21</td><td>26</td><td>6</td><td>27</td><td>16</td><td>30</td><td>22</td><td>24</td><td>25</td><td>20</td><td>16</td><td>28</td><td>27</td><td>41</td><td>35</td><td>41</td><td>41</td></tr><tr><td>20-flight: separation lost</td><td>32</td><td>21</td><td>17</td><td>13</td><td>8</td><td>9</td><td>4</td><td>3</td><td>5</td><td>9</td><td>9</td><td>7</td><td>6</td><td>6</td><td>7</td><td>8</td><td>4</td><td>20</td><td>11</td><td>18</td><td>14</td><td>17</td><td>16</td><td>12</td><td>18</td><td>17</td><td>15</td><td>14</td><td>13</td><td>10</td><td>13</td><td>9</td><td>9</td></tr><tr><td>20-flight: flights on time</td><td>0.467</td><td>0.731</td><td>0.750</td><td>0.773</td><td>0.826</td><td>0.916</td><td>0.832</td><td>0.927</td><td>0.858</td><td>0.779</td><td>0.793</td><td>0.790</td><td>0.801</td><td>0.817</td><td>0.852</td><td>0.849</td><td>0.863</td><td>0.844</td><td>0.752</td><td>0.826</td><td>0.857</td><td>0.843</td><td>0.841</td><td>0.846</td><td>0.830</td><td>0.859</td><td>0.838</td><td>0.851</td><td>0.873</td><td>0.912</td><td>0.885</td><td>0.917</td><td>0.916</td></tr><tr><td>20-flight: clearances / stream</td><td>—</td><td>—</td><td>106.0</td><td>110.4</td><td>86.8</td><td>128.3</td><td>80.6</td><td>121.9</td><td>125.2</td><td>161.9</td><td>158.1</td><td>155.8</td><td>140.6</td><td>153.7</td><td>158.7</td><td>180.5</td><td>158.2</td><td>136.9</td><td>94.3</td><td>124.9</td><td>139.9</td><td>121.7</td><td>115.6</td><td>104.7</td><td>95.0</td><td>115.1</td><td>110.1</td><td>119.3</td><td>98.8</td><td>98.8</td><td>98.0</td><td>97.6</td><td>94.6</td></tr><tr><td>20-flight: AMAN swaps / stream</td><td>—</td><td>—</td><td>0.95</td><td>0.81</td><td>0.85</td><td>0.07</td><td>1.02</td><td>0.54</td><td>0.66</td><td>0.98</td><td>0.60</td><td>0.62</td><td>1.05</td><td>1.07</td><td>0.56</td><td>0.86</td><td>0.60</td><td>0.01</td><td>0.97</td><td>0.26</td><td>0.36</td><td>0.08</td><td>0.13</td><td>0.14</td><td>0.10</td><td>0.00</td><td>0.12</td><td>0.03</td><td>0.06</td><td>0.01</td><td>0.02</td><td>0.04</td><td>0.01</td></tr><tr><td>with lookahead: solved</td><td>—</td><td>7</td><td>4</td><td>15</td><td>8</td><td>39</td><td>7</td><td>30</td><td>26</td><td>19</td><td>22</td><td>29</td><td>24</td><td>31</td><td>37</td><td>37</td><td>25</td><td>24</td><td>21</td><td>—</td><td>—</td><td>—</td><td>10</td><td>13</td><td>20</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr><tr><td>with lookahead: hard-solved</td><td>—</td><td>1</td><td>1</td><td>2</td><td>0</td><td>10</td><td>0</td><td>8</td><td>6</td><td>0</td><td>1</td><td>1</td><td>4</td><td>7</td><td>19</td><td>17</td><td>17</td><td>10</td><td>7</td><td>—</td><td>—</td><td>—</td><td>3</td><td>5</td><td>7</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr><tr><td>with lookahead: separation lost</td><td>—</td><td>10</td><td>7</td><td>6</td><td>5</td><td>2</td><td>7</td><td>1</td><td>5</td><td>7</td><td>2</td><td>5</td><td>1</td><td>4</td><td>4</td><td>1</td><td>2</td><td>15</td><td>6</td><td>—</td><td>—</td><td>—</td><td>7</td><td>16</td><td>16</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr><tr><td>with lookahead: flights on time</td><td>—</td><td>0.687</td><td>0.684</td><td>0.766</td><td>0.781</td><td>0.896</td><td>0.774</td><td>0.893</td><td>0.833</td><td>0.802</td><td>0.835</td><td>0.817</td><td>0.788</td><td>0.825</td><td>0.849</td><td>0.865</td><td>0.818</td><td>0.824</td><td>0.779</td><td>—</td><td>—</td><td>—</td><td>0.781</td><td>0.762</td><td>0.800</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr></tbody></table>

<!-- /gen -->

- On one-pick policies (`1_32`–`1_35`, `1_37`) search buys safety with most of the precision; on
  the control `1_37` it does not even buy safety.
- On the fine-tuned reselection policies (`1_36`, `1_38`, `1_39`) it keeps most of both: fewer or
  equal losses of separation, a smaller loss of solved streams.
- On the reselection agents trained from scratch and their fine-tunes (`1_40`–`1_48`) the effect
  varies with the agent. On the weaker ones it often *adds* solved streams while cutting losses of
  separation (`1_41` and `1_42` most clearly; `1_47`'s losses fall from 8 to 1). On the stronger
  ones it costs solves for fewer losses, most sharply on `1_48`, which drops from 48 solved to 25
  while keeping most of its hard-solved streams. The release-MDP agents follow the same pattern:
  `1_50` 51 solved to 24, losses 20 to 15; `1_51` 27 to 21, losses 11 to 6. A weaker policy has more to gain from a critic that
  can overrule its first choice.

## Rollout search (MPC) { #rollout-search }

`analysis/rollout_search.py` (8 Oct): a receding-horizon search that rolls **whole episodes** out in
the simulator, instead of scoring one step with the critic. Every M = 10 decisions it snapshots the
environment and rolls K = 8 candidates to the end of the stream: the incumbent plan, the
deterministic policy and six sampled policy rollouts. It scores them by outcome (no loss of
separation, then flights within ±60 s, then total |deviation|, then clearances) and executes the
first 10 actions of the best. Ties keep the incumbent, so the realised outcome is never worse than an
earlier plan.

| 100 validation seeds, solved / LoS | deterministic | pass@11 | rollout search |
|---|---|---|---|
| TMB `1_65` | 47 / 18 | 72 / 5 | 83 / 4 |
| TMB `1_74` | 54 / 13 | 79 / 6 | 86 / 2 |
| TMB `1_76` | 59 / 10 | 85 / 4 | **88 / 2** |
| PMS `1_67` | 30 / 12 | 49 / 3 | 52 / 2 |
| PMS `1_75` | 38 / 9 | 52 / 1 | 56 / 0 |
| PMS `1_77` | 41 / 9 | 49 / 1 | **54 / 0** |

(The pass@11 LoS column counts seeds where *every* attempt lost separation.) The search never
loses a seed the deterministic policy solves. On TMB it costs about 16 rollouts per episode, roughly a
minute of one core per 2-hour stream, so it runs far faster than real time; it assumes the simulator
is a perfect model. Distilling it back into the policy: [Search distillation](../training/distillation.md).

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
