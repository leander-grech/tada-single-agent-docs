"""Bare-bones inference for the published TADA single-agent policies: numpy only.

No torch, no Stable-Baselines3, no TADA code. Reads the SB3 checkpoint (`final_model.zip`, as shipped in
the release bundles listed in lab/registry.json) with a small torch-free unpickler and evaluates the
autoregressive actor-critic network:

    per aircraft:  scalars -> Linear+LayerNorm+ReLU (128)
                   flight plan [20 x 11] -> Conv1d(64,k3) ReLU Conv1d(64,k3) ReLU, masked mean, Linear+ReLU (64)
                   action history [8 x 16] -> GRU(64), last hidden state
                   concat (256) -> Linear+LayerNorm+ReLU (128) -> masked self-attention (4 heads, dim 64), residual + LayerNorm
    context:       masked mean over aircraft (128) ++ global Linear+ReLU (128)
    heads:         aircraft [A], clearance [A, C], again [A, C] (reselection), value

then the policy's masking and its autoregressive choice: aircraft, then the clearance for that aircraft,
then (with reselection) whether to pick again in the same step.

    from tada_policy import Policy
    pol = Policy.load("~/.cache/tada-lab/models/1_76")      # bundle dir, or a final_model.zip
    action = pol.predict(obs)                                # obs: the env's observation dict
    out = pol.forward(obs)                                   # masked logits and value

`obs` is one observation (no batch dimension) with the env's keys: aircraft [A, 17], global [4],
flight_plans_rel [A, 20, 11], flight_plan_mask [A, 20], action_histories [A, 8, 16], mask_aircraft [A],
mask_action_per_ac [A, C], and with reselection mask_select [A] and mask_again [1].
Checked against the torch policy by inference/check_parity.py.
"""

from __future__ import annotations

import collections
import io
import json
import pickle
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

NEG_INF = -1e8          # the policy masks with a large finite negative, not -inf
DO_NOTHING = 0          # clearance index 0 in every action set
LN_EPS = 1e-5           # torch.nn.LayerNorm default
ATTENTION_HEADS = 4     # Config.ATTENTION_HEADS (not recoverable from the weights)
UNDER_CONTROL_COL = None  # only needed without mask_select (no published agent lacks it)


# ----------------------------------------------------------------------------------------------
# checkpoint loading without torch
# ----------------------------------------------------------------------------------------------

_STORAGE_DTYPES = {
    "FloatStorage": np.float32, "DoubleStorage": np.float64, "HalfStorage": np.float16,
    "LongStorage": np.int64, "IntStorage": np.int32, "ShortStorage": np.int16,
    "CharStorage": np.int8, "ByteStorage": np.uint8, "BoolStorage": np.bool_,
}


def _rebuild_tensor(storage, offset, size, stride, *_):
    itemsize = storage.dtype.itemsize
    if not size:
        return storage[offset:offset + 1].reshape(()).copy()
    return np.lib.stride_tricks.as_strided(
        storage[offset:], shape=tuple(size), strides=tuple(s * itemsize for s in stride)).copy()


def read_torch_state_dict(data: bytes) -> dict[str, np.ndarray]:
    """A torch.save'd state dict (zip format) as {name: numpy array}, without importing torch."""
    zf = zipfile.ZipFile(io.BytesIO(data))
    pkl = next(n for n in zf.namelist() if n.endswith("/data.pkl"))
    root = pkl[: -len("data.pkl")]
    byteorder = zf.read(root + "byteorder").decode() if root + "byteorder" in zf.namelist() else "little"
    if byteorder != "little":
        raise ValueError("big-endian checkpoints are not supported")

    class _Unpickler(pickle.Unpickler):
        def find_class(self, module, name):
            if module == "collections" and name == "OrderedDict":
                return collections.OrderedDict
            if module == "torch._utils" and name == "_rebuild_tensor_v2":
                return _rebuild_tensor
            if module == "torch" and name in _STORAGE_DTYPES:
                return _STORAGE_DTYPES[name]
            raise pickle.UnpicklingError(f"unexpected global {module}.{name} in checkpoint")

        def persistent_load(self, pid):
            _kind, dtype, key, _location, _numel = pid
            return np.frombuffer(zf.read(f"{root}data/{key}"), dtype=dtype)

    return dict(_Unpickler(io.BytesIO(zf.read(pkl))).load())


# ----------------------------------------------------------------------------------------------
# layers
# ----------------------------------------------------------------------------------------------

def _linear(x, w, b=None):
    y = x @ w.T
    return y + b if b is not None else y


