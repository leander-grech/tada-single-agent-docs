# Glossary

Terms used across the site, defined once. Metric definitions are the ones the generator and the
scorers compute. The [evaluation protocol](evaluation.md) has the details.

## Air traffic

**AMAN**
: Arrival manager. It assigns every arrival a target landing time and a landing order (the
  *AMAN sequence*). The agent's job is to make the traffic land on those times, in that order.

**Clearance**
: One instruction to one aircraft: a speed change, a turn off and back onto the route, skipping
  waypoints, lengthening or shortening the trombone, or vectoring to the ILS. `DO_NOTHING` is also a
  clearance.

**Trombone**
: The MXP arrival structure: a downwind leg that can be extended to absorb delay, like the slide of
  a trombone. `LENGTHEN_TROMBONE` / `SHORTEN_TROMBONE` add or remove one level.

**Point merge (PMS)**
: The BGY arrival structure used in some early runs: aircraft fly an arc and are turned towards a
  merge point. See [Archive → Point merge](archive/point-merge.md).

**Loss of separation**
: Two aircraft within 3 NM horizontally **and** 500 ft vertically on the live simulation. It ends
  the episode. See [loss-of-separation rules](how/separation.md).

**MXP, BGY**
: Milan Malpensa (the trombone scenario, used by every current run) and Bergamo (point merge).

## Environments

**10-aircraft env**
: The original MDP: one scenario of up to 10 arrivals, all visible at once.

**Windowed env**
: A stream of 20 flights (or longer) seen through a window of the next 10 in the AMAN queue. Every
  current model is trained on it. See [environments](how/environments.md).

**Stitched stream (2×20)**
: Two independently generated 20-flight segments joined with a random 120–900 s cooling gap between
  them: a long-stream test without the backlog that a single long generated scenario builds up.

**Step**
: One decision point, every 45 s of simulated time.

**Reselection**
: The policy may ask for a second clearance within the same 45 s step, before the clock moves
  (budget 2). See [actions & reselection](how/actions.md#reselection).

## Metrics (windowed)

**Solved**
: No loss of separation **and** every flight within ±60 s of its AMAN target.

**Hard-solved**
: The same within ±30 s: no loss of separation, every flight landed, worst deviation ≤ 30 s.

**Flights on time**
: The share of all flights in the stream that land within ±60 s. Flights that never land (the
  episode ended in a loss of separation) count as misses.

**Separation lost**
: Seeds (out of 100) whose episode ended in a loss of separation.

**pass@10**
: Seeds solved by at least one of 10 attempts: the deterministic policy plus 9 sampled ones. An
  upper bound on what the policy holds, not a deployable number.

**pass@1**
: The share of single sampled attempts that solve their seed.

**Safety-bound / precision-bound**
: A seed no attempt solves is *safety-bound* if even the best attempt loses separation, and
  *precision-bound* if the best attempt is safe but some flight is outside ±60 s.

**Lookahead**
: Critic-guided search at inference: try the policy's 4 most likely actions for one real step on a
  snapshot, score each by reward plus the critic's value, act with the best.

**Clearances / stream**
: Real clearances issued per 20-flight stream (`DO_NOTHING` excluded).

**AMAN swaps**
: Pairs of flights that land in the opposite order to the AMAN sequence.

## Metrics (10-aircraft)

**Success**
: Tier 5 of the success ladder: every aircraft landed within ±60 s, no loss of separation.

**Tier**
: The graduated success ladder, T1 (half the aircraft within ±120 s) to T5 (success). See
  [Archive → the 10-aircraft reward](archive/ten-aircraft-reward.md).

**Clean-subset success**
: Success among the episodes that did not lose separation: `success / (1 − separation rate)`.

**Worst-aircraft deviation**
: Per episode, the largest landing deviation of any aircraft, averaged over the seeds.

## Process

**Validation seeds**
: The fixed 100 scenario seeds every model is scored on. Training never draws them.

**Battery**
: The standard set of evaluations a model gets: 20-flight deterministic, stitched 2×20, 10 attempts,
  lookahead. Shown on each [report card](models/index.md).

**Champion**
: The current best windowed model under the [champion rule](models/index.md): at most 5 losses of
  separation in 100 seeds, then most solved.

**Paired test**
: Two models compared seed by seed on the same scenarios. Solved/lost counts use McNemar's test on
  the seeds where they disagree; on-time rates use the standard error of the per-seed difference.

**Warm start, critic warm-up**
: A run that starts from another run's weights (`--init-weights`). A critic warm-up trains only the
  value head for the first steps, so it learns the new reward's scale before its advantages move
  the policy.
