// Token Launch Radar — board rendering, sorting, filtering, detail view.
// Data comes from ../data.js (window.RADAR), written by main.ts. No network.
(function () {
  "use strict";
  var DATA = window.RADAR || { rows: [] };
  var rows = DATA.rows || [];
  var state = { sort: "rank", dir: 1, q: "", chain: "", category: "", watchlist: false };

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + n;
  }
  function pct(v) {
    if (v === null || v === undefined) return "—";
    var cls = v >= 0 ? "up" : "down";
    return '<span class="' + cls + '">' + (v >= 0 ? "+" : "") + v.toFixed(1) + "%</span>";
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function filtered() {
    var q = state.q.toLowerCase();
    return rows.filter(function (r) {
      if (state.watchlist && !r.watchlist) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.category && r.category !== state.category) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0)) return false;
      return true;
    });
  }

  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string") return state.dir * av.localeCompare(bv);
      return state.dir * (av - bv);
    });
  }

  function renderBoard() {
    var list = sorted(filtered());
    var body = $("rows");
    body.innerHTML = list.map(function (r) {
      var star = r.watchlist ? ' <span class="star" title="On the watchlist">★</span>' : "";
      var chains = r.chains.slice(0, 3).map(function (c) { return '<span class="pill">' + esc(c) + "</span>"; }).join("");
      return "<tr data-slug=\"" + esc(r.slug) + "\">" +
        '<td class="num">' + r.rank + "</td>" +
        "<td><b>" + esc(r.name) + "</b>" + star + '<br><span style="color:var(--muted);font-size:12px">' + esc(r.slug) + "</span></td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num">' + pct(r.change_7d) + "</td>" +
        '<td class="num">' + r.age_days + "d</td>" +
        '<td class="num"><b>' + money(r.implied_value_usd) + "</b></td>" +
        '<td class="num">' + r.multiple.toFixed(2) + "×</td>" +
        "<td>" + chains + "</td></tr>";
    }).join("");
    $("count").textContent = list.length + " of " + rows.length + " protocols";
    body.querySelectorAll("tr").forEach(function (tr) {
      tr.addEventListener("click", function () { location.hash = "#/protocol/" + tr.getAttribute("data-slug"); });
    });
  }

  function barRow(label, value, max) {
    var w = Math.max(2, Math.round((value / max) * 100));
    return '<div class="bar-row"><span>' + esc(label) + '</span><div class="bar"><i style="width:' + w + '%"></i></div><span>' + value.toFixed(3) + "</span></div>";
  }

  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) r = rows[i];
    var panel = $("detail");
    if (!r) { panel.hidden = true; return; }
    $("board").style.display = "none";
    $("count").style.display = "none";
    $("d-name").textContent = (r.watchlist ? "★ " : "") + r.name + "  ·  rank #" + r.rank;
    $("d-facts").textContent =
      "TVL " + money(r.tvl_usd) + "  ·  7d " + (r.change_7d === null ? "n/a" : r.change_7d.toFixed(1) + "%") +
      "  ·  listed " + r.age_days + " days ago with no token recorded" +
      "  ·  " + (r.category || "no category") + "  ·  chains: " + r.chains.join(", ");
    var b = r.breakdown;
    $("d-why").innerHTML =
      "<p>Implied value <b>" + money(r.implied_value_usd) + "</b> = TVL " + money(r.tvl_usd) + " × multiple " + r.multiple.toFixed(3) + ".</p>" +
      barRow("Base", b.base, 0.65) +
      barRow("Growth boost", b.growthBoost, 0.65) +
      barRow("Age boost", b.ageBoost, 0.65) +
      barRow("Breadth boost", b.breadthBoost, 0.65);
    $("d-steps").innerHTML = r.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    panel.hidden = false;
  }

  function route() {
    var hash = location.hash || "#/";
    var m = hash.match(/^#\/protocol\/([\w.-]+)/);
    if (m) { renderBoard(); renderDetail(m[1]); return; }
    $("detail").hidden = true;
    $("board").style.display = "";
    $("count").style.display = "";
    var qm = hash.match(/chain=([^&]+)/);
    var wm = hash.match(/watchlist=1/);
    if (qm) { state.chain = decodeURIComponent(qm[1]); $("chain").value = state.chain; }
    if (wm) { state.watchlist = true; $("watchlist").checked = true; }
    renderBoard();
  }

  function fillSelects() {
    var chains = {};
    var cats = {};
    rows.forEach(function (r) {
      r.chains.forEach(function (c) { chains[c] = true; });
      if (r.category) cats[r.category] = true;
    });
    Object.keys(chains).sort().forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c; $("chain").appendChild(o);
    });
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c; $("category").appendChild(o);
    });
  }

  function exportCSV() {
    var head = "rank,slug,name,category,chains,tvl_usd,change_7d,age_days,implied_value_usd,multiple,watchlist\n";
    var body = sorted(filtered()).map(function (r) {
      return [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', r.category || "", '"' + r.chains.join(";") + '"',
        r.tvl_usd, r.change_7d === null ? "" : r.change_7d, r.age_days, r.implied_value_usd, r.multiple, r.watchlist ? 1 : 0].join(",");
    }).join("\n");
    var blob = new Blob([head + body + "\n"], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "token-radar-board.csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function init() {
    fillSelects();
    $("meta").innerHTML = "<b>" + rows.length + "</b> ranked · snapshot " + esc(DATA.as_of || "") +
      "<br>watchlist " + (DATA.counts ? DATA.counts.watchlist_covered : "?") + "/" + (DATA.counts ? DATA.counts.watchlist : "?") +
      " covered · floor " + money(DATA.floor_usd || 0);
    var trading = DATA.trading_reference || [];
    $("trading-note").textContent = trading.length
      ? "Already trading, shown for reference only and not ranked here: " +
        trading.map(function (t) { return t.name + " (" + money(t.mcap_usd) + ")"; }).join(", ") + "."
      : "";
    $("q").addEventListener("input", function (e) { state.q = e.target.value; renderBoard(); });
    $("chain").addEventListener("change", function (e) { state.chain = e.target.value; renderBoard(); });
    $("category").addEventListener("change", function (e) { state.category = e.target.value; renderBoard(); });
    $("watchlist").addEventListener("change", function (e) { state.watchlist = e.target.checked; renderBoard(); });
    $("csv").addEventListener("click", exportCSV);
    $("close").addEventListener("click", function () { location.hash = "#/"; });
    document.querySelectorAll("th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort");
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === "name" ? 1 : -1; }
        renderBoard();
      });
    });
    window.addEventListener("hashchange", route);
    route();
  }
  init();
})();
