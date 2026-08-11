# Successful results


!!! abstract "TL;DR"
    Curated renders and shield sweeps per run. For the comparable cross-run numbers see the
    [experiment log](experiments.md#recent-runs) instead — everything there is scored on the
    same fixed 100-seed pool, which the per-run material on this page is not.


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
policy under a reward-drop → next-best refusal shield. Note how *heavily* the shield intervenes —
and that it does **not** help. As the [sweep](#refusal-shield-sweep-100-seeds) below shows, for this
tier-trained checkpoint the **raw policy is already the strongest variant** and every shield
*degrades* it (on this very seed the shield's deviation blows out to ~1930 s vs. the raw policy's
**293 s**).

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

Columns: **mean tier** = mean success tier reached (0–5), **success %** = episodes reaching
**Tier 5** (`is_success` — all aircraft landed within ±60 s), **abs_dev** = mean total absolute
landing deviation (s, lower is better), **sep %** / **exit %** = episodes with a separation loss /
airspace exit, **refusals/ep** = mean shield overrides per episode.

| variant | refusal fallback | mean tier | success % | abs_dev (s) | sep % | exit % | refusals/ep |
|---|---|--:|--:|--:|--:|--:|--:|
| NOOP (do-nothing) | — | 0.14 | 0 | 2552 | 89 | 0 | 0.0 |
| random valid | — | 0.00 | 0 | 3941 | 95 | 0 | 0.0 |
| trained_raw | none | 3.37 | 52 | 336 | 19 | 0 | 0.0 |
| reward-drop | do_nothing | 2.72 | 38 | 807 | 25 | 0 | 77.2 |
| reward-drop | next_best | 2.65 | 40 | 707 | 26 | 0 | 79.9 |
| critical-conflict | do_nothing | 2.66 | 35 | 682 | 18 | 0 | 16.1 |
| critical-conflict | next_best | 2.95 | 43 | 581 | 17 | 0 | 12.4 |
| both | do_nothing | 2.52 | 32 | 927 | 20 | 0 | 80.5 |
| both | next_best | 2.76 | 41 | 809 | 20 | 0 | 81.0 |

**Takeaways.** This inverts the older pre-tier `atc_run_1_14` result (where shields recovered a
lot; see `analysis/2026-06-24_shield_benchmark/`). For this **tier-trained** 1_16 best model the
**raw policy is the single strongest variant** — mean tier **3.37**, **52 %** Tier-5 success,
**336 s** deviation and the lowest separation rate (**19 %**) — and **every shield makes it
worse**, while firing **12–81 refusals/episode**. The gentlest is `critical-conflict + next_best`
(tier 2.95, 581 s, 17 % sep, ~12 refusals): it shaves separation a touch but still costs
tier/punctuality; the `reward-drop` and `both` shields override ~77–81×/episode and hurt most. The
`NOOP` / `random` baselines (89–95 % of episodes lose separation, ~0 tier) confirm the task is far
from trivial.

This is exactly what the [shield hypothesis](mdp.md#eval-time-action-shield) predicts when an agent
is **near-optimal for its own objective**: postprocessing can't recover performance the policy
didn't leave on the table, so the remaining lever is better *training*, not more eval-time shielding.

Raw per-episode rows: `analysis/2026-06-26_shield_benchmark_1_16/results.csv`
(harness: `analysis/2026-06-24_shield_benchmark/shield_benchmark.py`).

<details>
<summary><strong>Per-seed sweep</strong> — total absolute deviation (s), all 100 seeds × 9 variants</summary>

Columns: `raw` = trained_raw, `rd`/`cc`/`both` = reward-drop / critical-conflict / both checks,
`DN`/`NB` = do_nothing / next_best fallback.

| seed | noop | rand | raw | rd·DN | rd·NB | cc·DN | cc·NB | both·DN | both·NB |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 41 | 1060 | 4951 | 247 | 161 | 272 | 247 | 247 | 161 | 148 |
| 786551703 | 502 | 5821 | 202 | 104 | 88 | 202 | 202 | 104 | 88 |
| 1595180635 | 4926 | 3593 | 293 | 2709 | 1930 | 1299 | 827 | 2639 | 2654 |
| 1001495968 | 696 | 3906 | 113 | 0 | 12 | 113 | 113 | 0 | 12 |
| 1123251507 | 2916 | 5607 | 331 | 319 | 318 | 562 | 562 | 1048 | 313 |
| 921959045 | 2250 | 3989 | 102 | 17 | 0 | 117 | 104 | 486 | 32 |
| 478163327 | 993 | 5345 | 138 | 108 | 94 | 138 | 138 | 108 | 94 |
| 107420369 | 845 | 6485 | 216 | 52 | 52 | 159 | 169 | 59 | 52 |
| 1181241943 | 3243 | 2813 | 319 | 768 | 1204 | 772 | 536 | 679 | 1671 |
| 1051802512 | 2292 | 3695 | 99 | 125 | 88 | 274 | 59 | 262 | 89 |
| 958682846 | 2336 | 4290 | 155 | 42 | 348 | 683 | 572 | 491 | 62 |
| 599310825 | 462 | 3871 | 97 | 13 | 10 | 97 | 97 | 13 | 10 |
| 440213415 | 3603 | 1454 | 301 | 845 | 1157 | 1067 | 1099 | 1542 | 1728 |
| 373399426 | 3773 | 4360 | 970 | 1044 | 905 | 1007 | 493 | 1419 | 1334 |
| 1812140441 | 3286 | 1871 | 116 | 273 | 254 | 237 | 237 | 273 | 254 |
| 136505587 | 4165 | 2908 | 573 | 2138 | 1724 | 1646 | 999 | 2138 | 1750 |
| 127978094 | 1234 | 4226 | 125 | 67 | 39 | 59 | 110 | 371 | 39 |
| 402418010 | 5404 | 3471 | 155 | 2260 | 1467 | 2362 | 1656 | 3411 | 1930 |
| 939042955 | 2079 | 4737 | 70 | 1444 | 512 | 86 | 75 | 1444 | 512 |
| 999270936 | 5038 | 3535 | 429 | 2043 | 1877 | 3006 | 2143 | 2354 | 3001 |
| 113971123 | 3468 | 3324 | 782 | 2200 | 1598 | 1217 | 931 | 1518 | 1600 |
| 854001193 | 1146 | 4526 | 197 | 87 | 45 | 305 | 66 | 197 | 68 |
| 1801823908 | 2505 | 2646 | 46 | 135 | 61 | 75 | 100 | 496 | 64 |
| 946785248 | 4273 | 3688 | 193 | 1647 | 1755 | 107 | 148 | 1417 | 2507 |
| 1929338154 | 452 | 4870 | 170 | 21 | 0 | 170 | 170 | 21 | 0 |
| 1194819984 | 1328 | 4345 | 93 | 159 | 146 | 98 | 103 | 132 | 132 |
| 27911967 | 729 | 2449 | 194 | 110 | 104 | 310 | 310 | 110 | 104 |
| 685731524 | 2064 | 3925 | 74 | 55 | 47 | 202 | 189 | 58 | 58 |
| 1815115025 | 3030 | 2293 | 158 | 230 | 294 | 634 | 618 | 227 | 392 |
| 1461364854 | 2365 | 3168 | 145 | 99 | 67 | 588 | 187 | 373 | 160 |
| 1193448329 | 2535 | 4276 | 97 | 71 | 29 | 140 | 126 | 70 | 32 |
| 667779376 | 6440 | 3312 | 1135 | 4904 | 5162 | 2855 | 2855 | 4904 | 5162 |
| 924765563 | 4158 | 2180 | 203 | 683 | 814 | 386 | 779 | 2320 | 817 |
| 1445662585 | 2956 | 2974 | 102 | 112 | 570 | 115 | 115 | 132 | 823 |
| 438989805 | 2756 | 3058 | 188 | 108 | 388 | 183 | 225 | 170 | 238 |
| 398340369 | 1066 | 4503 | 101 | 48 | 10 | 101 | 101 | 48 | 10 |
| 1631775357 | 1557 | 2644 | 201 | 84 | 436 | 196 | 172 | 84 | 436 |
| 415393687 | 1000 | 5308 | 226 | 52 | 36 | 57 | 93 | 52 | 36 |
| 1541804686 | 2433 | 3381 | 78 | 34 | 26 | 871 | 864 | 87 | 717 |
| 1477278577 | 3827 | 4722 | 285 | 2006 | 393 | 768 | 352 | 518 | 936 |
| 1136108454 | 5605 | 3442 | 650 | 3430 | 2084 | 2308 | 1920 | 3450 | 2086 |
| 186618211 | 1668 | 4122 | 65 | 192 | 304 | 79 | 75 | 937 | 237 |
| 1973214822 | 2518 | 3803 | 148 | 156 | 135 | 146 | 145 | 174 | 112 |
| 536124280 | 3640 | 2246 | 131 | 391 | 373 | 572 | 451 | 1168 | 455 |
| 1625792787 | 4767 | 4927 | 215 | 1488 | 1066 | 970 | 972 | 1526 | 1184 |
| 338444264 | 1233 | 3824 | 96 | 152 | 44 | 107 | 107 | 152 | 44 |
| 1259191105 | 601 | 3082 | 139 | 163 | 46 | 147 | 147 | 163 | 46 |
| 1553210608 | 1462 | 3478 | 262 | 270 | 196 | 246 | 225 | 270 | 212 |
| 825873196 | 1128 | 5433 | 180 | 114 | 103 | 205 | 205 | 114 | 103 |
| 298737106 | 975 | 6147 | 138 | 60 | 38 | 143 | 116 | 65 | 38 |
| 196814233 | 5642 | 4685 | 2260 | 4036 | 3187 | 2298 | 2298 | 4036 | 3187 |
| 978815630 | 841 | 4259 | 162 | 152 | 78 | 162 | 162 | 152 | 78 |
| 1242911821 | 2346 | 2251 | 155 | 310 | 150 | 848 | 141 | 873 | 104 |
| 342703921 | 354 | 3676 | 119 | 32 | 32 | 119 | 119 | 32 | 32 |
| 999829240 | 928 | 3214 | 131 | 22 | 33 | 113 | 136 | 22 | 33 |
| 433797840 | 663 | 4802 | 171 | 125 | 111 | 171 | 171 | 125 | 111 |
| 1632629719 | 3325 | 3681 | 176 | 764 | 1022 | 787 | 787 | 764 | 1022 |
| 1193887545 | 1995 | 3620 | 120 | 112 | 311 | 108 | 86 | 59 | 83 |
| 1947382419 | 5406 | 4728 | 1952 | 2873 | 2813 | 1858 | 1858 | 3398 | 3530 |
| 1566942273 | 2051 | 5146 | 181 | 154 | 144 | 242 | 188 | 197 | 122 |
| 698594025 | 589 | 3519 | 148 | 94 | 94 | 154 | 173 | 94 | 105 |
| 1589915144 | 6471 | 6441 | 1888 | 4806 | 3882 | 3252 | 2773 | 4806 | 4475 |
| 1525876051 | 1522 | 3952 | 78 | 44 | 37 | 49 | 49 | 44 | 39 |
| 899825838 | 2086 | 3307 | 105 | 59 | 54 | 131 | 130 | 59 | 69 |
| 1146660997 | 4715 | 3314 | 330 | 2015 | 1768 | 1270 | 1244 | 2015 | 2267 |
| 306671447 | 2198 | 4291 | 158 | 81 | 82 | 145 | 145 | 81 | 82 |
| 735034881 | 979 | 4949 | 64 | 66 | 64 | 64 | 64 | 66 | 64 |
| 1051454923 | 2881 | 3181 | 118 | 1622 | 988 | 1113 | 153 | 1331 | 67 |
| 701808367 | 1905 | 3525 | 88 | 42 | 61 | 107 | 66 | 60 | 61 |
| 1985392498 | 1415 | 4460 | 112 | 110 | 98 | 134 | 134 | 110 | 92 |
| 1629748727 | 1464 | 3740 | 82 | 0 | 0 | 94 | 68 | 0 | 0 |
| 1159417075 | 1163 | 4154 | 111 | 10 | 0 | 87 | 118 | 10 | 0 |
| 943239974 | 1699 | 3252 | 128 | 433 | 372 | 118 | 659 | 114 | 47 |
| 1392783743 | 952 | 5316 | 298 | 222 | 229 | 255 | 325 | 222 | 229 |
| 240251661 | 2576 | 4307 | 212 | 478 | 476 | 736 | 824 | 478 | 476 |
| 983753977 | 1114 | 3748 | 35 | 46 | 67 | 452 | 72 | 69 | 14 |
| 137869475 | 3941 | 3673 | 216 | 1192 | 761 | 702 | 701 | 1303 | 905 |
| 1354860540 | 517 | 5360 | 150 | 15 | 0 | 150 | 150 | 15 | 0 |
| 1722989659 | 4026 | 4836 | 608 | 660 | 611 | 2278 | 651 | 2332 | 2653 |
| 1149938334 | 2046 | 4771 | 123 | 138 | 36 | 147 | 144 | 138 | 36 |
| 284277889 | 642 | 4720 | 96 | 78 | 67 | 96 | 96 | 78 | 67 |
| 906164396 | 720 | 3581 | 144 | 0 | 0 | 124 | 115 | 0 | 0 |
| 1351531223 | 1835 | 4735 | 181 | 112 | 403 | 181 | 181 | 144 | 377 |
| 913224047 | 1225 | 2860 | 130 | 26 | 37 | 104 | 89 | 26 | 37 |
| 2144181937 | 3634 | 2772 | 360 | 786 | 1065 | 399 | 268 | 1014 | 491 |
| 1699226064 | 6449 | 4710 | 4093 | 3296 | 3245 | 4438 | 3988 | 4182 | 3330 |
| 1970753705 | 4713 | 2689 | 402 | 2772 | 1473 | 3113 | 3028 | 3229 | 2967 |
| 613628803 | 2186 | 3983 | 94 | 349 | 62 | 451 | 151 | 410 | 62 |
| 1137651678 | 2127 | 4167 | 144 | 241 | 218 | 303 | 280 | 220 | 197 |
| 599707677 | 5955 | 3339 | 1499 | 4721 | 4428 | 2434 | 2153 | 4721 | 4807 |
| 1059257080 | 6859 | 5028 | 2368 | 4216 | 4259 | 2853 | 3052 | 4712 | 4672 |
| 1128466620 | 1393 | 3777 | 88 | 96 | 31 | 84 | 96 | 29 | 28 |
| 1840109255 | 2185 | 3681 | 90 | 60 | 32 | 70 | 70 | 60 | 32 |
| 1715412119 | 1010 | 3325 | 107 | 138 | 224 | 159 | 141 | 132 | 193 |
| 1554762903 | 1586 | 3825 | 146 | 198 | 65 | 234 | 229 | 433 | 65 |
| 941975480 | 4793 | 2866 | 267 | 2398 | 3197 | 1936 | 2025 | 2515 | 3082 |
| 594130308 | 1319 | 4904 | 131 | 113 | 103 | 124 | 141 | 114 | 103 |
| 2119634399 | 4358 | 3491 | 274 | 1116 | 1516 | 542 | 640 | 1967 | 1472 |
| 390452952 | 4574 | 4150 | 252 | 3086 | 1649 | 1179 | 1318 | 2901 | 2307 |
| 202363285 | 5058 | 4268 | 504 | 2350 | 2359 | 2783 | 2185 | 2863 | 2003 |

</details>

<details>
<summary><strong>Per-seed sweep</strong> — success-tier bonus, all 100 seeds × 9 variants</summary>

| seed | noop | rand | raw | rd·DN | rd·NB | cc·DN | cc·NB | both·DN | both·NB |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 41 | 0.0 | 0.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
| 786551703 | 0.0 | 0.0 | 5.0 | 4.0 | 4.0 | 5.0 | 5.0 | 4.0 | 4.0 |
| 1595180635 | 0.0 | 0.0 | 3.0 | 0.0 | 0.0 | 1.0 | 2.0 | 0.0 | 0.0 |
| 1001495968 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 1123251507 | 0.0 | 0.0 | 3.0 | 3.0 | 3.0 | 2.0 | 2.0 | 1.0 | 3.0 |
| 921959045 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 2.0 | 5.0 |
| 478163327 | 0.0 | 0.0 | 4.0 | 5.0 | 5.0 | 4.0 | 4.0 | 5.0 | 5.0 |
| 107420369 | 0.0 | 0.0 | 3.0 | 5.0 | 5.0 | 3.0 | 3.0 | 5.0 | 5.0 |
| 1181241943 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 1.0 | 1.0 | 1.0 | 0.0 |
| 1051802512 | 0.0 | 0.0 | 5.0 | 4.0 | 5.0 | 0.0 | 5.0 | 4.0 | 4.0 |
| 958682846 | 0.0 | 0.0 | 5.0 | 5.0 | 2.0 | 2.0 | 2.0 | 2.0 | 5.0 |
| 599310825 | 2.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 440213415 | 0.0 | 0.0 | 3.0 | 0.0 | 0.0 | 1.0 | 1.0 | 0.0 | 0.0 |
| 373399426 | 0.0 | 0.0 | 1.0 | 1.0 | 2.0 | 1.0 | 2.0 | 1.0 | 0.0 |
| 1812140441 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 136505587 | 0.0 | 0.0 | 2.0 | 0.0 | 0.0 | 1.0 | 1.0 | 0.0 | 0.0 |
| 127978094 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 2.0 | 5.0 |
| 402418010 | 0.0 | 0.0 | 0.0 | 0.0 | 1.0 | 0.0 | 1.0 | 0.0 | 1.0 |
| 939042955 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 999270936 | 0.0 | 0.0 | 3.0 | 0.0 | 0.0 | 0.0 | 1.0 | 0.0 | 0.0 |
| 113971123 | 0.0 | 0.0 | 2.0 | 0.0 | 1.0 | 1.0 | 1.0 | 0.0 | 1.0 |
| 854001193 | 0.0 | 0.0 | 4.0 | 5.0 | 5.0 | 3.0 | 5.0 | 4.0 | 5.0 |
| 1801823908 | 0.0 | 0.0 | 5.0 | 4.0 | 5.0 | 5.0 | 5.0 | 2.0 | 5.0 |
| 946785248 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 1929338154 | 0.0 | 0.0 | 4.0 | 5.0 | 5.0 | 4.0 | 4.0 | 5.0 | 5.0 |
| 1194819984 | 0.0 | 0.0 | 5.0 | 4.0 | 4.0 | 5.0 | 5.0 | 4.0 | 4.0 |
| 27911967 | 1.0 | 0.0 | 3.0 | 4.0 | 4.0 | 3.0 | 0.0 | 4.0 | 4.0 |
| 685731524 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 4.0 | 4.0 | 5.0 | 5.0 |
| 1815115025 | 0.0 | 0.0 | 4.0 | 4.0 | 3.0 | 2.0 | 2.0 | 4.0 | 2.0 |
| 1461364854 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 2.0 | 5.0 | 2.0 | 4.0 |
| 1193448329 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 667779376 | 0.0 | 0.0 | 1.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 924765563 | 0.0 | 0.0 | 5.0 | 1.0 | 1.0 | 3.0 | 1.0 | 0.0 | 1.0 |
| 1445662585 | 0.0 | 0.0 | 0.0 | 0.0 | 2.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 438989805 | 0.0 | 0.0 | 5.0 | 5.0 | 2.0 | 5.0 | 4.0 | 5.0 | 4.0 |
| 398340369 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 1631775357 | 0.0 | 0.0 | 4.0 | 4.0 | 0.0 | 4.0 | 5.0 | 4.0 | 0.0 |
| 415393687 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 1541804686 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 2.0 | 2.0 | 5.0 | 2.0 |
| 1477278577 | 0.0 | 0.0 | 4.0 | 1.0 | 2.0 | 2.0 | 4.0 | 2.0 | 1.0 |
| 1136108454 | 0.0 | 0.0 | 1.0 | 0.0 | 0.0 | 0.0 | 1.0 | 0.0 | 0.0 |
| 186618211 | 0.0 | 0.0 | 5.0 | 3.0 | 0.0 | 5.0 | 5.0 | 1.0 | 3.0 |
| 1973214822 | 0.0 | 0.0 | 3.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
| 536124280 | 0.0 | 0.0 | 5.0 | 2.0 | 2.0 | 2.0 | 2.0 | 1.0 | 2.0 |
| 1625792787 | 0.0 | 0.0 | 5.0 | 1.0 | 0.0 | 2.0 | 2.0 | 0.0 | 0.0 |
| 338444264 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 1259191105 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 1553210608 | 0.0 | 0.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
| 825873196 | 0.0 | 0.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
| 298737106 | 2.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 196814233 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 978815630 | 0.0 | 0.0 | 5.0 | 4.0 | 5.0 | 5.0 | 5.0 | 4.0 | 5.0 |
| 1242911821 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 342703921 | 3.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 999829240 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 433797840 | 2.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 1632629719 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 1193887545 | 0.0 | 0.0 | 5.0 | 5.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 1947382419 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 1566942273 | 0.0 | 0.0 | 4.0 | 4.0 | 4.0 | 4.0 | 5.0 | 4.0 | 4.0 |
| 698594025 | 2.0 | 0.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
| 1589915144 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 1.0 | 1.0 | 0.0 | 0.0 |
| 1525876051 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 899825838 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 1146660997 | 0.0 | 0.0 | 3.0 | 0.0 | 1.0 | 1.0 | 1.0 | 0.0 | 1.0 |
| 306671447 | 0.0 | 0.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
| 735034881 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 1051454923 | 0.0 | 0.0 | 5.0 | 0.0 | 0.0 | 1.0 | 5.0 | 1.0 | 5.0 |
| 701808367 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 1985392498 | 0.0 | 0.0 | 5.0 | 5.0 | 4.0 | 5.0 | 5.0 | 5.0 | 4.0 |
| 1629748727 | 1.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 1159417075 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 943239974 | 0.0 | 0.0 | 5.0 | 2.0 | 2.0 | 5.0 | 0.0 | 4.0 | 5.0 |
| 1392783743 | 0.0 | 0.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
| 240251661 | 0.0 | 0.0 | 4.0 | 0.0 | 0.0 | 2.0 | 2.0 | 0.0 | 0.0 |
| 983753977 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 2.0 | 5.0 | 5.0 | 5.0 |
| 137869475 | 0.0 | 0.0 | 4.0 | 1.0 | 1.0 | 2.0 | 2.0 | 1.0 | 1.0 |
| 1354860540 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 1722989659 | 0.0 | 0.0 | 1.0 | 1.0 | 2.0 | 0.0 | 2.0 | 0.0 | 0.0 |
| 1149938334 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 284277889 | 1.0 | 0.0 | 4.0 | 4.0 | 5.0 | 4.0 | 4.0 | 4.0 | 5.0 |
| 906164396 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 1351531223 | 0.0 | 0.0 | 4.0 | 4.0 | 2.0 | 4.0 | 4.0 | 4.0 | 2.0 |
| 913224047 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 2144181937 | 0.0 | 0.0 | 3.0 | 2.0 | 0.0 | 2.0 | 4.0 | 1.0 | 2.0 |
| 1699226064 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 1970753705 | 0.0 | 0.0 | 3.0 | 0.0 | 0.0 | 0.0 | 1.0 | 0.0 | 1.0 |
| 613628803 | 0.0 | 0.0 | 5.0 | 0.0 | 5.0 | 0.0 | 5.0 | 2.0 | 5.0 |
| 1137651678 | 0.0 | 0.0 | 4.0 | 4.0 | 4.0 | 3.0 | 3.0 | 4.0 | 4.0 |
| 599707677 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 1059257080 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 1128466620 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 1840109255 | 0.0 | 0.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 | 5.0 |
| 1715412119 | 0.0 | 0.0 | 5.0 | 5.0 | 4.0 | 0.0 | 4.0 | 4.0 | 4.0 |
| 1554762903 | 0.0 | 0.0 | 5.0 | 4.0 | 5.0 | 4.0 | 4.0 | 1.0 | 5.0 |
| 941975480 | 0.0 | 0.0 | 4.0 | 0.0 | 0.0 | 1.0 | 1.0 | 0.0 | 0.0 |
| 594130308 | 0.0 | 0.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
| 2119634399 | 0.0 | 0.0 | 4.0 | 0.0 | 1.0 | 2.0 | 2.0 | 1.0 | 1.0 |
| 390452952 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 1.0 | 1.0 | 0.0 | 0.0 |
| 202363285 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |

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
