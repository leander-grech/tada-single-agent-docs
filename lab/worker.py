"""TADA Lab worker: fly one agent on one generated scenario, or render that flight to MP4.

Runs inside the code repo's `tada` env, one process per job, because the action set, observation
width, reselection and scenario generator are all read from environment variables when
config.config is imported (lab/server.py sets them from the model's run_meta.json).

    python lab/worker.py fly    <job.json> <out.json>
    python lab/worker.py render <job.json> <flight.json> <out.mp4>

Every episode is flown exactly as analysis/score_windowed.py scores it (scenario and observation
frame pinned by the seed, attempt 0 deterministic, attempt a >= 1 sampled with torch seed
seed * 1009 + a), so a lab flight of a curated seed is the paper's episode. The search agent is
analysis/rollout_search.search_episode, as paper_results/run_best_agent.py flies it. A render
replays the flight's executed actions through render_policy.play_episode, frame pinned the same
way, and checks the replay reproduced the flight.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
CODE_REPO = Path(os.environ.get("TADA_CODE_REPO",
                                "/home/leander/code/tada/monorepo/reinforcement_learning/single_agent_rllib"))
os.chdir(CODE_REPO)
sys.path.insert(0, str(CODE_REPO))
os.environ.setdefault("MPLBACKEND", "Agg")

import numpy as np  # noqa: E402


def _progress(stage: str, frac: float | None = None) -> None:
    """One progress line on stderr; the server forwards the last one to the page."""
    print(json.dumps({"stage": stage, "frac": frac}), file=sys.stderr, flush=True)


def _init_env(job: dict):
    """score_windowed's worker init: the model, and the env of the MDP its run trained in."""
    from analysis import score_windowed as sw

    sw._init_worker([job["env_model"]], int(job["flights"]), False, int(job["segments"]),
                    (120.0, 900.0), 0, 0, int(job["use_case"]))
    if job["agent"] == "do-nothing":
        sw._MODELS[0] = None  # the checkpoint only fixes the MDP; nothing is ever commanded
    return sw


# --------------------------------------------------------------------------------------
# trace recording (read-only observer, executed steps only)
# --------------------------------------------------------------------------------------

class TraceObserver:
    """Chains analysis/paper_results.PaperObserver (per-flight outcome, pick tally) with a
    per-step trace of the world for the page's replay: positions, status and predicted landing
    deviation of every flight, and each issued clearance. Records every attempt; the caller keeps
    the best one's."""

    def __init__(self, paper_obs):
        self.paper = paper_obs
        self.traces: list[dict] = []
        self._cur: dict | None = None

    def begin(self, env, obs, seed, attempt):
        self.paper.begin(env, obs, seed, attempt)
        world = env.simulator.world
        queue = sorted(env._eta, key=env._eta.get)
        routes = {}
        for ac in world.aircraft:
            pts = []
            for rp in (ac.route or []):
                wp = world.waypoints.get(rp.waypoint_name)
                if wp is not None:
                    pts.append([round(float(wp.position_nm.x), 2), round(float(wp.position_nm.y), 2)])
            routes[ac.call_sign] = pts
        self._cur = {
            "attempt": int(attempt),
            "queue": queue,
            "eta": {cs: round(float(env._eta[cs]), 1) for cs in queue},
            "routes": routes,
            "frames": [],
            "actions": [],   # executed (slot, clearance, again) per env.step: a replay reproduces the episode
            "events": [],    # non-DO_NOTHING clearances: {t, cs, clr, x, y}
        }
        self._frame(env)

    def _frame(self, env):
        world = env.simulator.world
        t = float(world.age_in_seconds)
        frames = self._cur["frames"]
        if frames and abs(frames[-1]["t"] - t) < 1e-6:
            frames.pop()  # a zero-time reselection pick: keep the latest state of this instant
        land_t = env._predicted_landing_times()
        ac_rows = []
        for ac in world.aircraft:
            cs = ac.call_sign
            if ac.mission.completed:
                status = 2
            elif ac.under_control:
                status = 1
            else:
                status = 0
            p = ac.state.position_nm_nm_ft
            v = ac.state.velocity_knots
            dev = land_t.get(cs, env._eta.get(cs, 0.0)) - env._eta.get(cs, 0.0)
            ac_rows.append([cs, round(float(p.x), 2), round(float(p.y), 2), int(round(float(p.z))),
                            int(round(float(v.length()))), status, round(float(dev), 1)])
        frames.append({"t": round(t, 1), "ac": ac_rows})

    def before_step(self, env, obs, action):
        self.paper.before_step(env, obs, action)
        flat = np.asarray(action).ravel()
        self._pending = [int(x) for x in flat]

    def after_step(self, env, info):
        self.paper.after_step(env, info)
        cur = self._cur
        a_air, clr = int(info["aircraft_index"]), int(info["clearance"])
        cur["actions"].append([a_air, clr, int(info["again"])] if "again" in info else [a_air, clr])
        if clr != 0:
            cs = str(info.get("callsign"))
            x = y = None
            try:
                p = env.simulator.world.get_aircraft_by_callsign(cs).state.position_nm_nm_ft
                x, y = round(float(p.x), 2), round(float(p.y), 2)
            except Exception:  # noqa: BLE001  (landed this step)
                pass
            cur["events"].append({"t": round(float(env.simulator.world.age_in_seconds), 1), "cs": cs,
                                  "clr": clr, "x": x, "y": y})
        self._frame(env)

    def end(self, env, info):
        self.paper.end(env, info)
        rec = self.paper.records[-1]
        self._cur["record"] = rec
        self._cur["end_reason"] = str(info.get("end_reason"))
        self.traces.append(self._cur)
        self._cur = None


