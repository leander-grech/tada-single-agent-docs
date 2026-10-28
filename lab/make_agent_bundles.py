"""Package agents for public download and write lab/registry.json.

    python lab/make_agent_bundles.py OUT_DIR [--tag paper-agents-v1] [ID ...]   (default IDs: the paper agents)
    gh release create paper-agents-v1 OUT_DIR/*.zip --repo leander-grech/tada-single-agent-docs ...

One zip per agent, `tada-agent-<id>.zip`, holding the checkpoint, its run_meta.json (the MDP and action set the
lab runner builds the env from) and vecnormalize.pkl, plus a README. registry.json records each bundle's
release URL, size and sha256; the runner (lab/server.py) downloads a bundle only when the page's Download
button is pressed, checks the hash and unpacks it under ~/.cache/tada-lab/models/<id>/.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path

import yaml

LAB = Path(__file__).resolve().parent
DOCS = LAB.parent
REPO = "leander-grech/tada-single-agent-docs"
PAPER = {"1_76": "tmb", "1_77": "pms"}
PROC_NAME = {"tmb": "TMB, Milan Malpensa trombone (use case 1)", "pms": "PMS, Bergamo point merge (use case 2)"}
FILES = ("run_meta.json", "vecnormalize.pkl")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("ids", nargs="*", default=list(PAPER))
    ap.add_argument("--tag", default="paper-agents-v1")
    args = ap.parse_args()
    reg = yaml.safe_load((DOCS / "models.yaml").read_text())
    code = Path(reg["code_repo"])
    models = {str(m["id"]): m for m in reg["models"]}
    args.out.mkdir(parents=True, exist_ok=True)
    entries = []
    for mid in args.ids:
        m = models[mid]
        run = code / m["run"]
        ckpt = m.get("checkpoint", "final_model.zip")
        meta = json.loads((run / "run_meta.json").read_text())
        proc = "pms" if int((meta.get("windowed_config") or {}).get("use_case") or 1) == 2 else "tmb"
        name = f"tada-agent-{mid}.zip"
        readme = (f"TADA single-agent model {mid} ({PROC_NAME[proc]})\n\n{m.get('whats_new', '')}\n\n"
                  f"Files: {Path(ckpt).name} (Stable-Baselines3 PPO checkpoint), run_meta.json (the run's MDP, action set\n"
                  f"and observation settings), vecnormalize.pkl (reward normalisation statistics).\n"
                  f"Flying it needs the TADA single-agent code. Model card:\n"
                  f"https://leander-grech.github.io/tada-single-agent-docs/models/{mid}/\n")
        with zipfile.ZipFile(args.out / name, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(run / ckpt, f"{mid}/final_model.zip")
            for f in FILES:
                z.write(run / f, f"{mid}/{f}")
            z.writestr(f"{mid}/README.txt", readme)
        data = (args.out / name).read_bytes()
        entries.append({
            "id": mid, "procedure": proc, "run": Path(m["run"]).name,
            "url": f"https://github.com/{REPO}/releases/download/{args.tag}/{name}",
            "file": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
        })
        print(f"{name}: {len(data)} bytes")
    out = {"schema": 1, "release": args.tag, "repo": REPO, "agents": entries}
    (LAB / "registry.json").write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {LAB / 'registry.json'}")


if __name__ == "__main__":
    main()
