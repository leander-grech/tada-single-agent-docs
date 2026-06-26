# Successful results

Curated highlights from the **best checkpoints** of individual runs: deterministic render
clips, plus the full eval-time **refusal-shield sweep** over all 100 evaluation seeds. Each
subsection links back to the matching entry in the [experiment log](experiments.md), which
explains *what changed* in that run and *why* — this page is the "here's what it looks like
when it works" companion to that narrative.

!!! note "How this page grows"
    One subsection per run, added as a checkpoint becomes worth showcasing. Each carries
    (1) a hyperlink to its [experiment-log](experiments.md) entry (by run number), (2) a few
    curated render `.mp4`s, and (3) the refusal-shield sweep table — a 9-row summary plus a
    collapsible per-seed breakdown across all 100 eval seeds. See
    [Adding a new run](#adding-a-new-run) for the template.

---

## Run 8 — `atc_run_1_16` best model { #run-8-atc_run_1_16 }

→ **Experiment log:** [Run 8 — 5-tier success + autoregressive policy](experiments.md#run-8).

The first checkpoint to post a non-zero success rate (peak **50%** @5.7 M) and to break the
per-aircraft deviation ceiling that held across Runs 1–7 (worst-aircraft deviation down to
**~99 s**). Autoregressive PPO (aircraft head → clearance head), 5-tier graduated success
bonus. Model: `experiments/atc_run_1_16/best/best_model.zip`.

### Renders

A/B on the **same scenario** (eval seed `1595180635`): the raw greedy policy versus the same
policy under the best refusal shield (reward-drop → next-best fallback). Watch how the shield
trades a few interventions for tighter landing times.

<p><strong>Raw policy — no shield</strong> (seed 1595180635):</p>
<video controls preload="metadata" width="100%">
  <source src="../assets/renders/atc_run_1_16_best_model_det_legacy45s_noshield_ep1_seed1595180635.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

<p><strong>Reward-drop → next-best shield</strong> (same seed 1595180635):</p>
<video controls preload="metadata" width="100%">
  <source src="../assets/renders/atc_run_1_16_best_model_det_legacy45s_rdrop_next_best_ep1_seed1595180635.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

<p><strong>Full eval montage</strong> — every eval scenario, reward-drop → next-best shield:</p>
<video controls preload="metadata" width="100%">
  <source src="../assets/renders/atc_run_1_16_best_model_det_rdrop_next_best_alleval.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

More clips from this checkpoint:

- [Raw policy, seed 1181241943](assets/renders/atc_run_1_16_best_model_det_legacy45s_noshield_ep1_seed1181241943.mp4) · [same seed, reward-drop → next-best](assets/renders/atc_run_1_16_best_model_det_legacy45s_rdrop_next_best_ep1_seed1181241943.mp4)
- [10-episode reel, raw policy (45 s interval)](assets/renders/atc_run_1_16_best_model_det_legacy45s_noshield_ep10.mp4)
- [5-episode reel, raw policy](assets/renders/atc_run_1_16_best_model_det_noshield_ep5.mp4) · [10-episode reel, raw policy (non-legacy interval)](assets/renders/atc_run_1_16_best_model_det_noshield_ep10_NOTlegacyinterval.mp4)

### Refusal-shield sweep (100 seeds)

Does eval-time **postprocessing** squeeze more out of this checkpoint? A *refusal shield*
(see [MDP → eval-time action shield](mdp.md#eval-time-action-shield)) is a read-only one-step
look-ahead (`env.peek_action`): it refuses the policy's chosen clearance
when that action either **drops predicted reward** (`reward-drop`) or **risks a critical
conflict** (`critical-conflict`) — or **both** — and substitutes either `do_nothing` or the
**`next_best`** valid clearance. Every variant is run on the **same 100 eval scenarios**
(seeds re-seeded deterministically per reset), alongside `NOOP` and `random` baselines and the
unshielded `trained_raw` policy.

Columns: **mean tier** = mean success-tier bonus, **success %** = episodes flagged solved,
**abs_dev** = mean total absolute landing deviation (s, lower is better), **sep %** / **exit %**
= episodes with a separation loss / airspace exit, **refusals/ep** = mean shield overrides per
episode.

<!-- SUMMARY_TABLE -->

Raw per-episode rows: `analysis/2026-06-26_shield_benchmark_1_16/results.csv`
(harness: `analysis/2026-06-24_shield_benchmark/shield_benchmark.py`).

<details>
<summary><strong>Per-seed sweep</strong> — total absolute deviation (s), all 100 seeds × 9 variants</summary>

Columns: `raw` = trained_raw, `rd`/`cc`/`both` = reward-drop / critical-conflict / both checks,
`DN`/`NB` = do_nothing / next_best fallback.

<!-- PER_SEED_ABSDEV -->

</details>

<details>
<summary><strong>Per-seed sweep</strong> — success-tier bonus, all 100 seeds × 9 variants</summary>

<!-- PER_SEED_TIER -->

</details>

---

## Adding a new run

To add a showcase for run **N** (`atc_run_1_X`):

1. **Renders.** Drop the curated `.mp4`s into `docs/assets/renders/` and embed them with a
   `<video controls preload="metadata" width="100%">` block (src is `../assets/renders/<file>.mp4`,
   relative to this page). Keep a couple of short single-episode clips inline; link the long reels.
2. **Sweep.** Run the shield benchmark on that checkpoint's best model over all 100 seeds:
   ```bash
   /home/leander/miniconda3/envs/tada/bin/python \
     analysis/2026-06-24_shield_benchmark/shield_benchmark.py \
     --model experiments/atc_run_1_X/best/best_model.zip \
     --seeds 100 --out-dir analysis/<date>_shield_benchmark_1_X
   ```
   then render the summary + per-seed pivots from the resulting `results.csv`.
3. **Cross-link.** Add a `## Run N — \`atc_run_1_X\` best model` heading whose first line is
   `→ **Experiment log:** [Run N — …](experiments.md#run-N)` — the `experiments.md` headings
   carry stable `{ #run-N }` anchors for exactly this.
