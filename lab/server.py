"""TADA Lab server: the built docs site plus a small job API that flies agents on generated scenarios.

    lab/run.sh                     # the local runner: 127.0.0.1:8800, for the published Lab page
    /home/leander/miniconda3/envs/tada/bin/python lab/server.py [--host 0.0.0.0] [--port 8800] [--build]

The Lab page finds its runner by itself: the server that served it, else http://localhost:8800, else
http://127.0.0.1:8800 (or a URL the viewer saved). So the published docs (GitHub Pages) fly agents on the
viewer's own machine: browsers treat http://localhost as a secure origin, and this server answers CORS
(and Chrome's private-network preflight) for the docs' origin and for localhost pages only. POSTs must be
JSON from an allowed origin, so another website cannot queue jobs on the runner.

Serves site/ (mkdocs build output; --build runs `mkdocs build` first) at /, the lab cache at
/lab-cache/, and:

    GET  /api/health               {ok, api, agents, cached}: what the page probes to find a runner
    GET  /api/catalog              agents, scenario parameters, curated seeds with the paper's outcomes
    POST /api/fly     {scenario, agent, mode, attempts}   -> {key, status, ...} (cached: done at once)
    POST /api/render  {key}                               -> render job for a finished flight
    POST /api/install {agent}                             -> download a registry bundle onto this machine
    GET  /api/job/<key>[?kind=render]                      -> status, progress, result
    GET  /api/scenario?<scenario params>                   -> every cached flight of that scenario

Each job is one lab/worker.py process in the code repo's tada env, with the environment variables
of the agent's run (run_meta.json: action set, airport mask, sequence features, reselection) and
of the scenario (TADA_GENERATOR). Results are cached under lab/cache/ by a key that names the
scenario, the agent and the mode, so a flight is computed once.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yaml

LAB = Path(__file__).resolve().parent
DOCS = LAB.parent
SITE = DOCS / "site"
CACHE = Path(os.environ.get("TADA_LAB_CACHE") or LAB / "cache")
REGISTRY = LAB / "registry.json"  # public agent bundles (GitHub release), written by lab/make_agent_bundles.py
MODELS = Path(os.environ.get("TADA_LAB_MODELS") or Path.home() / ".cache" / "tada-lab" / "models")
PY = os.environ.get("TADA_PY", "/home/leander/miniconda3/envs/tada/bin/python")
MKDOCS = os.environ.get("TADA_MKDOCS", "/home/leander/miniconda3/envs/tada/bin/mkdocs")
TADA_PAPER = Path("/home/leander/code/tada/tada-paper")

# The paper's agents (stage-3 fine-tunes) fix each procedure's MDP for the do-nothing baseline.
REFERENCE = {"tmb": "1_76", "pms": "1_77"}
PROCEDURES = {
    "tmb": {"label": "TMB", "name": "Trombone (MXP)", "use_case": 1},
    "pms": {"label": "PMS", "name": "Point merge (BGY)", "use_case": 2},
}
GENERATORS = {
    "monad": {"label": "MONAD-aligned", "detail": "5 NM AMAN spacing, no random extra TTL: the multi-agent team's generator, paper figures v5"},
    "legacy": {"label": "Legacy", "detail": "10 NM AMAN spacing + random extra TTL: what every agent trained on, figures v2-v4"},
}
MODES = {"det", "sampled", "search"}
API_VERSION = 1
# Pages allowed to call the runner from another origin, besides localhost pages and the runner's own origin.
PUBLIC_ORIGINS = {"https://leander-grech.github.io"}
LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")
PUBLIC_LAB = "https://leander-grech.github.io/tada-single-agent-docs/lab/"
FLY_WORKERS = int(os.environ.get("TADA_LAB_FLY_WORKERS", "4"))
RENDER_WORKERS = int(os.environ.get("TADA_LAB_RENDER_WORKERS", "2"))


# --------------------------------------------------------------------------------------
# catalog
# --------------------------------------------------------------------------------------

def _run_meta(run_dir: Path) -> dict:
    p = run_dir / "run_meta.json"
    return json.loads(p.read_text()) if p.exists() else {}


def _headline(code_repo: Path, path: str | None, ckpt: str) -> dict | None:
    """Deterministic policy on the 100 validation seeds (legacy generator): solved and LoS counts."""
    if not path or not (code_repo / path).exists():
        return None
    rows = [r for r in csv.DictReader(open(code_repo / path)) if r.get("attempt", "0") == "0"]
    if rows and "model" in rows[0] and len({r["model"] for r in rows}) > 1:
        rows = [r for r in rows if r["model"].endswith(ckpt)]  # a file scoring several models
    if not rows:
        return None
    n = len(rows)
    # older scorer files have no solved column: solved = every flight on time and no LoS
    solved = sum((r["solved"] == "True") if "solved" in r else (r["all_on_time"] == "True" and r["sep"] != "True")
                 for r in rows)
    return {"n": n, "solved": solved, "los": sum(r["sep"] == "True" for r in rows)}


def _env_of(meta: dict) -> tuple[str, dict] | None:
    """(procedure, env vars) of a run from its run_meta.json; None for runs the lab leaves out."""
    wcfg = meta.get("windowed_config") or {}
    use_case = int(wcfg.get("use_case") or 1)
    action_set = str(meta.get("action_set") or "v2").lower()
    if use_case == 2 and action_set != "v2pms":
        return None  # point merge under the old action model (before 1_56): not the agreed procedure
    env = {"TADA_ACTION_SET": action_set}
    if meta.get("airport_mask"):
        env["TADA_AIRPORT_MASK"] = str(meta["airport_mask"])
    if meta.get("sequence_obs"):
        env["TADA_SEQUENCE_OBS"] = "1"
    if meta.get("max_picks"):
        env["TADA_MAX_PICKS"] = str(int(meta["max_picks"]))
    return ("pms" if use_case == 2 else "tmb"), env


def load_registry() -> dict:
    return json.loads(REGISTRY.read_text()) if REGISTRY.exists() else {"agents": []}


def build_catalog(registry_only: bool = False) -> dict:
    """Agents the runner can fly or download. Installed: checkpoints in the code repo (unless
    registry_only) and bundles downloaded from the registry into MODELS. Downloadable: registry bundles
    not installed yet (installed only when the page's Download button asks for it)."""
    reg = yaml.safe_load((DOCS / "models.yaml").read_text())
    code_repo = Path(os.environ.get("TADA_CODE_REPO") or reg["code_repo"])
    models = {str(m["id"]): m for m in reg["models"]}
    public = {str(e["id"]): e for e in load_registry()["agents"]}
    agents = []

    def entry(m: dict, ckpt: Path | None, meta: dict, source: str, proc_env=None) -> dict:
        proc, env = proc_env or _env_of(meta)
        name = f"{m['run'].split('/')[-1]}/{m.get('checkpoint', 'final_model.zip')}"
        return {
            "id": str(m["id"]), "procedure": proc, "checkpoint": str(ckpt) if ckpt else None,
            "installed": ckpt is not None, "source": source, "public": str(m["id"]) in public,
            "parent": m.get("parent"), "status": m.get("status"), "trainer": meta.get("trainer") or "sb3",
            "whats_new": m.get("whats_new", ""), "note": m.get("note", ""),
            "headline": _headline(code_repo, (m.get("evals") or {}).get("f20"), name),
            "env": env, "card": f"models/{m['id']}/",
        }

    seen = set()
    for m in reg["models"]:
        if m.get("track") != "windowed":
            continue  # the 10-aircraft env ran on simulator 0.1.52: its scenarios cannot be regenerated
        mid = str(m["id"])
        run_dir = code_repo / m["run"]
        ckpt = run_dir / m.get("checkpoint", "final_model.zip")
        if registry_only or not ckpt.exists():
            continue  # registry_only: what a machine without experiments/ sees (registry agents only, below)
        meta = _run_meta(run_dir)
        if _env_of(meta) is None:
            continue
        agents.append(entry(m, ckpt, meta, "code repo"))
        seen.add(mid)
    for mid, e in public.items():
        if mid in seen:
            continue
        m = models.get(mid, {"id": mid, "run": e["run"]})
        home = MODELS / mid
        if (home / "final_model.zip").exists() and (home / "run_meta.json").exists():
            meta = _run_meta(home)
            agents.append(entry(m, home / "final_model.zip", meta, "downloaded"))
        else:
            a = entry(m, None, {"trainer": "public bundle"}, "registry", proc_env=(e["procedure"], {}))
            a["download"] = {"size": e["size"], "url": e["url"]}
            agents.append(a)
    agents.sort(key=lambda a: [int(x) if x.isdigit() else x for x in re.split(r"[_]", a["id"])], reverse=True)
    by_id = {a["id"]: a for a in agents}
    for proc, ref in REFERENCE.items():
        if ref in by_id:
            by_id[ref]["paper"] = True
    code_ok = (code_repo / "render_policy.py").exists()
    return {"code_repo": str(code_repo), "code_ok": code_ok, "agents": agents, "procedures": PROCEDURES,
            "generators": GENERATORS, "reference": REFERENCE, "curated": curated_seeds(code_repo) if code_ok else {}}


def curated_seeds(code_repo: Path) -> dict:
    """The paper's 100 curated seeds per procedure, with difficulty (worst |AMAN TTL/TTG|) and the
    paper's outcomes on them (MONAD generator, 20 flights): policy and policy + search at attempt 0,
    and the multi-agent result when its sheet is present."""
    raw = code_repo / "paper_results" / "raw_v5"
    try:
        seeds = [int(s) for s in (code_repo / "paper_results" / "seeds_curated.txt").read_text().split()]
    except FileNotFoundError:
        return {}
    out = {}
    for proc in PROCEDURES:
        diff: dict[int, float] = {}
        pol: dict[int, dict] = {}
        srch: dict[int, dict] = {}
        try:
            for r in csv.DictReader(open(raw / f"policy_{proc}_extra_aircraft.csv")):
                if r["attempt"] == "0":
                    s = int(r["seed"])
                    diff[s] = max(diff.get(s, 0.0), abs(float(r["aman_ttl_s"])))
            for r in csv.DictReader(open(raw / f"policy_{proc}_extra.csv")):
                if r["attempt"] == "0":
                    pol[int(r["seed"])] = {"solved": r["solved"] == "True", "los": r["sep"] == "True"}
            for r in csv.DictReader(open(raw / f"{proc}_episodes.csv")):
                if r["attempt"] == "0":
                    srch[int(r["seed"])] = {"solved": r["solved"] == "True", "los": r["sep"] == "True"}
        except FileNotFoundError:
            pass
        out[proc] = [{"seed": s, "difficulty": round(diff.get(s, 0.0), 1), "policy": pol.get(s), "search": srch.get(s)}
                     for s in seeds]
    return out


# --------------------------------------------------------------------------------------
# jobs
# --------------------------------------------------------------------------------------

def scenario_key(sc: dict) -> str:
    return f"{sc['generator']}-{sc['procedure']}-f{sc['flights']}-x{sc['segments']}-s{sc['seed']}"


def flight_key(sc: dict, agent: str, mode: str, attempts: int) -> str:
    m = f"sampled{attempts}" if mode == "sampled" else mode
    return f"{scenario_key(sc)}--{agent}--{m}"


def clean_scenario(raw: dict) -> dict:
    proc = str(raw.get("procedure", "tmb")).lower()
    gen = str(raw.get("generator", "monad")).lower()
    if proc not in PROCEDURES or gen not in GENERATORS:
        raise ValueError("unknown procedure or generator")
    flights = int(raw.get("flights", 20))
    segments = int(raw.get("segments", 1))
    seed = int(raw.get("seed", 41))
    if not (2 <= flights <= 40 and 1 <= segments <= 3 and 0 <= seed < 2**31):
        raise ValueError("flights 2-40, segments 1-3, seed 0..2^31-1")
    return {"procedure": proc, "generator": gen, "flights": flights, "segments": segments, "seed": seed}


class Lab:
    def __init__(self, registry_only: bool = False):
        CACHE.mkdir(parents=True, exist_ok=True)
        self.registry_only = registry_only
        self.reload()
        self.fly_pool = ThreadPoolExecutor(FLY_WORKERS, thread_name_prefix="fly")
        self.render_pool = ThreadPoolExecutor(RENDER_WORKERS, thread_name_prefix="render")
        self.jobs: dict[tuple[str, str], dict] = {}  # (kind, key) -> state
        self.lock = threading.Lock()
        self.index = self._load_index()

    def reload(self) -> None:
        self.catalog = build_catalog(self.registry_only)
        self.agents = {a["id"]: a for a in self.catalog["agents"]}

    # -- downloads: only when the page asks, only registry bundles, hash-checked ---------------
    def submit_install(self, agent: str) -> dict:
        e = {str(x["id"]): x for x in load_registry()["agents"]}.get(agent)
        if e is None:
            raise ValueError(f"{agent} is not in the public registry")
        if self.agents.get(agent, {}).get("installed"):
            return {"key": agent, "kind": "install", "status": "done", "stage": "done", "frac": 1.0, "error": None}
        with self.lock:
            st = self.jobs.get(("install", agent))
            if st and st["status"] in ("queued", "running"):
                return self._public(st)
            st = {"key": agent, "kind": "install", "status": "running", "stage": "downloading", "frac": 0.0,
                  "submitted": time.time(), "error": None}
            self.jobs[("install", agent)] = st
        threading.Thread(target=self._install, args=(e, st), daemon=True).start()
        return self._public(st)

    def _install(self, e: dict, st: dict) -> None:
        import shutil
        import tempfile
        import urllib.request
        import zipfile

        mid = str(e["id"])
        MODELS.mkdir(parents=True, exist_ok=True)
        tmp = Path(tempfile.mkdtemp(prefix=f".{mid}-", dir=MODELS))
        try:
            h = hashlib.sha256()
            zpath = tmp / e["file"]
            with urllib.request.urlopen(e["url"], timeout=60) as r, open(zpath, "wb") as fh:
                total = int(r.headers.get("Content-Length") or e["size"])
                got = 0
                while chunk := r.read(1 << 16):
                    fh.write(chunk); h.update(chunk); got += len(chunk)
                    st["frac"] = min(0.99, got / max(1, total))
            if h.hexdigest() != e["sha256"]:
                raise RuntimeError(f"sha256 mismatch for {e['file']}: the download is not the registered bundle")
            st["stage"] = "unpacking"
            want = {f"{mid}/{n}" for n in ("final_model.zip", "run_meta.json", "vecnormalize.pkl", "README.txt")}
            with zipfile.ZipFile(zpath) as z:
                names = set(z.namelist())
                if not names <= want or f"{mid}/final_model.zip" not in names:
                    raise RuntimeError(f"unexpected bundle contents {sorted(names)}")
                z.extractall(tmp)
            dest = MODELS / mid
            if dest.exists():
                shutil.rmtree(dest)
            os.replace(tmp / mid, dest)
            with self.lock:
                self.reload()
            st["status"], st["stage"], st["frac"] = "done", "done", 1.0
        except Exception as ex:  # noqa: BLE001
            st["status"], st["error"] = "error", str(ex)[-800:]
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # cached flights: key -> summary row, for the per-scenario comparison
    def _load_index(self) -> dict:
        idx = {}
        for p in CACHE.glob("*.json"):
            if p.name.endswith(".job.json"):
                continue
            try:
                d = json.loads(p.read_text())
            except Exception:  # noqa: BLE001
                continue
            idx[p.stem] = self._index_row(p.stem, d)
        return idx

    @staticmethod
    def _index_row(key: str, d: dict) -> dict:
        j = d["job"]
        return {"key": key, "scenario": scenario_key(j["scenario"]), "agent": j["agent"], "mode": j["mode"],
                "attempts": j.get("attempts", 0), "summary": d["summary"], "chosen_attempt": d["chosen_attempt"],
                "elapsed_s": d.get("elapsed_s"), "has_video": (CACHE / f"{key}.mp4").exists()}

    def _env_for(self, agent_id: str, sc: dict) -> tuple[dict, str]:
        ref = self.agents[REFERENCE[sc["procedure"]] if agent_id == "do-nothing" else agent_id]
        if not ref.get("installed"):
            raise ValueError(f"download {ref['id']} first")
        env = {k: v for k, v in os.environ.items()
               if not k.startswith("TADA_") or k in ("TADA_CODE_REPO",)}
        env.update(OMP_NUM_THREADS="1", RAYON_NUM_THREADS="1", MKL_NUM_THREADS="1",
                   TADA_GENERATOR=sc["generator"], TADA_CODE_REPO=self.catalog["code_repo"], **ref["env"])
        return env, ref["checkpoint"]

    def submit_fly(self, body: dict) -> dict:
        sc = clean_scenario(body.get("scenario") or {})
        agent = str(body.get("agent"))
        mode = str(body.get("mode", "det"))
        attempts = int(body.get("attempts", 0)) if mode == "sampled" else 0
        if agent != "do-nothing" and agent not in self.agents:
            raise ValueError(f"unknown agent {agent}")
        if agent == "do-nothing":
            mode, attempts = "det", 0
        elif self.agents[agent]["procedure"] != sc["procedure"]:
            raise ValueError(f"{agent} flies {self.agents[agent]['procedure'].upper()}, not {sc['procedure'].upper()}")
        if mode not in MODES or not (0 <= attempts <= 30):
            raise ValueError("mode det|sampled|search, attempts 0-30")
        key = flight_key(sc, agent, mode, attempts)
        if not (CACHE / f"{key}.json").exists():
            self._need_installed(agent, sc)
        job = {"scenario": sc, "agent": agent, "mode": mode, "attempts": attempts, **sc,
               "use_case": PROCEDURES[sc["procedure"]]["use_case"]}
        return self._submit("fly", key, job)

    def submit_render(self, key: str) -> dict:
        if not re.fullmatch(r"[\w.-]+", key) or not (CACHE / f"{key}.json").exists():
            raise ValueError("fly it first")
        flight = json.loads((CACHE / f"{key}.json").read_text())
        if not (CACHE / f"{key}.mp4").exists():
            self._need_installed(flight["job"]["agent"], flight["job"]["scenario"])
        return self._submit("render", key, flight["job"])

    def _need_installed(self, agent: str, sc: dict) -> None:
        """Flying needs the checkpoint on this machine; do-nothing needs the procedure's paper agent (its MDP)."""
        mid = REFERENCE[sc["procedure"]] if agent == "do-nothing" else agent
        a = self.agents.get(mid)
        if a is None or not a.get("installed"):
            raise ValueError(f"download {mid} first" + (" (do-nothing flies in its MDP)" if agent == "do-nothing" else ""))

    def _submit(self, kind: str, key: str, job: dict) -> dict:
        out = CACHE / (f"{key}.json" if kind == "fly" else f"{key}.mp4")
        with self.lock:
            st = self.jobs.get((kind, key))
            if out.exists():
                return {"key": key, "kind": kind, "status": "done"}
            if st and st["status"] in ("queued", "running"):
                return self._public(st)
            st = {"key": key, "kind": kind, "status": "queued", "stage": "queued", "frac": None,
                  "submitted": time.time(), "error": None}
            self.jobs[(kind, key)] = st
        pool = self.fly_pool if kind == "fly" else self.render_pool
        pool.submit(self._run, kind, key, job, st)
        return self._public(st)

    @staticmethod
    def _public(st: dict) -> dict:
        return {k: st[k] for k in ("key", "kind", "status", "stage", "frac", "error")}

    def _run(self, kind: str, key: str, job: dict, st: dict) -> None:
        st["status"], st["stage"] = "running", "starting"
        try:
            env, env_model = self._env_for(job["agent"], job["scenario"])
        except Exception as e:  # noqa: BLE001
            st["status"], st["error"] = "error", str(e)
            return
        job = {**job, "env_model": env_model}
        jf = CACHE / f"{key}.{kind}.job.json"
        jf.write_text(json.dumps(job))
        if kind == "fly":
            cmd = [PY, str(LAB / "worker.py"), "fly", str(jf), str(CACHE / f"{key}.json.part")]
        else:
            cmd = [PY, str(LAB / "worker.py"), "render", str(jf), str(CACHE / f"{key}.json"), str(CACHE / f"{key}.mp4")]
        log_tail: list[str] = []
        try:
            proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
                                    cwd=self.catalog["code_repo"])
            for line in proc.stderr:
                line = line.rstrip()
                if line.startswith("{\"stage\""):
                    try:
                        p = json.loads(line)
                        st["stage"], st["frac"] = p["stage"], p["frac"]
                    except json.JSONDecodeError:
                        pass
                elif line and not line.startswith("[config"):
                    log_tail = (log_tail + [line])[-15:]
            rc = proc.wait()
            if rc != 0:
                raise RuntimeError("\n".join(log_tail[-6:]) or f"worker exited {rc}")
            if kind == "fly":
                os.replace(CACHE / f"{key}.json.part", CACHE / f"{key}.json")
                d = json.loads((CACHE / f"{key}.json").read_text())
                self.index[key] = self._index_row(key, d)
            else:
                if key in self.index:
                    self.index[key]["has_video"] = True
            st["status"], st["stage"], st["frac"] = "done", "done", 1.0
        except Exception as e:  # noqa: BLE001
            st["status"], st["error"] = "error", str(e)[-1500:]
        finally:
            jf.unlink(missing_ok=True)

    def status(self, kind: str, key: str) -> dict:
        if kind == "install":
            st = self.jobs.get(("install", key))
            if st:
                return self._public(st)
            done = self.agents.get(key, {}).get("installed")
            return {"key": key, "kind": kind, "status": "done" if done else "missing", "stage": None,
                    "frac": 1.0 if done else None, "error": None}
        out = CACHE / (f"{key}.json" if kind == "fly" else f"{key}.mp4")
        st = self.jobs.get((kind, key))
        if st and st["status"] != "done":
            return self._public(st)
        if out.exists():
            return {"key": key, "kind": kind, "status": "done", "stage": "done", "frac": 1.0, "error": None}
        return {"key": key, "kind": kind, "status": "missing", "stage": None, "frac": None, "error": None}

    def scenario_rows(self, sc: dict) -> list[dict]:
        sk = scenario_key(sc)
        rows = [r for r in self.index.values() if r["scenario"] == sk]
        for (kind, key), st in list(self.jobs.items()):
            if kind == "fly" and key.startswith(sk + "--") and st["status"] in ("queued", "running"):
                agent, mode = key.split("--")[1:3]
                rows.append({"key": key, "scenario": sk, "agent": agent, "mode": mode, "pending": True,
                             "stage": st["stage"]})
        return rows


