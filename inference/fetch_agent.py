"""Download a published agent bundle (lab/registry.json) and unpack it, checking its sha256.

    python inference/fetch_agent.py 1_76 [--dest ~/.cache/tada-lab/models]

Standard library only. The same location the lab runner installs to, so either one's download serves both.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

REGISTRY = Path(__file__).resolve().parent.parent / "lab" / "registry.json"


def fetch(agent: str, dest: Path) -> Path:
    entries = {str(e["id"]): e for e in json.loads(REGISTRY.read_text())["agents"]}
    if agent not in entries:
        raise SystemExit(f"{agent} is not in {REGISTRY} (published: {', '.join(entries)})")
    e = entries[agent]
    home = dest / agent
    if (home / "final_model.zip").exists():
        return home
    dest.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dest) as tmp:
        zpath = Path(tmp) / e["file"]
        with urllib.request.urlopen(e["url"], timeout=60) as r, open(zpath, "wb") as fh:
            shutil.copyfileobj(r, fh)
        digest = hashlib.sha256(zpath.read_bytes()).hexdigest()
        if digest != e["sha256"]:
            raise SystemExit(f"sha256 mismatch for {e['file']}: got {digest}, registry says {e['sha256']}")
        with zipfile.ZipFile(zpath) as z:
            bad = [n for n in z.namelist() if not n.startswith(f"{agent}/") or ".." in n]
            if bad:
                raise SystemExit(f"unexpected bundle contents {bad}")
            z.extractall(tmp)
        shutil.move(str(Path(tmp) / agent), home)
    return home


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("agent")
    ap.add_argument("--dest", type=Path, default=Path.home() / ".cache" / "tada-lab" / "models")
    args = ap.parse_args()
    print(fetch(args.agent, args.dest.expanduser()))


if __name__ == "__main__":
    main()
