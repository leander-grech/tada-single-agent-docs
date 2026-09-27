# Compute

!!! abstract "Summary"
    Collecting experience is what costs: three quarters of an environment step is the Rust
    simulator's do-nothing prediction rollout, one core per environment. The JAX learner makes a PPO
    update 50–85× faster than SB3 on a GPU. The rebuilt simulator (0.2.81) is bit-identical and 1.6×
    faster. So what makes a machine fast is **per-core speed**, not core count. Runs `1_36`–`1_39`
    trained on a rented Threadripper + RTX 4090 at ~1 400 steps/s: a 5M-step run in about an hour,
    where the thermally throttled laptop manages ~70–330 steps/s.

## Where the time goes { #profile }

Per windowed step, measured on an idle machine:

| component | time | share |
|---|---|---|
| Rust simulator: do-nothing prediction rollout | 23.4 ms | **74%** |
| Python observation build | 7.5 ms | 24% |
| rest of `env.step` | ~1 ms | 3% |
| policy forward (single observation, CPU) | 6.4 ms | outside the env |

A windowed step costs ~3.6× a 10-aircraft step: twice the aircraft in every rollout, the airspace
never empties mid-stream, and the window always holds 10 flights to encode. The rollout cannot
simply run coarser. Against its 1 s ticks, 2 s ticks cost ×0.62 but put median / p95 / max error
in predicted deviation at 4 / 203 / 1182 s; 5 s ticks at 148 / 308 / 875 s. Route following needs
the fine step.

Speed-ups made so far: the observation build is 3.4× faster (3.69 → 1.09 ms, byte-identical), and
the rebuilt simulator's rollout is 1.6× faster (below). An attempt to cut the rollout horizon
measured 0.96× and was reverted: the rollout already stops once every aircraft has landed.

## The JAX learner { #jax-learner }

`main_jax.py` trains the same policy with a PPO learner written in JAX (`jax_ppo/`). `main.py` (SB3)
remains available.

- **Same everything else:** env stack, schedules, critic warm-up, run directories, TensorBoard.
- **Checkpoints are ordinary SB3 files** (`.zip` + VecNormalize `.pkl`). `render_policy.py`,
  `score_windowed.py`, the lookahead and `PPO.load` use them unchanged.
- **Parameters use PyTorch's layout**, keyed like `ATCAutoregressivePolicy.state_dict()`, so
  converting is an array copy.
- **Verified equivalent:** forward pass vs PyTorch on 64 real observations ≤ 2.1e-5; one full
  5-epoch update vs SB3's `train()` from the same start and data ≤ 1.2e-7, critic warm-up included
  (`tests/test_jax_equivalence.py`, `tests/test_jax_ppo_update.py`).
- **One compiled call per epoch** (a `lax.scan` over the 16 minibatches, SB3's KL early stop kept
  exactly): **0.13 s per 4 096 steps on an RTX 4090**, against 7–11 s for SB3. A first version made
  two calls per minibatch and took 1.3 s on the laptop and 4.9 s on a slow-core host: per-call
  overhead, not the GPU, set the time.
- **Per-transition discount** for reselection ([Objective](../how/objective.md#reselection-discount));
  with no extra picks the advantages are bit-exact with SB3's.
- **Not yet:** resuming a JAX run (warm starts from any SB3 checkpoint work).

## The simulator { #simulator }

`flight_simulator` 0.2.81 is built from the Rust source now vendored in `simulator/rust_simulator/`
(the source of the 0.2.80 wheel):

- **bit-identical to 0.2.80:** 6 rollouts including scenario generation, 1 680 observation arrays, the
  simulator's 19 Python tests and its Rust tests;
- **1.6× faster rollout** (16.1 → ~10.0 ms): link-time optimisation, and the infringement history
  moved instead of copied every simulated second (`CHANGES.md`, `build_fast.sh`);
- **portable:** CPU-specific tuning measured no gain.

## Rented GPU hosts (vast.ai) { #vast }

Runs `1_36`–`1_39` record a rented vast.ai host in their `run_meta.json`; it was set up and torn
down by scripts in `analysis/2026-09-26_1_36_multipick/vast/` of the code repo. The from-scratch
runs are driven by the scripts in `analysis/2026-09-27_scratch/`.

- **Upload:** a `git archive` of the commit (recorded into each run's `run_meta.json`), the scenario
  configuration and the checkpoints a run needs. The same package versions are installed, and the
  equivalence tests run on the host's GPU before anything trains.
- **Pipeline:** training, then the full evaluation battery and the renders.
- **The laptop copies everything back every 10 minutes.** At the end it makes a final copy, verifies
  it by checksum and destroys the host. A failsafe on the host destroys it with its own
  instance-scoped key if the laptop cannot.

| host | cores | env steps/s (32 / 64 envs) | PPO update | result |
|---|---|---|---|---|
| laptop, i7-1260P | 4P + 8E | ~356 (16 envs) | 1.3 s | ~320 steps/s; clamps to 375 MHz when hot |
| 2× EPYC 7B12 (Zen 2, 2.2 GHz) | 256 threads | — / 491 | 4.9 s | no faster than the laptop: rejected |
| **Threadripper PRO 7975WX (5.3 GHz)** + RTX 4090 | 64 threads | **1 150 / 1 452** | **0.13 s** | 1 050–1 400 steps/s per run, two runs at once |

Two runs at once each kept ~1 400 steps/s. One offered host re-signed HTTPS traffic with its own
certificate authority and was dropped. Check a new host by hand first:
`openssl s_client -connect files.pythonhosted.org:443` should show a public issuer.

## The laptop

Under sustained load the CPU reaches ~98 °C, and the firmware clamps it to ~400 MHz for 2–3 minutes
in every ~5; anything else running shares the same power budget. `1_32` ran at ~170 steps/s with the
machine to itself and ~90 with other jobs; `1_35` slowed to 71 steps/s at the end and was stopped at
93%. An earlier note blamed the in-training eval for ~70 s per 25k steps; those were thermal clamps,
and the eval's real cost is ~20 s per 25k. More workers help only up to the power budget.
