// Web Worker of the in-browser Lab engine: runs the WebAssembly simulator + policy off the page's thread.
importScripts("tada-wasm.js");
// One engine per worker. The page may start several: the first runs the episodes; the others ("followers")
// each hold a copy of a search episode and roll out candidates for it, so a plan's candidates run in parallel.
let engine = null, ready = null;
const policies = {};
const cancelled = new Set();
const followers = [];   // MessagePorts to follower workers (coordinator side)
const following = {};   // epId -> { ep, policy } (follower side)

// a scenario's episode: a composed stream ("flights.seed.gapMin_..."), else the paper's single or stitched stream
function makeEpisode(sc, policy, det, sampleSeed, search) {
  const segs = sc.compose ? sc.compose.split("_").map((t) => { const p = t.split("."); return { flights: +p[0], seed: +p[1], gap_s: 60 * +p[2] }; }) : null;
  return segs
    ? engine.newEpisodeSpec({ procedure: sc.procedure, segments: segs, policy: policy, deterministic: det, sample_seed: sampleSeed, search: search })
    : search ? engine.newSearchEpisode(sc.procedure, sc.seed, sc.flights, policy, search, sc.segments)
      : engine.newEpisode(sc.procedure, sc.seed, sc.flights, policy, det, sampleSeed, sc.segments);
}

// follower side: requests from the coordinator over a MessagePort
function serve(port) {
  port.onmessage = async (e) => {
    const q = e.data;
    try {
      await ready;
      if (q.op === "new") {
        const pol = policies[q.agent];
        if (!pol) throw new Error("follower has no " + q.agent);
        if (following[q.epId]) engine.free(following[q.epId].ep);
        const sc = q.sc, segs = sc.compose ? sc.compose.split("_").map((t) => { const p = t.split("."); return { flights: +p[0], seed: +p[1], gap_s: 60 * +p[2] }; }) : [];
        following[q.epId] = { policy: pol, ep: engine.newEpisodeSpec({ procedure: sc.procedure, segments: segs, seed: sc.seed, flights: sc.flights,
          stitched: sc.segments || 1, policy: pol, light: true }) };
      } else if (q.op === "sync") {
        engine.apply(following[q.epId].ep, q.acts);
      } else if (q.op === "rollout") {
        const f = following[q.epId];
        if (q.acts) engine.apply(f.ep, q.acts);
        port.postMessage({ rid: q.rid, result: engine.rollout(f.ep, f.policy, q.job) });
        return;
      } else if (q.op === "free") {
        if (following[q.epId]) { engine.free(following[q.epId].ep); delete following[q.epId]; }
      }
      if (q.rid) port.postMessage({ rid: q.rid, result: true });
    } catch (err) {
      if (q.rid) port.postMessage({ rid: q.rid, error: String((err && err.message) || err) });
    }
  };
}

