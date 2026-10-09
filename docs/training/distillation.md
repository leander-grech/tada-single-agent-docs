# Search distillation (expert iteration)

!!! abstract "Summary"
    The receding-horizon **rollout search** (MPC with the simulator as the model, the policy as the
    proposal) solves about 30 more TMB validation streams than the deterministic policy it searches
    with, and never loses one the policy solves. The search's choices are therefore a better policy that
    lives inside the trained policy's own support. **Distillation** trains the network to make those
    choices itself, so the improvement is available without search, and without a world model, at
    deployment. Repeating it (search with the distilled policy, distil again) is expert iteration.
    Model selection uses a separate **dev** seed set, so the 100 validation seeds stay a clean
    measurement, and the headline numbers are re-measured on a fresh **test** set.

Source: `analysis/rollout_search.py` (search, `--record`, `--sample-steps`), `analysis/distill_bc.py`
(behaviour cloning), `analysis/2026-10-09_distill/` (seeds, job scripts, logs).

## Why it can work

On the 100 validation seeds (deterministic policy → search, solved / losses of separation):

| model | policy | search (K = 8, M = 10) | search solves that the policy misses | policy solves that the search misses |
|---|---|---|---|---|
| TMB `1_65` | 47 / 18 | 83 / 4 | 36 | 0 |
| TMB `1_74` | 54 / 13 | 86 / 2 | 32 | 0 |
| TMB `1_76` | 59 / 10 | **88 / 2** | 29 | 0 |
| PMS `1_67` | 30 / 12 | 52 / 2 | 22 | 0 |
| PMS `1_75` | 38 / 9 | 56 / 0 | 18 | 0 |
| PMS `1_77` | 41 / 9 | **54 / 0** | 13 | 0 |

Every candidate the search scores is a deterministic or a sampled rollout of the policy itself, so the
gap is not missing capability: the argmax picks the wrong one of the actions the policy already
considers. Pass@11 (any of 1 deterministic + 10 sampled attempts) is 85 for `1_76`, close to the
search's 88.

## The search

`rollout_search.py`, every M = 10 decisions:

1. snapshot the environment (exact restore);
2. roll K = 8 candidates out to the **end of the stream**: the incumbent (the rest of the plan chosen
   last time; its outcome is cached), the deterministic policy, and K − 2 sampled rollouts;
3. score each by its outcome, lexicographically: no loss of separation, then flights within ±60 s,
   then −Σ|landing deviation|, then −clearances;
4. execute the first M actions of the best; ties go to the incumbent, so the realised outcome is never
   worse than an earlier plan. Search stops as soon as a candidate solves the stream, and rollouts that
   can no longer reach the best on-time count are pruned.

Cost on TMB: about 16 rollouts and 1 100 simulated steps per episode, roughly 1 minute of one core per
2-hour stream. That is far inside the 45 s decision interval, but it assumes the simulator is a
perfect model of the traffic.

## Distillation

```bash
J=analysis/2026-10-09_distill
# 1. expert data: search on TRAINING seeds (never validation / dev / test), every executed step recorded
analysis/2026-10-09_distill/collect.sh experiments/atc_run_1_76_ft3_tmb_full/final_model.zip tmb \
    $J/seeds/train_r1.txt tmb_r1_1_76 11
# 2. behaviour cloning from the start policy, one checkpoint per epoch
TADA_ACTION_SET=v2 TADA_AIRPORT_MASK=monad TADA_SEQUENCE_OBS=1 TADA_MAX_PICKS=2 \
python analysis/distill_bc.py --init experiments/atc_run_1_76_ft3_tmb_full/final_model.zip \
    --data $J/data/tmb_r1_1_76 --run atc_run_1_80_distill_tmb_r1 --epochs 6
# 3. pick the epoch on the DEV seeds, deterministic
python analysis/score_windowed.py --models experiments/atc_run_1_80_*/epochs/e*/final_model.zip \
    --seed-file $J/seeds/dev.txt --seeds 100 --use-case 1
```

- **Data.** `--record DIR` saves each executed step's observation and action to `DIR/<seed>.npz`,
  with the episode outcome and whether the action was the deterministic policy's own.
- **Loss.** The negative joint log-probability of the recorded action (aircraft, clearance, again: the
  same autoregressive log-probability PPO uses). Options: a KL anchor to the start policy
  (`--anchor`), an entropy bonus (`--ent`), extra weight on the search's corrections
  (`--w-correction`) and less weight on unsolved episodes (`--w-unsolved`).
