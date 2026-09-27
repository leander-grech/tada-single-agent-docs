# Training reference

!!! abstract "Summary"
    Two trainers share one env stack, one policy and one run layout. `main.py` is SB3 PPO; it
    cannot train with reselection. `main_jax.py` is a JAX PPO learner whose checkpoints are
    ordinary SB3 files. A fresh run warms the learning rate up over the first 8% of training, then
    decays it by a half-cosine. A warm start onto a new reward (`--init-weights`) needs a critic
    warm-up and a much lower peak learning rate, or it unlearns its starting point. Every run writes
    a self-contained directory, including a snapshot of its source.

Source: `main.py`, `main_jax.py`, `jax_ppo/`, `network/autoregressive_policy.py`, `network/rlm.py`,
`config/config.py`.

## Command-line flags

Defaults as in each script's argparse (— = the flag does not exist there).

| flag | `main.py` (SB3) | `main_jax.py` | meaning |
|---|---|---|---|
| `--env` | `default` | `windowed` | the 10-aircraft env or the [windowed env](../how/environments.md#windowed) |
| `--reward-mode` | config default | config default | `outcome_pbrs` = the [lexicographic objective](../how/objective.md); `legacy` otherwise |
| `--stitch-segments`, `--stitch-gap LO HI` | ✓ | ✓ | train on [stitched streams](../how/environments.md#stitching) |
| `--flights` | — | 20 | flights per stream segment |
| `--curriculum F:S:UNTIL,…` | — | none | traffic stages in one run; policy, optimiser, reward normalisation and LR schedule carry over |
| `--pbrs-flat` | — | off | sequence and conflict potentials without their time ramps (recipe arm B) |
| `--violation-penalty` | — | 90 | loss-of-separation cost under `outcome_pbrs` |
| `--init-weights ZIP` | none | none | a fresh run from a checkpoint's **policy weights** (fresh VecNormalize, schedule, step counter); a different action set fails loudly |
| `--total-timesteps` | 2M fresh / 3M resume | 5M | cumulative step target |
| `--n-envs` | 4 | 16 | workers; the rollout buffer stays at 4096 transitions, so this changes wall-clock time only |
| `--lr-max`, `--final-lr`, `--warmup-frac` | 3e-4, 3e-5, 0.08 | 3e-4, 3e-5, 0.08 | warm-up, then half-cosine |
| `--critic-warmup-steps`, `--critic-warmup-lr` | 0, 3e-4 | 0, 3e-4 | train only the value head for the first N steps |
| `--ent-coef` | 0.01 | 0.01 | entropy bonus |
| `--vf-coef`, `--target-kl` | config default | 0.25, 0.05 | value loss weight; KL early stop |
| `--seed` | — | 0 | weights and every worker's scenario generator |
| `--save-freq` / `--eval-freq` | — / 25k | 25k / — | checkpoint / in-training eval cadence |
| `--resume DIR`, `--checkpoint STEP`, `--new-run` | ✓ | — | continue a run in place, or spin off from a checkpoint |
| `--initial-lr`, `--resume-schedule {linear,cosine}` | ✓ (`linear`) | — | the learning rate a resumed run starts from, and how it decays |
| `--run-suffix` | ✓ | ✓ | directory name suffix |

Environment variables read at import time: `TADA_ACTION_SET` (`v1`/`v2`, default `v2`),
`TADA_SEQUENCE_OBS`, `TADA_MAX_PICKS`. `main.py` refuses `TADA_MAX_PICKS > 1` for training.

## Fine-tuning { #fine-tuning }

**A warm start onto a new reward needs a fine-tuning schedule.** `1_31` took `1_29`'s weights onto
the windowed env with a fresh-run schedule. The learning rate warmed to 3e-4 within 0.4M steps
while the critic, trained on `1_29`'s return scale, started at explained variance 0.2. The actor
took full-size steps on bad advantages: KL at the cap, a quarter of samples clipped, entropy rising
from 1.09 to 1.65. The policy got worse than its starting point, and the run was stopped at 2M.

`1_32` fixed it: a **300k-step critic warm-up** (encoder and both policy heads frozen, since the
trunk is shared; verified KL ≈ −1e-9 and clip fraction 0 on those updates), then **peak LR 3e-5**
decaying to 3e-6, entropy 0.003. Every later fine-tune follows that pattern (the JAX runs with a
100k warm-up).

Smoke-testing it caught a boundary bug: SB3's float progress put the switch at 8191.9999 steps, so
the first unfrozen update ran at the critic's learning rate and moved the policy by KL 0.055. The
switch now has a half-step tolerance.

**Resuming.** `--resume` rebuilds the schedule from the checkpoint's learning rate as a *linear*
decay unless `--resume-schedule cosine` is given. That difference confounded `1_27`
([Archive → 22 clearances vs 15](../archive/clearance-sets.md)). The cosine option checks the
reconstructed learning rate against the checkpoint's and warns beyond 5%.

## PPO settings (current)

From `main.py` (the JAX learner builds the same configuration):

| parameter | value | why |
|---|---|---|
| rollout buffer | 4096 transitions (`n_steps` = 4096 / workers) | independent of worker count |
| minibatch, epochs | 256 (16 per epoch), 5 | 10 epochs drifted too far per update |
| clip range, GAE λ | 0.2, 0.95 | |
| `target_kl` | 0.05 in every recent run | early stop; the crossing minibatch is counted, not applied |
| `max_grad_norm` | 1.5 | 0.5 clipped nearly every update |
| γ | 0.998, shared by PPO, VecNormalize and PBRS | long episodes; the shaping's γ must equal PPO's |
| VecNormalize | reward only (`norm_obs=False`) | observations are already in [−1, 1] |

## The network

`ATCAutoregressivePolicy`: a shared `ATCEncoder` turns each aircraft into 128-d (scalars through a
linear layer, flight plan through a 1-D CNN, action history through a GRU, then fused). One masked
self-attention block runs over the aircraft slots (`USE_AIRCRAFT_ATTENTION`), and a masked pool
plus the global features gives the context. Heads: aircraft (per slot), clearance (conditioned on
the chosen aircraft's embedding), again (reselection only), value. The legacy flat
`MaskablePPO` path (`USE_AUTOREGRESSIVE_ACTIONS = False`) still exists but is unused.

## A run directory

```
experiments/atc_run_1_N_<suffix>/
├── checkpoints/     ppo_tada_<step>_steps.zip + VecNormalize .pkl
├── best/            best in-training eval (do not quote)
├── final_model.zip  + vecnormalize.pkl
├── tb/              TensorBoard + CSV
├── snapshot/        every .py in actions/ atc_env/ callbacks/ config/ models/ network/ simulator/ utils/, plus main.py and render_policy.py
├── run_meta.json    run name, commit, host, schedule, env settings, init_weights, seed, curriculum
├── git_diff.patch   uncommitted diff at launch
└── track.csv        (windowed) the 1M-step validation curve, if tracked
```

Snapshots copy whole packages. A curated file list went stale twice, once capturing no clearance
definitions at all, and a partial package shadows the live one on `sys.path`. A spin-off records
`resumed_from` in both runs' `run_meta.json`, so lineage is traceable from either side.
`models.yaml` in this docs repo records the lineage the report cards show.