def _layer_norm(x, g, b):
    mu = x.mean(-1, keepdims=True)
    var = ((x - mu) ** 2).mean(-1, keepdims=True)
    return (x - mu) / np.sqrt(var + LN_EPS) * g + b


def _relu(x):
    return np.maximum(x, 0.0)


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def _conv1d_k3(x, w, b):
    """x [N, Cin, T], w [Cout, Cin, 3], padding 1 -> [N, Cout, T]."""
    xp = np.pad(x, ((0, 0), (0, 0), (1, 1)))
    t = x.shape[-1]
    cols = np.stack([xp[..., k:k + t] for k in range(3)], axis=-1)    # [N, Cin, T, 3]
    return np.einsum("nitk,oik->not", cols, w) + b[None, :, None]


def _gru_last(x, w_ih, w_hh, b_ih, b_hh):
    """Single-layer GRU (torch gate order r, z, n), zero initial state; x [N, T, F] -> h_T [N, H]."""
    n, steps, _ = x.shape
    hid = w_hh.shape[1]
    h = np.zeros((n, hid), dtype=x.dtype)
    gi_all = x @ w_ih.T + b_ih                                          # [N, T, 3H]
    for t in range(steps):
        gi = gi_all[:, t]
        gh = h @ w_hh.T + b_hh
        r = _sigmoid(gi[:, :hid] + gh[:, :hid])
        z = _sigmoid(gi[:, hid:2 * hid] + gh[:, hid:2 * hid])
        cand = np.tanh(gi[:, 2 * hid:] + r * gh[:, 2 * hid:])
        h = (1.0 - z) * cand + z * h
    return h


def _softmax(x, axis=-1):
    m = np.max(x, axis=axis, keepdims=True)
    m = np.where(np.isfinite(m), m, 0.0)
    e = np.exp(x - m)
    s = e.sum(axis=axis, keepdims=True)
    return np.divide(e, s, out=np.zeros_like(e), where=s > 0)   # an all-masked row -> zeros (torch: nan_to_num)


# ----------------------------------------------------------------------------------------------
# policy
# ----------------------------------------------------------------------------------------------

@dataclass
class Action:
    aircraft: int       # window slot
    clearance: int      # clearance index in the agent's action set
    again: int = 0      # 1 = pick another aircraft before the clock advances (reselection)

    def as_array(self, with_again: bool) -> np.ndarray:
        return np.array([self.aircraft, self.clearance, self.again] if with_again else [self.aircraft, self.clearance])