# --------------------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    lab: Lab
    allowed_origins: set[str] = set(PUBLIC_ORIGINS)

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(SITE), **kw)

    def log_message(self, fmt, *args):
        if "/api/job/" not in str(args[0] if args else "") and "/lab-cache/" not in str(args[0] if args else ""):
            sys.stderr.write("[lab] %s - %s\n" % (self.address_string(), fmt % args))

    # -- cross-origin access (the published page calling a runner on localhost) -------------
    def _origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True  # same-origin GET, curl
        if origin in self.allowed_origins or LOCAL_ORIGIN.match(origin):
            return True
        return urlparse(origin).netloc == self.headers.get("Host", "")  # the runner's own pages (e.g. on the LAN)

    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin and self._origin_ok():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")  # Chrome's PNA preflight
        super().end_headers()

    def do_OPTIONS(self):
        if not self._origin_ok():
            return self.send_error(HTTPStatus.FORBIDDEN, "origin not allowed")
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _json(self, obj, code=200):
        data = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        try:
            if u.path == "/api/health":
                return self._json({"ok": True, "api": API_VERSION, "agents": len(self.lab.catalog["agents"]),
                                   "installed": sum(bool(a.get("installed")) for a in self.lab.catalog["agents"]),
                                   "cached": len(self.lab.index), "code_ok": self.lab.catalog["code_ok"]})
            if u.path == "/api/catalog":
                return self._json(self.lab.catalog)
            if u.path.startswith("/api/job/"):
                kind = parse_qs(u.query).get("kind", ["fly"])[0]
                return self._json(self.lab.status(kind, u.path.rsplit("/", 1)[1]))
            if u.path == "/api/scenario":
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                return self._json(self.lab.scenario_rows(clean_scenario(q)))
            if u.path.startswith("/lab-cache/"):
                return self._cache_file(u.path[len("/lab-cache/"):])
        except ValueError as e:
            return self._json({"error": str(e)}, 400)
        if not (SITE / "index.html").exists():
            return self._landing()
        return super().do_GET()

    def _landing(self):
        """A runner without a built site/: say what it is and where the page is."""
        if urlparse(self.path).path != "/":
            return self.send_error(HTTPStatus.NOT_FOUND)
        html = (f"<!doctype html><meta charset=utf-8><title>TADA Lab runner</title>"
                f"<body style='font:15px system-ui;background:#0a1324;color:#dfe7f3;padding:2rem'>"
                f"<h1 style='color:#ff4fd8'>TADA Lab runner</h1><p>Running, {len(self.lab.catalog['agents'])} agents. "
                f"Open the <a style='color:#3fd0ff' href='{PUBLIC_LAB}'>Lab page</a>; it connects to this runner.</p>").encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html)))
        self.end_headers()
        self.wfile.write(html)

    def do_POST(self):
        u = urlparse(self.path)
        if not self._origin_ok():
            return self._json({"error": "origin not allowed"}, 403)
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            return self._json({"error": "JSON only"}, 415)  # forces a CORS preflight on cross-origin callers
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0) or b"{}")
            if u.path == "/api/fly":
                return self._json(self.lab.submit_fly(body))
            if u.path == "/api/render":
                return self._json(self.lab.submit_render(str(body.get("key"))))
            if u.path == "/api/install":
                return self._json(self.lab.submit_install(str(body.get("agent"))))
        except ValueError as e:
            return self._json({"error": str(e)}, 400)
        self.send_error(HTTPStatus.NOT_FOUND)

    def _cache_file(self, name: str):
        """A cached flight (.json) or render (.mp4), with Range support so videos can seek."""
        if not re.fullmatch(r"[\w.-]+\.(json|mp4)", name) or not (CACHE / name).exists():
            return self.send_error(HTTPStatus.NOT_FOUND)
        path = CACHE / name
        size = path.stat().st_size
        ctype = "video/mp4" if name.endswith(".mp4") else "application/json"
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        if rng and (m := re.match(r"bytes=(\d*)-(\d*)", rng)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = size - int(m.group(2))
            end = min(end, size - 1)
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "max-age=3600")
        self.end_headers()
        with open(path, "rb") as fh:
            fh.seek(start)
            left = end - start + 1
            try:
                while left > 0:
                    chunk = fh.read(min(1 << 16, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1", help="0.0.0.0 to serve the LAN too")
    ap.add_argument("--port", type=int, default=8800)
    ap.add_argument("--build", action="store_true", help="run mkdocs build first")
    ap.add_argument("--allow-origin", action="append", default=[],
                    help=f"another page origin that may use this runner (always: {', '.join(sorted(PUBLIC_ORIGINS))}, localhost)")
    ap.add_argument("--open", action="store_true", help="open the published Lab page in the browser")
    ap.add_argument("--registry-only", action="store_true",
                    help="list only the public registry agents, as on a machine without the experiments")
    args = ap.parse_args()
    if args.build:
        subprocess.run([MKDOCS, "build", "-q"], cwd=DOCS, check=True)
    Handler.allowed_origins = set(PUBLIC_ORIGINS) | {o.rstrip("/") for o in args.allow_origin}
    Handler.lab = Lab(registry_only=args.registry_only)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    site = f", docs site at http://{args.host}:{args.port}/lab/" if (SITE / "index.html").exists() else ""
    print(f"[lab] runner up: {len(Handler.lab.catalog['agents'])} agents, {len(Handler.lab.index)} cached flights; "
          f"API on http://{args.host}:{args.port}/api{site}\n[lab] published Lab page: {PUBLIC_LAB}", flush=True)
    if args.open:
        import webbrowser

        webbrowser.open(PUBLIC_LAB)
    server.serve_forever()


if __name__ == "__main__":
    main()
