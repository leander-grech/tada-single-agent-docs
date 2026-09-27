# Loss-of-separation rules

!!! abstract "Summary"
    A **loss of separation** is two aircraft within **3 NM horizontally and 500 ft vertically**, at
    a real timestep of the **live** simulation. It ends the episode and is the only failure
    definition. **Predicted** conflicts, from the do-nothing rollout, never end an episode and never
    gate success. They are priced by the shaping, over a 3–5 NM severity band, so the agent has a
    reason to head a conflict off before it happens. The raw simulator event is much wider than
    3 NM; severity is what makes it meaningful.

Source: `rust_simulator/.../aircraft_service.rs`, `utils/infringement_utils.py`, `actions/rewards.py`,
`atc_env/single_agent_env.py`.

## The raw simulator event

`AircraftService::check_aircraft_separation` emits `LOSS_OF_SEPARATION` from a pure geometric test
on current positions: no prediction, no severity, no flight phase. It fires for any pair within
**2 × 10 NM horizontally and 1000 ft vertically** (the safe-zone radius is doubled), so a raw event
count is mostly routine proximity. Both aircraft must be active and under control.

The scan runs every simulated second while the world is clean, but once an event is recorded
further scans wait for the next 60 s bucket. A logged separation is therefore a sample, not the
closest point of approach.

## Severity { #severity }

Severity is computed in Python from the two separations:

```
u        = clamp( min( (5 − h)/(5 − 3), (1000 − v)/(1000 − 500) ), 0, 1 )
severity = u²
```

- severity = 1 ⇔ h ≤ 3 NM **and** v ≤ 500 ft: the operational loss of separation;
- severity = 0 when h ≥ 5 NM or v ≥ 1000 ft: legal spacing costs nothing.

The convex square puts the strongest restoring gradient just outside 3 NM and meets zero at 5 NM
with matching slope. `LOS_SEVERITY_THRESHOLD = 1.0` is the single failure definition: it drives
termination, `end_reason = "separation"` and every success test. `NEAR_CONFLICT_DISTANCE_NM = 3.5`
is a diagnostic and shield threshold only.

!!! note "Why the band is 3–5 NM"
    Before `1_26` the band ran from 10 NM to 0 NM, so severity 1.0 required literally zero
    separation, and **98.8% of the conflict penalty went to pairs that never came within 5 NM**.
    That was a continuous tax on the very spacing that hitting AMAN times requires. The redesign
    shipped in `1_26`, together with termination on a real loss and log-scaled observations.

## Realised vs predicted

The same simulator test runs on two worlds, and the environment treats them differently:

| | world | drives |
|---|---|---|
| **realised** | the live, committed world | termination, `end_reason = "separation"`, the separation penalty, every success definition |
| **predicted** | a do-nothing rollout (a separate world; the live one is untouched) | the conflict shaping; the observation's infringement features; the inference-time shield |

Making the shaping realised-only would remove all look-ahead pressure: the agent would see no
conflict gradient until aircraft were already inside 3 NM, far too late to act.

## History worth knowing

- **The forecast gate hid real losses.** Until `1_25` the success gate asked whether the
  *prediction* was clear for the last 3 steps. Replayed on `1_22`, that gate never bound (0
  relaxations in 95 episode-evaluations), yet about 23% of evaluation episodes contained a real
  loss of separation. The metric the logs showed (0.99–1.00) was a forecast that always cleared by
  the end. `1_25` switched to the realised gate.
- **The scenario filter was dead code.** `check_not_imminent_infringement()` rejected scenarios on
  `severity >= 1.0`, which was unreachable under the old 10/0 NM band. It became live again, as a
  side effect, when `1_26` made severity 1 mean a real loss. It still does not catch
  **over-capacity** scenarios that will inevitably lose separation later
  ([Findings → over-capacity scenarios](../findings/capacity.md)).

Details of both tests: [Archive → 10-aircraft tests](../archive/ten-aircraft-tests.md).
