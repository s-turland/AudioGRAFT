/* AudioGRAFT project page.
 *
 * Reads static/data/{examples,results}.json (written by
 * eval/build_audiograft.py) and draws the audio examples, the flow
 * trajectories, Table 1 and Fig. 2.  <body data-player> picks the clip
 * style: "spec" (the spectrogram is the play control) or "native"
 * (spectrogram above an <audio> element).
 */
(function () {
  "use strict";

  var ROOT = document.body.getAttribute("data-root") || "";
  var PLAYER = document.body.getAttribute("data-player") || "native";
  var PAGE_SIZE = 6;

  // Column order for the examples: proposed, ablation, then baselines.
  var EX_ORDER = ["align-cqt", "align-stft", "no-align", "cnf-wide", "zfm-blocks", "zfm"];
  var PROPOSED = ["align-cqt", "align-stft"];
  var DOMAIN = { "in-domain": "In-domain", "nsynth": "NSynth", "esc50": "ESC-50" };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, kids) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function src(p) { return p ? ROOT + p : p; }
  function getJSON(p) {
    return fetch(src(p)).then(function (r) {
      if (!r.ok) throw new Error(p + ": " + r.status);
      return r.json();
    });
  }
  function nmax(s) { return "<i>n</i><sub>max</sub>&nbsp;=&nbsp;" + s; }

  // ------------------------------------------------------------ clips
  var player = new Audio();
  player.preload = "none";
  var current = null, raf = 0;
  function stopCurrent() {
    if (current) current.classList.remove("playing");
    current = null;
    cancelAnimationFrame(raf);
  }
  function tick() {
    if (!current) return;
    var cur = current.querySelector(".cursor");
    if (cur) cur.style.left = Math.min(100, (player.currentTime / (player.duration || 4)) * 100) + "%";
    raf = requestAnimationFrame(tick);
  }
  player.addEventListener("ended", stopCurrent);
  player.addEventListener("pause", stopCurrent);

  // Only one clip plays at a time, in either style.
  document.addEventListener("play", function (e) {
    Array.prototype.forEach.call(document.querySelectorAll("audio"), function (a) { if (a !== e.target) a.pause(); });
    if (e.target !== player) player.pause();
  }, true);

  function clip(media, label) {
    if (!media || !media.audio) return null;
    if (PLAYER === "native") {
      return el("div", { class: "clip" }, [
        el("img", { src: src(media.spec), alt: "Spectrogram, " + label, loading: "lazy", decoding: "async" }),
        el("audio", { controls: "", preload: "none", src: src(media.audio), "aria-label": label })
      ]);
    }
    var b = el("button", { class: "clip", type: "button", "aria-label": "Play " + label }, [
      el("img", { src: src(media.spec), alt: "", loading: "lazy", decoding: "async" }),
      el("span", { class: "glyph", "aria-hidden": "true" }),
      el("span", { class: "cursor", "aria-hidden": "true" })
    ]);
    b.addEventListener("click", function () {
      if (current === b && !player.paused) { player.pause(); return; }
      stopCurrent();
      Array.prototype.forEach.call(document.querySelectorAll("audio"), function (a) { a.pause(); });
      current = b;
      b.classList.add("playing");
      player.src = src(media.audio);
      var p = player.play();
      if (p && p.catch) p.catch(stopCurrent);
      raf = requestAnimationFrame(tick);
    });
    return b;
  }
  function noRender() { return el("div", { class: "norender", text: "Not rendered" }); }

  // A row of mutually exclusive options, written as plain text buttons.
  function choice(label, options, value, onChange) {
    var wrap = el("div", { class: "choice", role: "group", "aria-label": label.replace(/<[^>]+>/g, "") }, [el("span", { class: "choice-label", html: label + ":" })]);
    options.forEach(function (o) {
      var b = el("button", { type: "button", "aria-pressed": String(o.value === value), html: o.label });
      if (o.disabled) { b.disabled = true; b.title = o.disabled; }
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(wrap.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        onChange(o.value);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  // ------------------------------------------------------------ ordering
  // The first page holds the author-selected conditions in which a proposed
  // variant has the lowest MSS in the row, closest first.  Every other
  // exported condition (the rest of the selected set and the random set) is
  // shuffled once per visit and fills the later pages.
  function mssOf(r, keys) {
    return keys.map(function (k) { var c = r.cells[k]; return c && c.rendered && c.mss != null ? c.mss : Infinity; });
  }
  function rank(r) {
    var ours = Math.min.apply(null, mssOf(r, PROPOSED));
    var others = Math.min.apply(null, mssOf(r, EX_ORDER.filter(function (k) { return PROPOSED.indexOf(k) < 0; })));
    return (ours <= others ? 0 : 1000) + ours;
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  var orderCache = {};
  function ordered(key, set) {
    if (orderCache[key]) return orderCache[key];
    var sel = set.selected.slice().sort(function (a, b) { return rank(a) - rank(b); });
    var first = sel.slice(0, PAGE_SIZE);
    var rest = shuffle(sel.slice(PAGE_SIZE).concat(set.random));
    return (orderCache[key] = first.concat(rest));
  }

  // ------------------------------------------------------------ examples
  function drawExamples(ex) {
    var host = document.getElementById("examples-table");
    var ctl = document.getElementById("examples-controls");
    var pager = document.getElementById("examples-pager");
    if (!host) return;
    var label = {};
    ex.arms.forEach(function (a) { label[a.key] = a.label; });
    var state = { domain: "nsynth", size: 10, page: 0, graphs: false };

    function available(size, domain) { var s = ex.sets["n" + size + "/" + domain]; return s && !s.pending; }

    var sizeCtl;
    function drawControls() {
      ctl.innerHTML = "";
      ctl.appendChild(choice("Domain", ex.domains.map(function (d) { return { value: d, label: DOMAIN[d] }; }), state.domain, function (v) {
        state.domain = v; state.page = 0;
        if (!available(state.size, v)) state.size = 10;
        drawControls(); render();
      }));
      sizeCtl = choice("Graph size <i>n</i><sub>max</sub>", ex.sizes.map(function (s) {
        return { value: s, label: String(s), disabled: available(s, state.domain) ? null : "Not yet available for this domain" };
      }), state.size, function (v) { state.size = v; state.page = 0; render(); });
      ctl.appendChild(sizeCtl);
      var box = el("input", { type: "checkbox", id: "show-graphs" });
      box.checked = state.graphs;
      box.addEventListener("change", function () { state.graphs = box.checked; render(); });
      ctl.appendChild(el("label", { class: "toggle", for: "show-graphs" }, [box, document.createTextNode(" Show generated graphs")]));
    }

    function render() {
      stopCurrent();
      host.innerHTML = "";
      pager.innerHTML = "";
      var key = "n" + state.size + "/" + state.domain;
      var set = ex.sets[key];
      var rows = ordered(key, set);
      var pages = Math.ceil(rows.length / PAGE_SIZE);
      var shown = rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

      var table = el("table", { class: "examples" });
      var head = el("tr", {}, [el("th", { scope: "col", text: "Condition" })]);
      EX_ORDER.forEach(function (k) { head.appendChild(el("th", { scope: "col", text: label[k] })); });
      table.appendChild(el("thead", {}, [head]));
      var tb = el("tbody");
      shown.forEach(function (r) {
        var name = r.note ? r.note : DOMAIN[state.domain] + " " + r.id;
        var cond = el("td", { class: "cond" }, [el("div", { class: "cond-name", text: name }), clip(r.condition, "condition " + name)]);
        if (state.graphs && r.target) cond.appendChild(el("img", { class: "graph", src: src(r.target), alt: "Reference graph", loading: "lazy" }));
        var tr = el("tr", {}, [cond]);
        var best = Infinity;
        EX_ORDER.forEach(function (k) { var c = r.cells[k]; if (c && c.rendered && c.mss != null) best = Math.min(best, c.mss); });
        EX_ORDER.forEach(function (k) {
          var c = r.cells[k], td = el("td");
          if (c && c.rendered && c.audio) {
            td.appendChild(clip(c, label[k] + ", " + name));
            td.appendChild(el("div", { class: "mss" + (c.mss === best ? " best" : ""), text: "MSS " + c.mss.toFixed(2) }));
          } else {
            td.appendChild(noRender());
          }
          if (state.graphs && c && c.graph) td.appendChild(el("img", { class: "graph", src: src(c.graph), alt: label[k] + " graph", loading: "lazy" }));
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      host.appendChild(el("div", { class: "scroll" }, [table]));

      var lo = state.page * PAGE_SIZE + 1, hi = Math.min(rows.length, lo + PAGE_SIZE - 1);
      pager.appendChild(el("span", { class: "pager-count", text: "Conditions " + lo + "–" + hi + " of " + rows.length }));
      var nav = el("span", { class: "pager-pages" }, [el("span", { text: "Page:" })]);
      for (var p = 0; p < pages; p++) (function (p) {
        var b = el("button", { type: "button", "aria-pressed": String(p === state.page), text: String(p + 1) });
        b.addEventListener("click", function () { state.page = p; render(); host.scrollIntoView({ block: "start" }); });
        nav.appendChild(b);
      })(p);
      pager.appendChild(nav);
    }
    drawControls();
    render();
  }

  // ------------------------------------------------------------ trajectories
  function drawTrajectories(ex) {
    var host = document.getElementById("traj");
    var ctl = document.getElementById("traj-controls");
    var cap = document.getElementById("traj-caption");
    if (!host || !ex.trajectories.length) return;
    var letters = "abcdefgh";
    ctl.appendChild(choice("Example", ex.trajectories.map(function (t, i) {
      return { value: i, label: "(" + letters[i] + ") " + DOMAIN[t.domain] };
    }), 0, function (i) { render(ex.trajectories[i]); }));

    function render(t) {
      stopCurrent();
      host.innerHTML = "";
      var head = el("tr", {}, [el("th", { scope: "col", text: "Condition" })]);
      t.waypoints.forEach(function (w) { head.appendChild(el("th", { scope: "col", html: "<i>t</i> = " + (w.t === 0 ? "0" : w.t.toFixed(1)) })); });
      var audio = el("tr", {}, [el("td", {}, [clip(t.condition, "condition")])]);
      var graphs = el("tr", { class: "graphs" }, [el("td", {}, [t.target ? el("img", { class: "graph", src: src(t.target), alt: "Reference graph", loading: "lazy" }) : el("span", { class: "none", text: "No reference graph" })])]);
      t.waypoints.forEach(function (w) {
        var td = el("td");
        if (w.rendered && w.audio) {
          td.appendChild(clip(w, "decoded state at t = " + w.t));
          if (w.stft != null) td.appendChild(el("div", { class: "mss", text: "STFT " + w.stft.toFixed(2) }));
        } else td.appendChild(noRender());
        audio.appendChild(td);
        graphs.appendChild(el("td", {}, [w.graph ? el("img", { class: "graph", src: src(w.graph), alt: "Decoded graph at t = " + w.t, loading: "lazy" }) : null]));
      });
      host.appendChild(el("div", { class: "scroll" }, [el("table", { class: "examples traj" }, [el("thead", {}, [head]), el("tbody", {}, [audio, graphs])])]));
      var what = t.domain === "in-domain" ? "a held-out in-domain graph" : "an " + DOMAIN[t.domain] + " recording";
      cap.innerHTML = "Condition: " + what + "; generated by " + t.label + " at " + nmax(t.size) + "." +
        (t.exact === 1 ? " The final graph is isomorphic to the reference graph." : "");
    }
    render(ex.trajectories[0]);
  }

  // ------------------------------------------------------------ Table 1
  function drawTable(res) {
    var tbl = document.getElementById("table1");
    if (!tbl) return;
    var GRAPH = [["node_mae", "&Delta;|<i>V</i>|", 2], ["edge_mae", "&Delta;|<i>E</i>|", 2], ["exact", "gr.%", 1], ["f1", "F1(<i>&tau;</i><sub><i>v</i></sub>)", 3]];
    var AUDIO = [["render", "rend.", 1], ["mss", "MSS", 3], ["sot", "SOT", 3], ["wmfcc", "wMF.", 2], ["rms", "RMS", 3]];
    var DOMS = ["in-domain", "nsynth", "esc50"];
    var NAMES = { "in-domain": "audio (in-domain)", nsynth: "audio (NSynth OOD)", esc50: "audio (ESC-50 OOD)" };
    var thead = el("thead");
    var g = el("tr", { class: "grp" }, [el("th")]);
    g.appendChild(el("th", { colspan: "4", text: "graph (in-domain)" }));
    DOMS.forEach(function (d) { g.appendChild(el("th", { colspan: "5", text: NAMES[d] })); });
    var h = el("tr", {}, [el("th", { text: "method" })]);
    GRAPH.forEach(function (c, i) { h.appendChild(el("th", { class: i === 0 ? "first" : "", html: c[1] })); });
    DOMS.forEach(function () { AUDIO.forEach(function (c, i) { h.appendChild(el("th", { class: i === 0 ? "first" : "", html: c[1] })); }); });
    thead.appendChild(g); thead.appendChild(h);
    tbl.appendChild(thead);
    var tb = el("tbody");
    [10, 20, 40].forEach(function (s) {
      tb.appendChild(el("tr", { class: "block" }, [el("td", { colspan: "20", html: nmax(s) })]));
      res.arms.forEach(function (a) {
        var row = res.table[s][a.key];
        var tr = el("tr", {}, [el("td", { class: "m", text: a.label })]);
        [["graph", GRAPH]].concat(DOMS.map(function (d) { return [d, AUDIO]; })).forEach(function (blk) {
          var d = row[blk[0]], best = d._best || [];
          blk[1].forEach(function (c, i) {
            var v = d[c[0]];
            var txt = v == null ? "–" : Number(v).toFixed(c[2]);
            tr.appendChild(el("td", { class: (i === 0 ? "first" : "") + (best.indexOf(c[0]) >= 0 ? " b" : ""), text: txt }));
          });
        });
        tb.appendChild(tr);
      });
    });
    tbl.appendChild(tb);
  }

  // ------------------------------------------------------------ Fig. 2
  // Drawn as in the paper: GRAFT-Unaligned green triangles (dash-dot),
  // GRAFT-CQT blue circles (dashed), GRAFT-STFT orange squares (dotted).
  var FIG2 = {
    "no-align":   { c: "#3f9153", dash: "6 2 1.5 2", m: "tri" },
    "align-cqt":  { c: "#4a63c8", dash: "5 3", m: "circle" },
    "align-stft": { c: "#d9832f", dash: "1.5 2", m: "square" }
  };
  function drawFig2(res) {
    var host = document.getElementById("fig2");
    if (!host) return;
    var arms = res.arms.filter(function (a) { return res.ae[a.key]; });
    var panels = [
      { k: "mss", t: "(a) MSS ↓", lim: [0.4, 1.2], ticks: [0.5, 1.0] },
      { k: "cka", t: "(b) CKA ↑", lim: [0.05, 0.6], ticks: [0.25, 0.5] }
    ];
    var W = 230, H = 150, m = { l: 34, r: 8, t: 20, b: 34 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var xs = [10, 20, 40];
    function X(i) { return m.l + i * iw / 2; }
    panels.forEach(function (p) {
      function Y(v) { return m.t + ih - (v - p.lim[0]) / (p.lim[1] - p.lim[0]) * ih; }
      var s = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": p.t + " against graph size" });
      s.appendChild(sv("text", { x: m.l, y: 12, text: p.t }));
      s.appendChild(sv("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "none", stroke: "currentColor", "stroke-width": 0.8 }));
      p.ticks.forEach(function (v) {
        s.appendChild(sv("line", { x1: m.l - 3, x2: m.l, y1: Y(v), y2: Y(v), stroke: "currentColor", "stroke-width": 0.8 }));
        s.appendChild(sv("text", { x: m.l - 5, y: Y(v) + 3.5, "text-anchor": "end", text: v.toFixed(p.k === "mss" ? 1 : 2) }));
      });
      xs.forEach(function (x, i) {
        s.appendChild(sv("line", { x1: X(i), x2: X(i), y1: m.t + ih, y2: m.t + ih + 3, stroke: "currentColor", "stroke-width": 0.8 }));
        s.appendChild(sv("text", { x: X(i), y: m.t + ih + 14, "text-anchor": "middle", text: String(x) }));
      });
      var xl = sv("text", { x: m.l + iw / 2, y: H - 4, "text-anchor": "middle" });
      xl.appendChild(sv("tspan", { "font-style": "italic", text: "n" }));
      xl.appendChild(sv("tspan", { "baseline-shift": "sub", "font-size": "8.5", text: "max" }));
      s.appendChild(xl);
      arms.forEach(function (a) {
        var st = FIG2[a.key], v = res.ae[a.key][p.k];
        s.appendChild(sv("path", { d: v.map(function (y, i) { return (i ? "L" : "M") + X(i) + "," + Y(y); }).join(""), fill: "none", stroke: st.c, "stroke-width": 1.3, "stroke-dasharray": st.dash }));
        v.forEach(function (y, i) { s.appendChild(mark(st, X(i), Y(y))); });
      });
      host.appendChild(el("div", { class: "panel" }, [s]));
    });
    var key = el("div", { class: "fig2-key" });
    arms.forEach(function (a) {
      var st = FIG2[a.key];
      var s = sv("svg", { viewBox: "0 0 26 10", width: "26", height: "10", "aria-hidden": "true" }, [
        sv("line", { x1: 0, x2: 26, y1: 5, y2: 5, stroke: st.c, "stroke-width": 1.3, "stroke-dasharray": st.dash }), mark(st, 13, 5)]);
      key.appendChild(el("span", {}, [s, document.createTextNode(" " + a.label)]));
    });
    host.appendChild(key);
  }
  function mark(st, x, y) {
    var a = { fill: st.m === "square" ? st.c : "#fff", stroke: st.c, "stroke-width": 1.1 };
    if (st.m === "circle") { a.cx = x; a.cy = y; a.r = 3; return sv("circle", a); }
    if (st.m === "square") { a.x = x - 2.8; a.y = y - 2.8; a.width = 5.6; a.height = 5.6; return sv("rect", a); }
    a.points = [x, y - 3.6, x + 3.4, y + 2.6, x - 3.4, y + 2.6].join(","); return sv("polygon", a);
  }

  // ------------------------------------------------------------ start
  function fail(id, err) {
    var n = document.getElementById(id);
    if (n) n.appendChild(el("p", { class: "none", text: location.protocol === "file:"
      ? "Serve this directory over HTTP to load the examples (python -m http.server)." : "Could not load data: " + err.message }));
  }
  function start() {
    getJSON("static/data/examples.json").then(function (ex) {
      drawExamples(ex);
      drawTrajectories(ex);
    }).catch(function (e) { fail("examples-table", e); });
    getJSON("static/data/results.json").then(function (res) {
      drawTable(res);
      drawFig2(res);
    }).catch(function (e) { fail("table1", e); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
