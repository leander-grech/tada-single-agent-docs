#!/usr/bin/env python
"""Register backfilled evaluations and renders from the code repo into models.backfill.yaml.

    python tools/import_backfill.py [--code-repo PATH] [--dir analysis/2026-09-27_scratch/backfill]

Reads (never writes) the code repo:
    <dir>/eval/<model>_<item>.csv                          item: f20 | s2x20 | att10 | la4 | d100 (10-aircraft)
    <dir>/renders/<model>_<slot>_seed<S>.mp4 + <same>_solutions.json

Copies each render into docs/assets/renders/ (skipped if an identical file is already there) and
writes models.backfill.yaml, which tools/build_model_docs.py merges into models.yaml: evaluations
only for batteries a model does not already have, renders appended. Rerun it whenever more files
land; the output is rebuilt from scratch each time.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
RENDERS = ROOT / "docs" / "assets" / "renders"
ITEMS = {"f20", "s2x20", "att10", "la4", "d100"}


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--code-repo", default=os.environ.get("TADA_CODE_REPO"))
    ap.add_argument("--dir", default="analysis/2026-09-27_scratch/backfill")
    args = ap.parse_args()
    reg = yaml.safe_load(open(ROOT / "models.yaml"))
    code = Path(args.code_repo or reg["code_repo"])
    # every backfill folder (each with eval/ and renders/): --dir plus models.yaml test_sources.backfill_dirs
    # test_sources.backfill_dirs are job folders a watcher syncs from rented hosts: only their committed
    # files count, so nothing is published before the training session has reviewed and committed it.
    import subprocess
    gated = [code / d for d in reg.get("test_sources", {}).get("backfill_dirs", [])]
    bases = [code / args.dir] + gated
    committed = set()
    for g in gated:
        committed |= {str(code / f) for f in subprocess.run(["git", "-C", str(code), "ls-files", str(g.relative_to(code))],
                                                             capture_output=True, text=True).stdout.split()}
    ok = lambda p: not any(g in p.parents for g in gated) or str(p) in committed
    ids = {str(m["id"]) for m in reg["models"]}

    def use_case(mid):
        m = next(m for m in reg["models"] if str(m["id"]) == mid)
        try:
            meta = json.load(open(code / m["run"] / "run_meta.json"))
            return meta.get("use_case") or (meta.get("windowed_config") or {}).get("use_case")
        except (OSError, ValueError):
            return None

    def key_for(mid, pms, bat):
        """Evaluation key for a file named <mid>[_pms]_<bat>: a point-merge-trained run's _pms files are its
        own scores; an MXP agent's _pms_f20 is a zero-shot score; anything else would mix scenarios."""
        trained_pms = use_case(mid) == 2
        if pms and trained_pms:
            return bat
        if pms and bat == "f20":
            return "zs_pms_f20"
        if not pms and not trained_pms:
            return bat
        return None
    existing = {str(m["id"]): set((m.get("evals") or {}).keys()) for m in reg["models"]}
    out: dict[str, dict] = {}
    skipped = []

    for base in bases:
        for csv in sorted((base / "eval").glob("*.csv")) if (base / "eval").exists() else []:
            if not ok(csv):
                skipped.append(f"{csv.name} (not committed yet)")
                continue
            mt = re.fullmatch(r"(.+)_(f20|s2x20|att10|la4|d100)\.csv", csv.name)
            if mt and mt.group(1) not in ids:   # <id>_pms_<bat>, unless the whole stem is an id (e.g. 1_30_pms)
                mt = re.fullmatch(r"(.+?)(_pms)?_(f20|s2x20|att10|la4|d100)\.csv", csv.name)
            elif mt:
                mt = re.fullmatch(r"(.+)()_(f20|s2x20|att10|la4|d100)\.csv", csv.name)
            if not mt or mt.group(1) not in ids or key_for(mt.group(1), bool(mt.group(2)), mt.group(3)) is None:
                skipped.append(csv.name)
                continue
            mid, item = mt.group(1), key_for(mt.group(1), bool(mt.group(2)), mt.group(3))
            if item in existing[mid]:
                skipped.append(f"{csv.name} (models.yaml already has {item})")
                continue
            out.setdefault(mid, {}).setdefault("evals", {})[item] = str(csv.relative_to(code))

        for mp4 in sorted((base / "renders").glob("*.mp4")) if (base / "renders").exists() else []:
            mt = re.fullmatch(r"(.+?)_(comparison|best|failure|feas40_best)_seed(\d+)\.mp4", mp4.name)
            meta = mp4.with_name(mp4.stem + "_solutions.json")
            if not ok(meta):   # videos are gitignored in the code repo; their committed metadata stands for them
                skipped.append(f"{mp4.name} (not committed yet)")
                continue
            if not mt or mt.group(1) not in ids or not meta.exists():
                skipped.append(mp4.name + ("" if meta.exists() else " (no _solutions.json)"))
                continue
            dst = RENDERS / mp4.name
            if not dst.exists() or md5(dst) != md5(mp4):
                shutil.copy2(mp4, dst)
            entry = {"file": mp4.name, "meta": str(meta.relative_to(code))}
            if mt.group(2) == "feas40_best":
                entry["stream"] = "the best feas40 stream (40 flights, feasible stitched 2×20)"
            out.setdefault(mt.group(1), {}).setdefault("renders", []).append(entry)

    # Feasible stitched 2x20 stream sets (feas40, test51): taken only once committed in the code repo,
    # so results still being produced are never published early.
    import subprocess
    for d in reg.get("test_sources", {}).get("feasible_2x20", []):
        tracked = subprocess.run(["git", "-C", str(code), "ls-files", d], capture_output=True, text=True).stdout.split()
        for rel in sorted(tracked):
            mt = re.fullmatch(r".*/(.+?)(_pms)?_(feas40|test51)(_la4)?\.csv", rel)
            if not mt or mt.group(1) not in ids:
                continue
            if bool(mt.group(2)) != (use_case(mt.group(1)) == 2):
                continue   # point-merge sets for MXP agents (or MXP sets for point-merge agents) are not imported
            out.setdefault(mt.group(1), {}).setdefault("evals", {})["fx_" + mt.group(3) + (mt.group(4) or "")] = rel

    # Zero-shot transfer to point merge (BGY, use case 2): MXP-trained agents scored unchanged; committed only.
    for d in reg.get("test_sources", {}).get("zeroshot_pms", []):
        tracked = subprocess.run(["git", "-C", str(code), "ls-files", d], capture_output=True, text=True).stdout.split()
        for rel in sorted(tracked):
            mt = re.fullmatch(r".*/(.+?)_pms_f20\.csv", rel)
            if not mt or mt.group(1) not in ids or use_case(mt.group(1)) == 2:
                continue
            out.setdefault(mt.group(1), {}).setdefault("evals", {})["zs_pms_f20"] = rel

    # Long-stream evaluations (60- and 100-flight stitched streams) and the Phase-0 order-first data.
    for d in reg.get("test_sources", {}).get("longstreams", []):
        for csv in sorted((code / d).glob("*.csv")):
            mt = re.fullmatch(r"(.+?)_(k[35]_(?:feasible|all)(?:_la4)?)\.csv", csv.name)
            if not mt or mt.group(1) not in ids:
                continue
            out.setdefault(mt.group(1), {}).setdefault("evals", {})["ls_" + mt.group(2)] = str(csv.relative_to(code))
    for d in reg.get("test_sources", {}).get("phase0", []):
        for js in sorted((code / d).glob("*.jsonl")):
            mid = next((str(m["id"]) for m in reg["models"] if js.stem == Path(m["run"]).name), None)
            if mid:
                out.setdefault(mid, {}).setdefault("evals", {})["phase0"] = str(js.relative_to(code))

    header = ("# Generated by tools/import_backfill.py from the code repo's backfill directory.\n"
              "# Merged into models.yaml by tools/build_model_docs.py. Do not edit by hand; rerun the importer.\n")
    with open(ROOT / "models.backfill.yaml", "w") as f:
        f.write(header)
        yaml.safe_dump({"source": args.dir, "models": out}, f, sort_keys=True, width=200)
    n_e = sum(len(v.get("evals", {})) for v in out.values())
    n_r = sum(len(v.get("renders", [])) for v in out.values())
    print(f"registered {n_e} evaluations and {n_r} renders for {len(out)} models")
    for s in skipped:
        print("  skipped:", s)


if __name__ == "__main__":
    sys.exit(main())
