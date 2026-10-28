// Web Worker of the in-browser Lab engine: runs the WebAssembly simulator + policy off the page's thread.
importScripts("tada-wasm.js");
let engine = null;
const policies = {};

function better(a, b) { // lexicographic: no LoS, bracket score, fewest clearances
  for (let i = 0; i < a.length; i++) {
    const x = +a[i], y = +b[i];
    if (x !== y) return x > y;
  }
  return false;
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.cmd === "init") {
      engine = await loadTadaEngine(m.bytes || m.wasm);
      postMessage({ id: m.id, done: true });
    } else if (m.cmd === "policy") {
      policies[m.agent] = engine.loadPolicy(m.bytes);
      postMessage({ id: m.id, done: true });
    } else if (m.cmd === "fly") {
      const j = m.job, sc = j.scenario, t0 = performance.now();
      const pol = j.agent === "do-nothing" ? 0 : policies[j.agent];
      if (pol === undefined) throw new Error("download " + j.agent + " first");
      const n = j.mode === "sampled" ? j.attempts + 1 : 1;
      let best = null, bestRank = null;
      const attempts = [];
      for (let a = 0; a < n; a++) {
        const ep = engine.newEpisode(sc.procedure, sc.seed, sc.flights, pol, a === 0, sc.seed * 1009 + a);
        let done = false;
        while (!done) {
          done = engine.step(ep, 4);
          postMessage({ id: m.id, frac: (a + engine.progress(ep)) / n, stage: n > 1 ? `attempt ${a + 1} of ${n}` : "flying" });
        }
        const r = engine.result(ep), rank = engine.rank(ep);
        engine.free(ep);
        attempts.push(Object.assign({ attempt: a }, r.summary));
        if (!best || better(rank, bestRank)) { best = r; best.chosen_attempt = a; bestRank = rank; }
      }
      best.attempts = attempts;
      best.elapsed_s = Math.round((performance.now() - t0) / 10) / 100;
      postMessage({ id: m.id, done: true, result: best });
    }
  } catch (err) {
    postMessage({ id: m.id, error: String((err && err.message) || err) });
  }
};
