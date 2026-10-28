"""Record parity fixtures for inference/check_parity.py: real observations plus the torch policy's outputs.

Needs the TADA single-agent code and its environment (torch, SB3, the simulator); the check itself does not.
Flies one deterministic episode with the scorer's seeding and stores, for every decision, the observation,
the torch policy's masked logits and value, and the action it took.

    TADA_ACTION_SET=v2 TADA_AIRPORT_MASK=monad TADA_SEQUENCE_OBS=1 TADA_MAX_PICKS=2 TADA_GENERATOR=monad \\
      python inference/make_fixtures.py --code-repo PATH --agent ~/.cache/tada-lab/models/1_76 \\
      --use-case 1 --seed 41 --out inference/fixtures/1_76_tmb_s41.npz
(1_77: TADA_ACTION_SET=v2pms, no TADA_AIRPORT_MASK, --use-case 2)
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import numpy as np


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--code-repo", required=True, type=Path)
    ap.add_argument("--agent", required=True, type=Path, help="bundle dir with final_model.zip + run_meta.json")
    ap.add_argument("--use-case", type=int, required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--flights", type=int, default=20)
    ap.add_argument("--max-steps", type=int, default=400)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()
    args.out = args.out.resolve()        # before the chdir below
    args.agent = args.agent.expanduser().resolve()
    os.chdir(args.code_repo)
    sys.path.insert(0, str(args.code_repo))
    import torch
    from analysis import score_windowed as sw

    torch.set_num_threads(1)
    model_path = str(args.agent.expanduser() / "final_model.zip")
    sw._init_worker([model_path], args.flights, False, 1, (120.0, 900.0), 0, 0, args.use_case)
    model, env = sw._MODELS[0], sw._ENV
    policy = model.policy

    torch.manual_seed((args.seed * 1009) % (2**31))
    np.random.seed(args.seed % (2**32))
    obs, _ = env.reset(seed=args.seed, options={"scenario_seed": args.seed})
    keys = sorted(obs)
    rec = {k: [] for k in keys}
    out = {"aircraft_logits": [], "clearance_logits": [], "again_logits": [], "value": [], "action": []}
    done, steps = False, 0
    while not done and steps < args.max_steps:
        with torch.no_grad():
            t_obs, _ = policy.obs_to_tensor(obs)
            a_l, c_l, g_l, v = policy._masked_heads(t_obs)
        action, _ = model.predict(obs, deterministic=True)
        for k in keys:
            rec[k].append(np.asarray(obs[k]))
        out["aircraft_logits"].append(a_l[0].numpy())
        out["clearance_logits"].append(c_l[0].numpy())
        out["again_logits"].append(g_l[0].numpy() if g_l is not None else np.zeros_like(c_l[0].numpy()))
        out["value"].append(float(v[0]))
        out["action"].append(np.asarray(action).ravel())
        obs, _r, term, trunc, _info = env.step(action)
        done = term or trunc
        steps += 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, **{f"obs/{k}": np.stack(v) for k, v in rec.items()},
                        **{k: np.stack(v) for k, v in out.items()}, seed=args.seed, use_case=args.use_case)
    print(f"wrote {args.out}: {steps} decisions")


if __name__ == "__main__":
    main()