class Policy:
    def __init__(self, params: dict[str, np.ndarray], meta: dict | None = None):
        self.p = {k[len("ar_net."):]: v.astype(np.float32) for k, v in params.items() if k.startswith("ar_net.")}
        self.meta = meta or {}
        self.has_again = "again_head.0.weight" in self.p
        self.n_clearances = self.p["clearance_head.2.weight"].shape[0]

    @classmethod
    def load(cls, path: str | Path) -> "Policy":
        """A bundle directory (final_model.zip + run_meta.json) or a final_model.zip."""
        path = Path(path).expanduser()
        meta = {}
        if path.is_dir():
            if (path / "run_meta.json").exists():
                meta = json.loads((path / "run_meta.json").read_text())
            path = path / "final_model.zip"
        with zipfile.ZipFile(path) as z:
            state = read_torch_state_dict(z.read("policy.pth"))
        return cls(state, meta)

    # -- network ---------------------------------------------------------------------------------
    def _encode(self, obs):
        p = self.p
        f32 = lambda k: np.asarray(obs[k], dtype=np.float32)
        aircraft, glob = f32("aircraft"), f32("global")
        fps, fp_mask = f32("flight_plans_rel"), f32("flight_plan_mask")
        hist, mask_ac = f32("action_histories"), f32("mask_aircraft")

        ac = _relu(_layer_norm(_linear(aircraft, p["encoder.ac_mlp.0.weight"], p["encoder.ac_mlp.0.bias"]),
                               p["encoder.ac_mlp.1.weight"], p["encoder.ac_mlp.1.bias"]))       # [A, 128]
        x = _relu(_conv1d_k3(fps.transpose(0, 2, 1), p["encoder.fp_encoder.conv.0.weight"], p["encoder.fp_encoder.conv.0.bias"]))
        x = _relu(_conv1d_k3(x, p["encoder.fp_encoder.conv.2.weight"], p["encoder.fp_encoder.conv.2.bias"]))
        m = fp_mask[:, None, :]
        x = (x * m).sum(-1) / np.maximum(m.sum(-1), 1.0)                                       # [A, 64]
        fp = _relu(_linear(x, p["encoder.fp_encoder.out.weight"], p["encoder.fp_encoder.out.bias"]))
        hh = _gru_last(hist, p["encoder.action_history_gru.weight_ih_l0"], p["encoder.action_history_gru.weight_hh_l0"],
                       p["encoder.action_history_gru.bias_ih_l0"], p["encoder.action_history_gru.bias_hh_l0"])
        emb = _linear(np.concatenate([ac, fp, hh], -1), p["encoder.aircraft_fuse.weight"], p["encoder.aircraft_fuse.bias"])
        emb = _relu(_layer_norm(emb, p["encoder.aircraft_fuse_norm.weight"], p["encoder.aircraft_fuse_norm.bias"]))

        if "encoder.aircraft_attention.q.weight" in p:
            a_n, _ = emb.shape
            q, k, v = (emb @ p[f"encoder.aircraft_attention.{n}.weight"].T for n in "qkv")
            d = q.shape[-1] // ATTENTION_HEADS
            split = lambda t: t.reshape(a_n, ATTENTION_HEADS, d).transpose(1, 0, 2)          # [H, A, d]
            q, k, v = split(q), split(k), split(v)
            scores = q @ k.transpose(0, 2, 1) / np.sqrt(d)                                      # [H, A, A]
            scores = np.where(mask_ac[None, None, :] > 0.5, scores, -np.inf)
            attn = _softmax(scores, -1)
            pooled = (attn @ v).transpose(1, 0, 2).reshape(a_n, ATTENTION_HEADS * d)
            out = _linear(pooled, p["encoder.aircraft_attention.out.weight"], p["encoder.aircraft_attention.out.bias"])
            emb = _layer_norm(emb + out, p["encoder.aircraft_attention.norm.weight"], p["encoder.aircraft_attention.norm.bias"])

        mm = mask_ac[:, None]
        pooled = (emb * mm).sum(0) / max(float(mm.sum()), 1.0)
        g = _relu(_linear(glob, p["encoder.glob_mlp.0.weight"], p["encoder.glob_mlp.0.bias"]))
        return emb, np.concatenate([pooled, g], -1)

    def _head(self, name, x):
        p = self.p
        h = _relu(_linear(x, p[f"{name}.0.weight"], p[f"{name}.0.bias"]))
        return _linear(h, p[f"{name}.2.weight"], p[f"{name}.2.bias"])

    def forward(self, obs) -> dict[str, np.ndarray]:
        """Masked logits exactly as the policy builds its distributions: aircraft [A], clearance [A, C],
        again [A, C] (or None), and the critic's value."""
        emb, ctx = self._encode(obs)
        per_ac = np.concatenate([emb, np.broadcast_to(ctx, (emb.shape[0], ctx.shape[0]))], -1)
        ac_logits = self._head("aircraft_head", per_ac)[:, 0]
        clr_logits = self._head("clearance_head", per_ac)
        value = float(self._head("value_head", ctx)[0])
        again = self._head("again_head", per_ac) if self.has_again else None

        if "mask_select" in obs:
            selectable = np.asarray(obs["mask_select"], dtype=np.float32)
        else:  # the under-control rule the env encodes in mask_select for reselection agents
            raise KeyError("mask_select missing: only reselection agents (every published one) are supported")
        ac_logits = np.where(selectable > 0.5, ac_logits, NEG_INF)
        clr_logits = np.where(np.asarray(obs["mask_action_per_ac"]) > 0.5, clr_logits, NEG_INF)
        if again is not None:
            allowed = np.full(again.shape, float(np.asarray(obs["mask_again"]).ravel()[0]) > 0.5)
            allowed[:, DO_NOTHING] = False
            again = np.where(allowed, again, NEG_INF)
        return {"aircraft": ac_logits.astype(np.float32), "clearance": clr_logits.astype(np.float32),
                "again": None if again is None else again.astype(np.float32), "value": value}

    def predict(self, obs, deterministic: bool = True, rng: np.random.Generator | None = None) -> Action:
        """The policy's action: aircraft, then that aircraft's clearance, then the again flag."""
        out = self.forward(obs)
        rng = rng or np.random.default_rng()

        def pick(logits):
            if deterministic:
                return int(np.argmax(logits))
            pr = _softmax(logits.astype(np.float64))
            return int(rng.choice(len(pr), p=pr / pr.sum()))

        a = pick(out["aircraft"])
        c = pick(out["clearance"][a])
        again = 0
        if out["again"] is not None:
            logit = float(out["again"][a, c])
            again = int(logit > 0) if deterministic else int(rng.random() < _sigmoid(logit))
        return Action(a, c, again)
