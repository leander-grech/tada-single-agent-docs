"""Check the numpy policy (tada_policy.py) against the torch policy, on recorded fixtures.

    python inference/check_parity.py [--models ~/.cache/tada-lab/models]

Downloads the fixtures' agents from the registry if missing (inference/fetch_agent.py), then compares,
decision by decision, the masked logits, the value and the deterministic action. Needs numpy only.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fetch_agent import fetch  # noqa: E402
from tada_policy import NEG_INF, Policy  # noqa: E402

TOL = 1e-4  # float32, different summation order


def check(fixture: Path, models: Path) -> bool:
    agent = fixture.name.split("_")[0] + "_" + fixture.name.split("_")[1]
    pol = Policy.load(fetch(agent, models))
    f = np.load(fixture)
    n = len(f["value"])
    obs_keys = [k[len("obs/"):] for k in f.files if k.startswith("obs/")]
    worst = {"aircraft": 0.0, "clearance": 0.0, "again": 0.0, "value": 0.0}
    mismatched, t = 0, 0.0
    for i in range(n):
        obs = {k: f[f"obs/{k}"][i] for k in obs_keys}
        t0 = time.perf_counter()
        out = pol.forward(obs)
        act = pol.predict(obs)
        t += time.perf_counter() - t0
        for name, ref in (("aircraft", f["aircraft_logits"][i]), ("clearance", f["clearance_logits"][i]),
                          ("again", f["again_logits"][i])):
            mine = out[name]
            live = (ref > NEG_INF / 2) | (mine > NEG_INF / 2)
            if np.any((ref > NEG_INF / 2) != (mine > NEG_INF / 2)):
                worst[name] = float("inf")  # a different mask
            elif live.any():
                worst[name] = max(worst[name], float(np.max(np.abs(mine[live] - ref[live]))))
        worst["value"] = max(worst["value"], abs(out["value"] - float(f["value"][i])))
        mismatched += int(not np.array_equal(act.as_array(pol.has_again), f["action"][i]))
    ok = mismatched == 0 and max(worst.values()) < TOL
    print(f"{fixture.name}: {n} decisions, actions {'all equal' if not mismatched else f'{mismatched} DIFFER'}, "
          f"max |diff| aircraft {worst['aircraft']:.1e} clearance {worst['clearance']:.1e} again {worst['again']:.1e} "
          f"value {worst['value']:.1e}, {1000 * t / n:.2f} ms per decision -> {'OK' if ok else 'FAIL'}")
    return ok


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", type=Path, default=Path.home() / ".cache" / "tada-lab" / "models")
    args = ap.parse_args()
    results = [check(fx, args.models.expanduser()) for fx in sorted((HERE / "fixtures").glob("*.npz"))]
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