def _rank_key(rec: dict):
    """render_policy.Episode.rank_key for the windowed env: no loss of separation, then the sum of
    per-flight bracket values, then the fewest clearances."""
    m = rec["metrics"]
    return (not bool(m.get("had_separation", False)), float(m.get("window_bracket_score", 0.0)),
            -float(m.get("window_clearances", 0.0)))


def _summary(rec: dict) -> dict:
    m = rec["metrics"]
    n = int(m.get("window_n_flights", 0))
    landed = int(m.get("window_n_landed", 0))
    sep = bool(m.get("had_separation", False))
    max_dev = float(m.get("window_max_abs_landing_dev", 0.0))
    return {
        "end_reason": rec["end_reason"],
        "solved": bool(m.get("success", False)) and not sep,
        "hard_solved": (not sep) and n > 0 and landed >= n and max_dev <= 30.0,
        "los": sep,
        "n_flights": n,
        "landed": landed,
        "on_time": round(float(m.get("window_on_time_rate", 0.0)) * n),
        "mean_dev": round(float(m.get("window_mean_abs_landing_dev", 0.0)), 1),
        "max_dev": round(max_dev, 1),
        "clearances": int(rec["n_clearances"]),
        "bracket_score": float(m.get("window_bracket_score", 0.0)),
        "aman_order": float(m.get("window_aman_order_rate", 0.0)),
        "warning_pairs": int(rec.get("warning_pairs", 0)),
        "picks": {k: v for k, v in rec["picks"].items() if v},
        "min_separation_nm": m.get("min_separation_nm"),
    }


def fly(job: dict, out_path: str) -> None:
    from actions.action_set import Action
    from analysis import paper_results as pr

    t0 = time.time()
    _progress("loading model")
    sw = _init_env(job)
    obs = TraceObserver(pr.PaperObserver(int(job["use_case"])))
    seed = int(job["seed"])
    mode = job["mode"]

    attempts: list[dict] = []
    if mode == "search":
        from analysis import rollout_search as rs

        _progress("searching (K=8 rollouts, replan every 10 decisions)")
        row = rs.search_episode(sw._ENV, sw._MODELS[0], seed, 8, 10, attempt=0, observer=obs)
        search_stats = {k: row[k] for k in ("n_plans", "n_rollouts", "rollout_steps", "violations",
                                            "replay_mismatch", "fallbacks")}
    else:
        n_att = int(job.get("attempts", 0)) if mode == "sampled" else 0
        sw._OBSERVER = obs
        sw._ATTEMPTS = 0
        # one attempt at a time through the scorer's own loop, so progress can be reported
        import torch  # noqa: F401  (the scorer seeds it)

        for a in range(n_att + 1):
            _progress(f"attempt {a + 1} of {n_att + 1}" if n_att else "flying", a / (n_att + 1))
            sw._ATTEMPTS = 0
            _score_one_attempt(sw, seed, a)
        search_stats = None

    for tr in obs.traces:
        attempts.append({"attempt": tr["attempt"], **_summary({**tr["record"], "end_reason": tr["end_reason"]})})
    best = max(obs.traces, key=lambda tr: _rank_key(tr["record"]))
    rec = best["record"]
    names = {int(a): a.name for a in Action}
    result = {
        "job": job,
        "elapsed_s": round(time.time() - t0, 2),
        "chosen_attempt": best["attempt"],
        "attempts": attempts,
        "summary": _summary({**rec, "end_reason": best["end_reason"]}),
        "search": search_stats,
        "clearance_names": names,
        "flights": [{**f, "eta_s": round(f["eta_s"], 1), "initial": round(f["initial"], 1),
                     "aman_ttl": round(f["aman_ttl"], 1), "final": round(f["final"], 1)} for f in rec["flights"]],
        "trace": {k: best[k] for k in ("queue", "eta", "routes", "frames", "events")},
        "actions": best["actions"],
    }
    Path(out_path).write_text(json.dumps(result, separators=(",", ":")))
    _progress("done", 1.0)


