# Discrete soft actor-critic

!!! abstract "Summary"
    An off-policy learner on the best TMB MDP: discrete soft actor-critic in JAX. Its actor is the PPO
    policy network, its settings were measured on PPO, and it ran three seeds of 3M steps on the laptop
    (`1_102`–`1_104`). **At matched samples it equals PPO on solved streams and halves the losses of
    separation, but it is poor at the ±30 s target**. After 3M steps it solves 24 of 100 validation
    streams (three-seed mean). PPO solves 24 at 3M steps and 45 by the end of its 10M-step stage 1. On
    the fresh test seeds SAC solves 19 and PPO's stage 1 solves 32. SAC is not a better learner for this
    task at this budget.

Source: `jax_sac/sac.py` (learner, replay), `main_sac.py` (trainer), `analysis/sac_calibration.py`
(measuring PPO), `analysis/2026-10-10_sac/` (pipeline, calibration, scores, README).

## The learner

- **Exact expectations.** A joint action is aircraft × clearance × again: at most 10 × 15 × 2 = 300
  entries, about 16 of them legal in a median decision. The soft value
  V(s) = Σ<sub>a</sub> π(a|s) [Q(s,a) − α log π(a|s)] and the actor loss are summed over every legal
  joint action, with no sampling (discrete SAC). Masked actions have π = 0 and drop out, so Q is never
  asked about them.
- **Critic.** Twin Q heads, one per aircraft, read the shared encoder and output Q[aircraft, clearance,
  again]. The critic uses clipped double-Q and a Polyak target network (τ 0.005). The encoder is trained
  by the critic alone; the actor heads read stop-gradient features.
- **Value head.** It regresses the soft value, so an exported SAC checkpoint carries a V(s) for the
  [rollout search](../findings/lookahead.md).
- **Export.** The actor is exported as an ordinary SB3 checkpoint, so every scorer, the renderer and the
  search load SAC runs unchanged.
- **Returns.** 3-step returns use the same per-transition discount as PPO: a zero-time pick is discounted
  by 1, every other step by γ = 0.998. The end of a stream is a truncation and bootstraps from the
  terminal observation; only a bust terminates.
- **Replay.** A ring buffer with one column per env worker holds 300k transitions. Observations are
  stored as float16 (every feature lies in [−1, 1]).
- **Budget.** Replay ratio 4 (PPO's 5 epochs make 5), batch 256, 4 envs per seed. Actor and critic
  learning rates fall from 3e-4 to 3e-5.

## Settings measured on PPO

`analysis/sac_calibration.py` ran PPO `1_65` (stage 1, the same MDP) at 1M, 5M and 10M steps on 48
training streams, sampling as in training.

| Quantity | PPO, 1M / 5M / 10M | SAC setting |
|---|---|---|
| Return std (VecNormalize) | 19.7–20.1 at the end of `1_61` / `1_63` / `1_65` | rewards × 1/20 |
| Legal joint actions | median ≈ 16; 4–5 % of decisions have only one | entropy target per decision |
| Entropy / log \|A<sub>legal</sub>\| | 0.59 / 0.51 / 0.37 | target κ · log \|A<sub>legal</sub>(s)\|, κ on the same schedule scaled to 3M |
| Entropy bonus in these units (0.01 × std of GAE advantages) | 0.011 / 0.0045 / 0.0034 | α starts at 0.011, then tunes itself |
| Mean return-to-go / σ | 0.65 / 0.88 / 0.32 | Q heads' output bias starts at 0.65 |

A state-dependent target is needed because the masks leave between 1 and about 300 legal actions. A
constant target would be unreachable in some states and slack in others.

The first launch used the usual temperature step of 3e-4. With one update per 64 transitions, α would
have needed about 0.5M steps to move tenfold. The policy's entropy fell to 1.0 against a target of 1.84
within 80k steps, so the run was stopped. The relaunch uses a step of 3e-3, and entropy then tracked
its target for the whole run (1.15 against 1.14 at 3M).

## Results

### Matched samples: validation, deterministic policy, at 3M steps

| | solved | hard-solved (±30 s) | losses of separation | flights on time |
|---|---|---|---|---|
| SAC `1_102` / `1_103` / `1_104` | 33 / 21 / 18 (mean 24.0) | 7 / 3 / 2 (4.0) | 15 / 15 / 13 (14.3) | 83.7 / 82.6 / 81.3 % |
| PPO `1_61` / `1_63` / `1_65` | 28 / 21 / 22 (mean 23.7) | 13 / 9 / 9 (10.3) | 25 / 32 / 24 (27.0) | 74.5 / 73.2 / 71.5 % |

At 1M steps SAC was behind on solved streams (mean 6.7 against 11.7) but already had fewer losses of
separation (19.7 against 34.3). At 2M the two were level (20.0 against 19.7). The curricula differ:
SAC's is compressed into 3M steps, so by 2M it had trained on harder streams than PPO had.

### Final models: SAC after 3M steps, PPO after its 10M-step stage 1

Deterministic policy, 100 streams each. *Best of 11* means at least one of the deterministic attempt
and 10 sampled attempts solved the stream.

| Seed set | | solved | hard-solved | LoS | on time | best of 11 |
|---|---|---|---|---|---|---|
| validation | SAC (mean of 3) | 24.0 | 4.0 | 14.3 | 82.5 % | 54.0 |
| | PPO stage 1 (mean of 3) | 44.7 | 23.7 | 15.3 | 83.9 % | 72.7 |
| test | SAC (mean of 3) | 19.0 | 3.3 | 24.3 | 76.3 % | 40.7 |
| | PPO stage 1 (mean of 3) | 32.3 | 16.7 | 21.0 | 77.0 % | 58.0 |
| | `1_76` (PPO stage 3) | 59 | 31 | 14 | 87.2 % | 73 |

After 3M steps, SAC matches PPO's 10M-step on-time share and its losses of separation on validation.
It solves about half as many streams, and few within ±30 s. On the test seeds its losses of separation
are no better than PPO's.

## Reading

- **Safety comes early, precision does not.** The critic learns quickly what busts a stream. The
  difference between landing brackets is small in its units: after the 1/20 scale, a flight landing
  within ±30 s rather than ±60 s is worth 0.05. That is below the critic's error (its loss ≈ 0.05, an
  error of about 0.3). PPO normalises its advantages per minibatch, so differences this small still
  steer its updates. A larger reward scale (for example 1/5) or more updates per sample would test this.
- **No sample-efficiency gain on the headline.** At equal samples the solved rate is the same, and a
  SAC update costs about 1.7× a PPO minibatch. With the laptop's shared GPU, SAC ran at about 45
  steps/s per seed, against about 200 steps/s for PPO alone.
- **For the paper:** SAC is an off-policy baseline on the same MDP and network. It shows that the
  results are not specific to PPO for safety, and that PPO with fine-tune stages is the stronger learner
  for the precision target.
