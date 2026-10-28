"""Convert a TADA policy checkpoint to safetensors (for the Rust/WebAssembly policy in browser/src/policy.rs).

    python3 inference/export_weights.py BUNDLE_DIR_OR_final_model.zip OUT.safetensors

Every tensor of the SB3 policy state dict keeps its name (e.g. `ar_net.encoder.ac_mlp.0.weight`) and is
stored as little-endian F32. The header metadata carries the bundle's run_meta.json (as a string, if
present) and the attention head count, which the weights do not determine. Needs numpy only.
"""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tada_policy import ATTENTION_HEADS, read_torch_state_dict  # noqa: E402


def load_checkpoint(path: Path) -> tuple[dict[str, np.ndarray], str | None]:
    """The state dict of a bundle dir (final_model.zip [+ run_meta.json]) or a final_model.zip."""
    meta = None
    if path.is_dir():
        if (path / "run_meta.json").exists():
            meta = (path / "run_meta.json").read_text()
        path = path / "final_model.zip"
    with zipfile.ZipFile(path) as z:
        return read_torch_state_dict(z.read("policy.pth")), meta


def write_safetensors(tensors: dict[str, np.ndarray], out: Path, metadata: dict[str, str]) -> None:
    header: dict = {"__metadata__": metadata}
    blobs, offset = [], 0
    for name, arr in tensors.items():
        data = np.ascontiguousarray(arr, dtype="<f4").tobytes()
        header[name] = {"dtype": "F32", "shape": list(arr.shape), "data_offsets": [offset, offset + len(data)]}
        blobs.append(data)
        offset += len(data)
    head = json.dumps(header, separators=(",", ":")).encode("utf-8")
    head += b" " * (-len(head) % 8)  # pad so the data starts 8-byte aligned (allowed by the format)
    with open(out, "wb") as f:
        f.write(len(head).to_bytes(8, "little"))
        f.write(head)
        for b in blobs:
            f.write(b)


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = Path(sys.argv[1]).expanduser(), Path(sys.argv[2]).expanduser()
    state, run_meta = load_checkpoint(src)
    metadata = {"attention_heads": str(ATTENTION_HEADS)}
    if run_meta is not None:
        metadata["run_meta"] = run_meta
    out.parent.mkdir(parents=True, exist_ok=True)
    write_safetensors(state, out, metadata)
    n = sum(int(np.prod(v.shape)) for v in state.values())
    print(f"{out}: {len(state)} tensors, {n} parameters, {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