- **Seeds.** Training data comes from the 40 000-stream training pool. `seeds/dev.txt` (100) selects
  epochs and rounds. `seeds/test.txt` (100) is touched only for the final numbers. Both are fresh draws,
  disjoint from the pools and from the validation seeds.
- **Outputs.** `experiments/<run>/epochs/e<k>/` holds a complete checkpoint (`final_model.zip`,
  `vecnormalize.pkl`, `run_meta.json`), so every scorer, the renderer and the search load it unchanged.
  `train_log.csv` has the loss, the held-out NLL and the argmax agreement per epoch.

### A pitfall: cloning sampled continuations

When the search switches to a sampled candidate, every later action of that candidate is a random
sample from the policy. Most of those are not why the candidate won. Cloning them teaches the policy
its own sampling noise and blurs its argmax. In the first pilot (218 episodes), the argmax agreement
with the recorded actions fell from 96% to 90% while the likelihood rose.

`--sample-steps J` fixes this at the source: a sampled candidate samples only its **first J actions**
and then follows the deterministic policy. Its outcome then measures those J choices under the
continuation the deployed policy will actually play. The executed data is then the deterministic
policy, except at the few states where the search found a better action: clean labels for a
deterministic student.

## Results

### The cleaner search

`--sample-steps 2` on the 100 validation seeds with `1_76`: **81 solved, 5 LoS**, against 88 / 2 for the
full search and 59 / 10 for the deterministic policy. It keeps 22 of the full search's 29 extra solves
and never loses a seed the policy solves, so it is a strong expert whose data contains only the
corrections that matter.

### Round 1, TMB (9 Oct)

Expert: the full search with `1_76` on 601 training streams (frozen snapshot `data/tmb_r1a`: 96 000
steps, 13% of them differ from `1_76`'s own argmax). Three students, 6 epochs each, every second
epoch scored deterministically on the **dev** seeds; `1_76` scores 55 solved / 16 LoS / 0.863 there.

| student | best epoch | solved | gained / lost vs `1_76` | LoS | on time |
|---|---|---|---|---|---|
| `1_80` plain cloning | e2 | 57 | +7 / −5 | 13 | 0.872 |
| `1_81` advantage-weighted (AWR, β = 1) | e6 | 60 | +8 / −3 | 16 | 0.880 |
| `1_82` AWR + KL anchor 0.3 | **e4** | **63** | **+8 / −0** | **14** | **0.885** |

Plain cloning moves little. The advantage weighting plus the anchor to the start policy gives the
largest and cleanest gain: every seed `1_76` solves is still solved. `1_82` (epoch 4) was chosen as the best of nine checkpoints on dev, so its dev gain is optimistic.
Measured on seeds it was not selected on:

| seed set | `1_76` | `1_82` | gained / lost |
|---|---|---|---|
| dev, 100 (selection set) | 55 / 16 LoS | 63 / 14 | +8 / −0 |
| **test, 100 (untouched)** | 59 / 14 | **61 / 15** | +9 / −7 |
| validation, 100 | 59 / 10 | **64 / 9** | |
| dev, 300 (dev + 200 new) | 166 / 45 | **176 / 47** | +18 / −8 |

Pass@11 on the test seeds rises from 73 to 79.

### Rounds 1b and 2, and point merge

- **Round 1b**, the same recipe on all 1 200 round-1 streams: 58–62 on dev at every epoch (anchor 0.3 or
  1.0), the same level as `1_82`. More data from the same expert does not add more.
- **Round 2**, `1_82` as the search's proposal on 1 200 new streams (the search solved 76% of them,
  `1_76`'s solved 77%), with value-head regression so the student's critic stays calibrated: 177 / 300 on
  dev, against `1_82`'s 176. Expert iteration does not compound here: the student is barely a better
  proposal than its teacher's policy.
- **PMS round 1** (expert: the search with `1_77` on 800 streams, 348 solved): no gain, 31–33 on dev
  against `1_77`'s 34, for plain, advantage-weighted and anchored cloning alike.

### Verdict

Distillation moves the deterministic TMB policy by about **+3 to +5 solved streams per 100**,
consistently across four seed sets, with no change in safety. That is a sixth of the search's own
gain (+29). It does not help on point merge. The policy's argmax does not absorb the search's
choices at this data scale (about 200 000 recorded steps, 13% of them corrections); the deployable
gain remains the **search itself**, which needs the simulator at decision time.
