// Web Worker of the in-browser Lab engine: runs the WebAssembly simulator + policy off the page's thread.
importScripts("tada-wasm.js");
let engine = null;
const policies = {};
const cancelled = new Set();

function better(a, b) { // lexicographic: no LoS, bracket score, fewest clearances
  for (let i = 0; i < a.length; i++) {
    const x = +a[i], y = +b[i];
    if (x !== y) return x > y;
  }
  return false;
}

onmessage = async (e) => {
  const m = e.data;
  if (m.cmd === "cancel") { cancelled.add(m.target); return; }
  try {
    if (m.cmd === "init") {
      engine = await loadTadaEngine(m.bytes || m.wasm);
      postMessage({ id: m.id, done: true, result: { sectors: engine.sectors() } });
    } else if (m.cmd === "policy") {
      policies[m.agent] = engine.loadPolicy(m.bytes);
      postMessage({ id: m.id, done: true });
    } else if (m.cmd === "fly") {
      const j = m.job, sc = j.scenario, t0 = performance.now();
      const pol = j.agent === "do-nothing" ? 0 : policies[j.agent];
      if (pol === undefined) throw new Error("download " + j.agent + " first");
      if (j.mode === "search") {
        const ep = engine.newSearchEpisode(sc.procedure, sc.seed, sc.flights, pol, j.search, sc.segments);
        let done = false, last = 0, yielded = performance.now();
        while (!done) {
          done = engine.step(ep, 1);
          const now = performance.now();
          if (now - yielded > 30) {  // let a cancel message in
            await new Promise((r) => setTimeout(r, 0));
            yielded = performance.now();
            if (cancelled.has(m.id)) { cancelled.delete(m.id); engine.free(ep); postMessage({ id: m.id, error: "cancelled" }); return; }
          }
          if (now - last > 120 || done) {
            last = now;
            const st = engine.status(ep);
            const b = st.best;
            postMessage({ id: m.id, frac: st.progress, live: st,
              stage: st.planning ? `plan ${st.plan}: candidate ${st.candidate}/${st.of}` + (b ? ` · best ${b.on_time}/${sc.flights} on time${b.los ? ", LoS" : ""}` : "")
                : `flying the plan (decision ${st.decisions})` });
          }
        }
        const r = engine.result(ep);
        engine.free(ep);
        r.attempts = [Object.assign({ attempt: 0 }, r.summary)];
        r.chosen_attempt = 0;
        r.elapsed_s = Math.round((performance.now() - t0) / 10) / 100;
        postMessage({ id: m.id, done: true, result: r });
        return;
      }
      const n = j.mode === "sampled" ? j.attempts + 1 : 1;
      let best = null, bestRank = null;
      const attempts = [];
      for (let a = 0; a < n; a++) {
        const ep = engine.newEpisode(sc.procedure, sc.seed, sc.flights, pol, a === 0, sc.seed * 1009 + a, sc.segments);
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
