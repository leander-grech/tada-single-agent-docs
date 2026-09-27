# Environments

!!! abstract "Summary"
    **`ATCSingleAgentEnv`** (the 10-aircraft env) shows the agent one whole scenario of up to 10
    arrivals. **`WindowedATCEnv`** (`--env windowed`) runs a stream of 20 or more flights through a
    window of the next 10 in the AMAN queue. When a flight lands, the next one takes its slot. Its
    design rule: nothing the agent observes, and nothing the critic must predict, depends on how
    many flights the stream has. The same agent can then run on longer streams, which serve as
    stability tests. Both envs share the simulator, the clearances and the observation layout, so
    checkpoints move between them unchanged.

Source: `atc_env/single_agent_env.py`, `atc_env/windowed_env.py`, `config/windowed_config.py`.

## The 10-aircraft env

One MXP trombone scenario (`VALIDATION_USE_CASE_1`) of up to 10 arrivals, all visible. One
clearance per 45 s step. The episode ends when every aircraft has landed or on a realised loss of
separation. The horizon is sized per scenario to its last arrival plus 6 steps, capped at 130; a
timeout was never observed in 800 scored episodes. Success is the top of a five-tier ladder. That
reward and the runs trained on it are in the [Archive](../archive/ten-aircraft-reward.md).

## The windowed env { #windowed }

### Who is in the window

At t = 0 none of the 20 flights is under control; across seeds, 3.6 are active on average and up
to 13 at once. Ten slots are almost always enough, but not always, so the window needs a rule:

| | rule |
|---|---|
| membership | the next 10 **unlanded** flights in AMAN order, spawned or not |
| on landing | the flight leaves; the next in the queue takes the slot |
| not-yet-spawned flights | visible (`under_control = 0`), only `DO_NOTHING` allowed |
| aircraft head | may pick only under-control slots when any exist |
| slot order | queue position; the policy is permutation-equivariant, so slot index carries no meaning |

"Next in line" is well defined: on every probed seed the landing order under do-nothing equals the
AMAN order. The aircraft-head rule is essential. Without it, the zero-shot 10-aircraft agent kept
picking pending flights and wasted its step, and 65% of episodes lost separation (10% with the
rule). Flights under control but more than 10 places back are invisible, about 3% of steps
(`window_overflow_frac`).

### Stream-stationary observables

Everything that encoded the scenario rather than the window was replaced (details on
[Observations](observations.md#windowed)): a receding prediction rollout instead of one to the
scenario's end; scheduled time-to-go instead of a feature read from the rollout's end; the window's
time span instead of absolute time; the under-control count instead of filled slots. Rolled out on
20- and 40-flight streams, no feature drifts from early to late in the stream.

### Episode semantics

A loss of separation is a true termination. The stream running dry is a **truncation**: PPO
bootstraps from the critic, because the critic sees the window, not how many flights remain. The
per-flight landing reward is paid once, at touchdown. The [objective page](objective.md) has the
reward.

### Longer streams: generated and stitched { #stitching }

A 40-flight scenario generated in one sequence builds a growing backlog. Under do-nothing the
landing deviation per 10-flight band grows 224 / 513 / 687 / 913 s, so it tests backlog handling
well beyond anything a 20-flight stream shows ([Findings → over-capacity
scenarios](../findings/capacity.md)).

**Stitched streams** build long streams from independent 20-flight segments instead:

- each next segment's first target landing comes a random cooling gap (120–900 s by default) after
  the previous segment's last;
- the segment's spawns and targets shift together, so its internal spacing is untouched;
- callsigns and trombone sections are renumbered to continue the queue.

Under do-nothing a 2×20 stitched stream reads 183 / 368 / **259** / 502 s per band: the backlog
resets at the seam. From `1_35` onward, training uses stitched 2×20 streams, so the policy sees
seams with different amounts of relief.

| | command |
|---|---|
| training | `main.py --env windowed --stitch-segments 2 --stitch-gap 120 900` |
| scoring | `analysis/score_windowed.py --segments 2 --gap 120 900` |
| rendering | `render_policy.py --env windowed --segments 2` |

### Configuration

| setting (`config/windowed_config.py`) | value |
|---|---|
| `DIFFICULTY` | `VALIDATION_USE_CASE_1` (MXP trombone) |
| `SCENARIO_AIRCRAFT_COUNT` / `WINDOW_SIZE` | 20 / 10 |
| `ROLLOUT_LOOKAHEAD_S` / `ROLLOUT_MARGIN_STEPS` | 2880 s / 20 |
| `TIME_SCALE_S` | 7200 s |
| `MAX_EPISODE_STEPS` | 200 (a 20-flight stream's last ETA is 111–158 steps in) |
| `CONTINUING_TASK` | `True` |

A longer stream at evaluation: `WindowedATCEnv({"evaluation_mode": True, "scenario_aircraft_count": 40})`.

## Simulator versions

The windowed work runs on `flight_simulator` 0.2.80 and later. It has the same API as 0.1.52, but
**the same seed generates a different scenario**. 10-aircraft numbers from 0.1.52 therefore do not
compare with windowed ones even on the same seed list. 0.2.81 is bit-identical to 0.2.80 and 1.6×
faster ([Compute](../training/compute.md#simulator)).
