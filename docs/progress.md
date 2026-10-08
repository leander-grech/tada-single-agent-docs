# Progress board

Every single-agent model lineage and its training trace, regenerated from the runs' trackers whenever new scores come in.
The board is a page of its own: [open it full width](progress/board.html).

Scores are the deterministic policy on the 100 fixed validation seeds, 20-flight streams, each run under its own MDP.
**Success**: every flight within ±60 s of its AMAN target and no loss of separation. **LoS**: streams with a loss of
separation (≤ 3 NM and ≤ 500 ft). **On-time**: flights within ±60 s. TMB is the Malpensa trombone, PMS the Bergamo
point merge.

<iframe id="tada-board" src="../progress/board.html" title="Progress board" loading="lazy"
        style="width:100%; height:2600px; border:0; display:block"></iframe>

<script>
(function () {
  var f = document.getElementById("tada-board");
  function sync() {
    try {
      var d = f.contentDocument; if (!d) return;
      var dark = (document.body.getAttribute("data-md-color-scheme") || "") === "slate";
      d.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
      f.style.height = (d.documentElement.scrollHeight + 8) + "px";
    } catch (e) {}
  }
  f.addEventListener("load", function () { sync(); setTimeout(sync, 800); });
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
  window.addEventListener("resize", function () { setTimeout(sync, 200); });
})();
</script>