def _score_one_attempt(sw, seed: int, attempt: int) -> None:
    """score_windowed._score_seed for exactly one attempt index (same seeding as its loop)."""
    import torch

    model = sw._MODELS[0]
    env = sw._ENV
    torch.manual_seed((int(seed) * 1009 + attempt) % (2**31))
    np.random.seed(int(seed) % (2**32))
    o, _ = env.reset(seed=int(seed), options={"scenario_seed": int(seed)})
    sw._OBSERVER.begin(env, o, int(seed), attempt)
    done, steps, info = False, 0, {}
    max_steps = (int(env.max_steps_per_episode) + 2) * max(1, int(getattr(env, "_max_picks", 1)))
    while not done and steps < max_steps:
        if model is None:
            slot = next(i for i, cs in enumerate(env._prev_aircraft_order) if cs)
            action = np.array([slot, 0, 0] if "mask_select" in o else [slot, 0])
        else:
            action, _ = model.predict(o, deterministic=attempt == 0)
        sw._OBSERVER.before_step(env, o, action)
        o, _r, terminated, truncated, info = env.step(action)
        sw._OBSERVER.after_step(env, info)
        done = terminated or truncated
        steps += 1
    sw._OBSERVER.end(env, info)


# --------------------------------------------------------------------------------------
# render: replay the flight's executed actions with frames
# --------------------------------------------------------------------------------------

def render(job: dict, flight_path: str, out_mp4: str) -> None:
    from types import SimpleNamespace

    import imageio

    import render_policy as rp
    from analysis.lookahead import env_config_for
    from atc_env.windowed_env import WindowedATCEnv
    from config.config import Config

    flight = json.loads(Path(flight_path).read_text())
    actions = [tuple(a) for a in flight["actions"]]
    _progress("building env")
    rp.check_checkpoint_compatible(job["env_model"])
    rp.sync_attention_to_checkpoint(job["env_model"])
    rp.sync_obs_width_to_checkpoint(job["env_model"])
    cfg = {
        "evaluation_mode": True,
        "render_predict_points": 12,
        "render_approach_zoom_nm": 25.0,
        "render_approach_view": "time",
        **env_config_for(job["env_model"]),
        "use_case": int(job["use_case"]),
        "stitch_segments": int(job["segments"]),
        "stitch_gap_s": (120.0, 900.0),
        "max_episode_steps_cap": 100_000,
        "scenario_aircraft_count": int(job["flights"]),
    }
    env = WindowedATCEnv(config=cfg)
    args = SimpleNamespace(stochastic=False, refuse_on_reward_drop=False, refuse_on_critical_conflict=False,
                           refuse_fallback="do_nothing", interstitial_frames=3, success_hold_frames=8,
                           fps=2, paired_attempts=0)

    # play_episode records frames as it goes; wrap env.render to report progress
    n_total = len(actions) + 1
    orig_render = env.render
    count = [0]

    def _render():
        count[0] += 1
        if count[0] % 5 == 0:
            _progress("drawing frames", min(0.99, count[0] / n_total))
        return orig_render()

    env.render = _render
    _progress("drawing frames", 0.0)
    ep = rp.play_episode(None, env, args, int(job["seed"]), record_frames=True, replay_actions=actions,
                         paired_attempt=int(flight["chosen_attempt"]) if job["mode"] != "search" else 0)
    want = flight["summary"]
    got_clr = sum(1 for a in ep.actions if a[1] != 0)
    if ep.end_reason != want["end_reason"] or got_clr != want["clearances"]:
        raise SystemExit(f"replay diverged: end {ep.end_reason} vs {want['end_reason']}, "
                         f"clearances {got_clr} vs {want['clearances']}")
    ep.attempt = int(flight["chosen_attempt"])
    _progress("encoding video", 0.99)
    tmp = out_mp4 + ".part.mp4"
    writer = imageio.get_writer(tmp, fps=2, macro_block_size=16)
    try:
        rp._write_episode(writer, ep, 0, 1, args, "none", 5)
    finally:
        writer.close()
    os.replace(tmp, out_mp4)
    _ = Config  # imported for its side effects on the env (action set) before the env exists
    _progress("done", 1.0)


if __name__ == "__main__":
    cmd = sys.argv[1]
    job = json.loads(Path(sys.argv[2]).read_text())
    if cmd == "fly":
        fly(job, sys.argv[3])
    elif cmd == "render":
        render(job, sys.argv[3], sys.argv[4])
    else:
        raise SystemExit(f"unknown command {cmd!r}")