// coordinator side: a follower as call (reply awaited) / send (fire and forget, kept in order on the port)
function follower(port) {
  let rid = 0;
  const waiting = {};
  port.onmessage = (e) => {
    const w = waiting[e.data.rid];
    if (!w) return;
    delete waiting[e.data.rid];
    if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.result);
  };
  return {
    call(q) { return new Promise((resolve, reject) => { q.rid = ++rid; waiting[q.rid] = { resolve, reject }; port.postMessage(q); }); },
    send(q) { port.postMessage(q); },
  };
}


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
      ready = loadTadaEngine(m.module || m.bytes || m.wasm).then((x) => { engine = x; });
      await ready;
      postMessage({ id: m.id, done: true, result: { sectors: engine.sectors() } });
      return;
    }
    await ready;
    if (m.cmd === "policy") {
      policies[m.agent] = engine.loadPolicy(m.bytes);
      postMessage({ id: m.id, done: true });
    } else if (m.cmd === "serve") {          // become a follower
      serve(m.port);
    } else if (m.cmd === "follower") {       // coordinator: one more follower to hand candidates to
      followers.push(follower(m.port));
    } else if (m.cmd === "segment") {  // difficulty of one segment (cached by the page)
      postMessage({ id: m.id, done: true, result: engine.segmentInfo(m.procedure, m.seed, m.flights) });
    } else if (m.cmd === "findseed") {  // a seed whose worst |AMAN TTL| falls in [lo, hi): random draws, else the closest
      let best = null, bestD = Infinity;
      for (let n = 0; n < (m.tries || 40); n++) {
        const seed = Math.floor(Math.random() * 2147483647), v = engine.segmentInfo(m.procedure, seed, m.flights);
        const d = v.worst_ttl < m.lo ? m.lo - v.worst_ttl : v.worst_ttl >= m.hi ? v.worst_ttl - m.hi + 1e-6 : 0;
        if (d < bestD) { best = v; bestD = d; }
        if (d === 0) break;
      }
      postMessage({ id: m.id, done: true, result: best });
    } else if (m.cmd === "fly") {
      const j = m.job, sc = j.scenario, t0 = performance.now();
      const pol = j.agent === "do-nothing" ? 0 : policies[j.agent];
      if (pol === undefined) throw new Error("download " + j.agent + " first");
      if (j.mode === "search") { await search(m, j, sc, pol, t0); return; }
      const n = j.mode === "sampled" ? j.attempts + 1 : 1;
      let best = null, bestRank = null;
      const attempts = [];
      for (let a = 0; a < n; a++) {
        const ep = makeEpisode(sc, pol, a === 0, sc.seed * 1009 + a, null);
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

// Policy + rollout search. With followers (j.threads > 1) each plan's candidates are rolled out in parallel: the
// followers fly copies of this episode (same spec, then this episode's executed actions) and return rollouts that
// the planner takes in k order, so the plan chosen is the one a single engine would choose.
async function search(m, j, sc, pol, t0) {
  let pool = followers.slice(0, Math.max(0, (j.threads | 0)));
  if (pool.length < 2) pool = [];
  // the followers build their copies while this engine builds the episode; awaited before the first parallel plan
  let joined = pool.length ? Promise.all(pool.map((f) => f.call({ op: "new", epId: m.id, sc: sc, agent: j.agent }))) : null;
  const ep = makeEpisode(sc, pol, true, 0, j.search);
  const synced = pool.map(() => 0);
  let done = false, last = 0, yielded = performance.now(), plansSeen = 0, lastPartial = 0, lastDec = 0, nActs = 0;
  const report = (force) => {
    const now = performance.now();
    if (!force && now - last < 120) return;
    last = now;
    const st = engine.status(ep);
    st.threads = pool.length || 1;
    st.elapsed_s = Math.round((now - t0) / 100) / 10;
    const b = st.best, total = st.n_flights;
    // the episode so far, after each finished plan and every 1.5 s of flying (each one re-mounts the replay): the page follows it on the radar
    let partial = null;
    const newPlan = (st.history || []).length > plansSeen, moved = st.decisions > lastDec;
    if (!done && ((newPlan && now - lastPartial > 1000) || (moved && now - lastPartial > 1500))) {
      plansSeen = (st.history || []).length; lastPartial = now; lastDec = st.decisions;
      partial = engine.result(ep);  // ~80 ms for a 60-flight stream
    }
    postMessage({ id: m.id, frac: st.progress, live: st, partial: partial,
      stage: st.planning ? `plan ${st.plan}: candidate ${st.candidate}/${st.of}` + (pool.length ? ` on ${pool.length} threads` : "") +
        (b ? ` · best ${b.on_time}/${total} on time${b.los ? ", LoS" : ""}` : "")
        : `flying the plan (decision ${st.decisions})` });
  };
  // One plan, its candidates spread over the followers (each first catches up with the executed actions). The plan
  // closes as soon as it is decided (its candidates so far, in k order, cannot be beaten): a follower still busy
  // with a candidate that no longer matters finishes it in the background and its result is dropped.
  const busy = pool.map(() => false);
  let planNo = 0, wake = null;
  const plan = () => new Promise((resolve, reject) => {
    const my = ++planNo, acts = JSON.parse(engine.actions(ep, 0));
    nActs = acts.length;
    let inflight = 0, exhausted = false, over = false;
    const end = (err) => { over = true; wake = null; if (err) reject(err); else resolve(); };
    const pump = () => {
      if (over) return;
      if (cancelled.has(m.id)) { end(new Error("cancelled")); return; }
      if (engine.planDecided(ep)) { end(); return; }
      const free = [];
      busy.forEach((b, i) => { if (!b) free.push(i); });
      if (free.length && !exhausted) {
        const jobs = engine.planJobs(ep, free.length);
        if (!jobs.length) exhausted = true;
        for (const job of jobs) {
          const i = free.pop(), jt = JSON.stringify(job);
          const catchUp = synced[i] < nActs ? JSON.stringify(acts.slice(synced[i])) : null;
          synced[i] = nActs; busy[i] = true; inflight++;
          pool[i].call({ op: "rollout", epId: m.id, job: jt, acts: catchUp }).then((r) => {
            busy[i] = false;
            if (planNo === my && !over) {
              inflight--;
              engine.planSubmit(ep, jt, r);
              report(false);
            }
            if (wake) wake();
          }, (err) => { busy[i] = false; if (planNo === my && !over) end(err); });
        }
      }
      if (inflight === 0 && exhausted) end();
    };
    wake = pump;
    pump();
  });
  try {
    while (!done) {
      if (joined) {
        try { await joined; } catch (err) { pool = []; }  // a follower without this agent: plan on this engine alone
        joined = null;
      }
      if (pool.length && engine.planBegin(ep)) {
        report(true);
        await plan();
        engine.planFinish(ep);
        report(true);
        continue;
      }
      done = engine.step(ep, 1);
      const now = performance.now();
      if (now - yielded > 30) {  // let a cancel message in
        await new Promise((r) => setTimeout(r, 0));
        yielded = performance.now();
        if (cancelled.has(m.id)) throw new Error("cancelled");
      }
      report(done);
    }
    const r = engine.result(ep);
    r.attempts = [Object.assign({ attempt: 0 }, r.summary)];
    r.chosen_attempt = 0;
    r.elapsed_s = Math.round((performance.now() - t0) / 10) / 100;
    r.threads = pool.length || 1;
    postMessage({ id: m.id, done: true, result: r });
  } catch (err) {
    cancelled.delete(m.id);
    postMessage({ id: m.id, error: String((err && err.message) || err) });
  } finally {
    engine.free(ep);
    pool.forEach((f) => f.send({ op: "free", epId: m.id }));
  }
}
