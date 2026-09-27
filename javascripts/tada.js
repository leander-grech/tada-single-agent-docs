// Tag numeric table cells (monospaced, right-aligned) and make .tada-sortable tables sortable.
(function () {
  var NUMERIC = /^[\s+\-−±~≈]*[\d.,]+(\s*(%|s|M|k|×))?(\s*\/\s*[\d.,]+)*\s*$/;

  function tagNumbers(root) {
    root.querySelectorAll(".md-typeset td").forEach(function (td) {
      if (NUMERIC.test(td.textContent)) td.classList.add("num");
    });
  }

  function cellValue(row, i) {
    var cell = row.cells[i];
    if (!cell) return "";
    var raw = cell.getAttribute("data-sort") || cell.textContent.trim();
    var n = parseFloat(raw.replace(/[^\d.\-]/g, ""));
    return isNaN(n) ? raw.toLowerCase() : n;
  }

  function makeSortable(table) {
    if (table.dataset.sortReady) return;
    table.dataset.sortReady = "1";
    var heads = table.tHead ? table.tHead.rows[0].cells : [];
    Array.prototype.forEach.call(heads, function (th, i) {
      th.addEventListener("click", function () {
        var asc = th.getAttribute("aria-sort") !== "ascending";
        Array.prototype.forEach.call(heads, function (h) { h.removeAttribute("aria-sort"); });
        th.setAttribute("aria-sort", asc ? "ascending" : "descending");
        var body = table.tBodies[0];
        var rows = Array.prototype.slice.call(body.rows);
        rows.sort(function (a, b) {
          var x = cellValue(a, i), y = cellValue(b, i);
          if (x === y) return 0;
          return (x < y ? -1 : 1) * (asc ? 1 : -1);
        });
        rows.forEach(function (r) { body.appendChild(r); });
      });
    });
  }

  function init() {
    tagNumbers(document);
    document.querySelectorAll("table.tada-sortable").forEach(makeSortable);
  }

  if (typeof document$ !== "undefined") document$.subscribe(init);
  else document.addEventListener("DOMContentLoaded", init);
})();
