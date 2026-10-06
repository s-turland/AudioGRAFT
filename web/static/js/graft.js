/* AudioGraft project page.
 *
 * Reads static/data/{examples,results}.json (written by
 * eval/build_audiograft.py) and draws every interactive figure on the page.
 * No framework: one audio element, plain DOM, hand-built SVG.
 */
(function () {
  "use strict";

  // ------------------------------------------------------------ constants
  // eval/figpalette.py and eval/scaling_figure.METHOD_STYLES, so the charts
  // here and the PDF's figures are one scheme.  Colour is never the only
  // cue: every method also has its own dash and marker.
  var C = {
    blue: "#4a63c8", orange: "#d9832f", green: "#3f9153", red: "#cc4b48",
    grey: "#8a8a8a", ink: "#23232b", ink2: "#4a4a55", ink3: "#7a7a85", rule: "#ecebe6"
  };
  var STYLE = {
    "zfm":        { colour: C.grey,   dash: "1.5 3",     marker: "diamond",  fill: false },
    "zfm-blocks": { colour: C.grey,   dash: "6 2 1.5 2", marker: "tri-down", fill: true  },
    "cnf-wide":   { colour: C.red,    dash: "1 2",       marker: "cross",    fill: false },
    "no-align":   { colour: C.green,  dash: "7 3 1.5 3", marker: "tri-up",   fill: false },
    "align-cqt":  { colour: C.blue,   dash: "6 3",       marker: "circle",   fill: false },
    "align-stft": { colour: C.orange, dash: "2 2.4",     marker: "square",   fill: true, emph: true }
  };
  var DOMAIN_LABEL = { "in-domain": "In domain", "nsynth": "NSynth", "esc50": "ESC-50" };
  var DOMAIN_LONG = { "in-domain": "In domain", "nsynth": "NSynth (out of domain)", "esc50": "ESC-50 (out of domain)" };
  var FAMILY_LABEL = { baseline: "Baselines", ablation: "Ablation", proposed: "Proposed" };
  var SVGNS = "http://www.w3.org/2000/svg";

  // ------------------------------------------------------------ helpers
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
  function sv(tag, attrs, kids) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function fmt(v, d) { return v == null ? "–" : Number(v).toFixed(d); }
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ": " + r.status);
      return r.json();
    });
  }
  function store(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); }
    catch (e) { return null; }
  }

  // ------------------------------------------------------------ the player
  // One audio element for the page.  A clip is a spectrogram that is its own
  // play button; the one playing carries a cursor.
  var player = document.getElementById("player");
  var current = null, raf = 0;

  function stopCurrent() {
    if (current) current.classList.remove("playing");
    current = null;
    cancelAnimationFrame(raf);
  }
  function tick() {
    if (!current) return;
    var d = player.duration || 4;
    var cur = current.querySelector(".cursor");
    if (cur) cur.style.left = Math.min(100, (player.currentTime / d) * 100) + "%";
    raf = requestAnimationFrame(tick);
  }
  player.addEventListener("ended", stopCurrent);
  player.addEventListener("pause", function () { if (current && player.paused) { current.classList.remove("playing"); cancelAnimationFrame(raf); current = null; } });

  function play(btn, src) {
    if (current === btn && !player.paused) { player.pause(); return; }
    stopCurrent();
    current = btn;
    btn.classList.add("playing");
    if (player.getAttribute("src") !== src) player.src = src;
    player.currentTime = 0;
    var p = player.play();
    if (p && p.catch) p.catch(function () { stopCurrent(); });
    raf = requestAnimationFrame(tick);
  }

  function clip(media, label) {
    if (!media || !media.audio) return null;
    var b = el("button", { class: "clip", type: "button", "aria-label": "Play " + (label || "clip") }, [
      el("img", { src: media.spec, alt: "", loading: "lazy", decoding: "async" }),
      el("span", { class: "glyph", "aria-hidden": "true" }),
      el("span", { class: "cursor", "aria-hidden": "true" })
    ]);
    b.addEventListener("click", function (ev) {
      // Click position seeks within the clip once it is playing.
      if (current === b && !player.paused) {
        var r = b.getBoundingClientRect();
        var f = (ev.clientX - r.left) / r.width;
        if (ev.clientX && f > 0.04) { player.currentTime = f * (player.duration || 4); return; }
      }
      play(b, media.audio);
    });
    return b;
  }
  function noRender(text) { return el("div", { class: "norender", text: text || "graph does not render" }); }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && current) player.pause();
  });

  // ------------------------------------------------------------ segmented control
  function segmented(label, options, value, onChange) {
    var wrap = el("div", { class: "seg", role: "group", "aria-label": label }, [el("span", { class: "seg-label", text: label })]);
    var opts = el("div", { class: "opts" });
    options.forEach(function (o) {
      var b = el("button", { type: "button", "aria-pressed": String(o.value === value), text: o.label });
      if (o.title) b.title = o.title;
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(opts.children, function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        onChange(o.value);
      });
      opts.appendChild(b);
    });
    wrap.appendChild(opts);
    return wrap;
  }

  // ======================================================================
  // Figure 1: the flow, waypoint by waypoint
  // ======================================================================
  function drawTrajectories(ex) {
    var host = document.getElementById("traj");
    var ctl = document.getElementById("traj-controls");
    if (!ex.trajectories.length) return;
    var opts = ex.trajectories.map(function (t, i) {
      return { value: i, label: t.label + ", nₘₐₓ=" + t.size + ", " + DOMAIN_LABEL[t.domain] };
    });
    ctl.appendChild(segmented("Example", opts.map(function (o, i) {
      var t = ex.trajectories[i];
      return { value: i, label: DOMAIN_LABEL[t.domain] + " · " + t.size, title: o.label };
    }), 0, function (i) { render(ex.trajectories[i]); }));

    function render(t) {
      stopCurrent(); player.pause();
      host.innerHTML = "";
      var left = el("div", { class: "traj-cond" }, [
        el("h4", { text: "Condition · " + DOMAIN_LONG[t.domain] }),
        clip(t.condition, "condition"),
        el("p", { class: "cap", html: t.caption.charAt(0).toUpperCase() + t.caption.slice(1) + ". Generated by " + t.label + " at <i>n</i><sub>max</sub> = " + t.size + "." })
      ]);
      if (t.target) {
        left.appendChild(el("div", { class: "traj-target" }, [
          el("h4", { text: "Reference graph" }),
          el("img", { src: t.target, alt: "Reference graph", loading: "lazy" })
        ]));
      }
      var maxD = 0;
      t.waypoints.forEach(function (w) { if (w.stft != null) maxD = Math.max(maxD, w.stft); });
      var row = el("div", { class: "row" });
      t.waypoints.forEach(function (w, k) {
        var tt = k === 0 ? "0" : w.t.toFixed(1);
        var step = el("div", { class: "traj-step" }, [
          el("p", { class: "t", html: "<i>t</i> = <b>" + tt + "</b>" }),
          w.graph ? el("img", { class: "graph", src: w.graph, alt: "Decoded graph at t = " + tt, loading: "lazy" }) : null,
          w.rendered && w.audio ? clip(w, "render at t = " + tt) : noRender()
        ]);
        if (w.stft != null) {
          var bar = el("div", { class: "dist-bar", title: "STFT distance to the condition: " + w.stft.toFixed(2) }, [el("span")]);
          bar.firstChild.style.width = (100 * w.stft / maxD).toFixed(1) + "%";
          step.appendChild(bar);
          step.appendChild(el("p", { class: "cap", text: "distance " + w.stft.toFixed(2) }));
        } else {
          step.appendChild(el("p", { class: "cap", text: " " }));
        }
        row.appendChild(step);
      });
      var right = el("div", { class: "traj-steps" }, [
        el("h4", { text: "Decoded state along the flow" }),
        el("div", { class: "traj-axis" }, [
          el("span", { class: "end l", html: "<i>t</i> = 0, Gaussian noise" }),
          el("span", { class: "end r", html: "<i>t</i> = 1, generated graph" }),
          el("span", { class: "arrow" })
        ]),
        row
      ]);
      host.appendChild(left);
      host.appendChild(right);
    }
    render(ex.trajectories[0]);
  }

  // ======================================================================
  // Figure 2: one patch, drawn by hand
  // ======================================================================
  // Transcribed from the n_max = 10 in-domain test example 0000 (its exported
  // target graph); values exactly as the renderer prints them.
  var ROLE = {
    control: { stroke: "#2e7d4f", fill: "#d7eadd", name: "control" },
    source:  { stroke: "#35618f", fill: "#d5e1ee", name: "audio source" },
    output:  { stroke: "#b3352b", fill: "#f2d6d3", name: "output" }
  };
  var EDGE = { reg: { colour: "#4b4b4b", name: "Reg." }, alt: { colour: "#b0621a", name: "Alt." } };
  var PATCH = {
    nodes: [
      { id: "kbd",  x: 92,  y: 205, type: "Kbd",      role: "control", p: ["72 midi", "3.35–3.50 s"],
        about: "Keyboard: supplies pitch and gate onset/offset timing." },
      { id: "env1", x: 248, y: 82,  type: "ADSR",     role: "control", p: ["A0.03 D0.26", "S0.27 R0.90"],
        about: "Envelope: attack, decay, sustain and release." },
      { id: "env2", x: 248, y: 328, type: "ADSR",     role: "control", p: ["A0.51 D0.00", "S0.28 R0.62"],
        about: "Envelope: attack, decay, sustain and release." },
      { id: "lfo",  x: 398, y: 128, type: "LFO saw",  role: "control", p: ["17.30 Hz"],
        about: "Low-frequency oscillator with a sawtooth waveform; each of the five LFO waveforms is its own node type." },
      { id: "sin",  x: 515, y: 222, type: "Sin",      role: "source",  p: ["tun −11.8"],
        about: "Sine oscillator; tuning offset in semitones." },
      { id: "out",  x: 612, y: 318, type: "Out",      role: "output",  p: [],
        about: "Output." }
    ],
    edges: [
      ["kbd", "env1", "alt"], ["kbd", "env2", "reg"], ["kbd", "sin", "alt"],
      ["env1", "lfo", "reg"], ["lfo", "sin", "alt"], ["env2", "sin", "alt"],
      ["sin", "out", "reg"]
    ]
  };
  var R_NODE = 39;

  function drawPatch(ex) {
    var svg = document.getElementById("patch-svg");
    var byId = {};
    PATCH.nodes.forEach(function (n) { byId[n.id] = n; });
    var defs = sv("defs");
    Object.keys(EDGE).forEach(function (k) {
      defs.appendChild(sv("marker", { id: "ah-" + k, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" },
        [sv("path", { d: "M0,1 L10,5 L0,9 z", fill: EDGE[k].colour })]));
    });
    svg.appendChild(defs);

    var gEdges = sv("g"), gNodes = sv("g");
    var edgeEls = [], nodeEls = {};
    PATCH.edges.forEach(function (e) {
      var a = byId[e[0]], b = byId[e[1]], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      var ux = dx / L, uy = dy / L;
      var x1 = a.x + ux * (R_NODE + 2), y1 = a.y + uy * (R_NODE + 2);
      var x2 = b.x - ux * (R_NODE + 4), y2 = b.y - uy * (R_NODE + 4);
      var g = sv("g", { class: "edge" }, [
        sv("path", { d: "M" + x1 + "," + y1 + " L" + x2 + "," + y2, stroke: EDGE[e[2]].colour, "marker-end": "url(#ah-" + e[2] + ")" }),
        // a wide invisible hit target, so a 1.8px line is hoverable
        sv("path", { d: "M" + x1 + "," + y1 + " L" + x2 + "," + y2, stroke: "transparent", "stroke-width": "12" })
      ]);
      g.dataset.a = e[0]; g.dataset.b = e[1]; g.dataset.k = e[2];
      edgeEls.push(g);
      gEdges.appendChild(g);
    });
    PATCH.nodes.forEach(function (n) {
      var r = ROLE[n.role];
      var lines = n.p.length;
      var g = sv("g", { class: "node", transform: "translate(" + n.x + "," + n.y + ")", tabindex: "0" }, [
        sv("circle", { r: R_NODE, fill: r.fill, stroke: r.stroke }),
        sv("text", { "text-anchor": "middle", y: lines ? -8 - (lines - 1) * 6 : 5, "font-size": "15", text: n.type })
      ]);
      n.p.forEach(function (line, i) {
        g.appendChild(sv("text", { class: "p", "text-anchor": "middle", y: 9 + i * 13 - (lines - 1) * 6, text: line }));
      });
      g.dataset.id = n.id;
      nodeEls[n.id] = g;
      gNodes.appendChild(g);
    });
    svg.appendChild(gEdges);
    svg.appendChild(gNodes);

    var inspect = document.getElementById("patch-inspect");
    var resting = inspect.innerHTML;
    function focusNode(id) {
      var keep = {}; keep[id] = true;
      edgeEls.forEach(function (g) {
        var on = g.dataset.a === id || g.dataset.b === id;
        g.classList.toggle("dim", !on);
        if (on) { keep[g.dataset.a] = true; keep[g.dataset.b] = true; }
      });
      for (var k in nodeEls) { nodeEls[k].classList.toggle("dim", !keep[k]); nodeEls[k].classList.toggle("on", k === id); }
      var n = byId[id];
      var ins = PATCH.edges.filter(function (e) { return e[1] === id; }).map(function (e) { return byId[e[0]].type + " (" + EDGE[e[2]].name + ")"; });
      var outs = PATCH.edges.filter(function (e) { return e[0] === id; }).map(function (e) { return byId[e[1]].type + " (" + EDGE[e[2]].name + ")"; });
      inspect.innerHTML = "<b>" + n.type + "</b> &middot; " + ROLE[n.role].name + "<br>" + n.about +
        "<table><tr><td>parameters</td><td>" + (n.p.length ? n.p.join("; ") : "none") + "</td></tr>" +
        "<tr><td>from</td><td>" + (ins.join(", ") || "–") + "</td></tr>" +
        "<tr><td>to</td><td>" + (outs.join(", ") || "–") + "</td></tr></table>";
    }
    function focusEdge(g) {
      edgeEls.forEach(function (x) { x.classList.toggle("dim", x !== g); });
      for (var k in nodeEls) { nodeEls[k].classList.toggle("dim", k !== g.dataset.a && k !== g.dataset.b); nodeEls[k].classList.remove("on"); }
      inspect.innerHTML = "<b>" + byId[g.dataset.a].type + " → " + byId[g.dataset.b].type + "</b><br>edge class " + EDGE[g.dataset.k].name;
    }
    function clear() {
      edgeEls.forEach(function (g) { g.classList.remove("dim"); });
      for (var k in nodeEls) { nodeEls[k].classList.remove("dim"); nodeEls[k].classList.remove("on"); }
      inspect.innerHTML = resting;
    }
    for (var id in nodeEls) (function (id) {
      nodeEls[id].addEventListener("mouseenter", function () { focusNode(id); });
      nodeEls[id].addEventListener("focus", function () { focusNode(id); });
      nodeEls[id].addEventListener("mouseleave", clear);
      nodeEls[id].addEventListener("blur", clear);
    })(id);
    edgeEls.forEach(function (g) {
      g.addEventListener("mouseenter", function () { focusEdge(g); });
      g.addEventListener("mouseleave", clear);
    });

    var key = document.getElementById("patch-key");
    ["control", "source", "output"].forEach(function (k) {
      var i = el("i"); i.style.background = ROLE[k].fill; i.style.borderColor = ROLE[k].stroke;
      key.appendChild(el("span", {}, [i, document.createTextNode(ROLE[k].name)]));
    });
    Object.keys(EDGE).forEach(function (k) {
      var i = el("i", { class: "line" }); i.style.borderTopColor = EDGE[k].colour;
      key.appendChild(el("span", {}, [i, document.createTextNode("edge class " + EDGE[k].name)]));
    });

    // The two renders: the target, and GRAFT-CQT's graph for it.
    var set = ex.sets["n10/in-domain"];
    var row = set && (set.selected.concat(set.random)).filter(function (r) { return r.id === "0000"; })[0];
    var traj = ex.trajectories.filter(function (t) { return t.domain === "in-domain" && t.id === "0000" && t.size === 10; })[0];
    var cond = row ? row.condition : traj && traj.condition;
    if (cond) document.getElementById("patch-target").appendChild(clip(cond, "render of this graph"));
    var gen = traj && traj.waypoints[traj.waypoints.length - 1];
    if (gen && gen.audio) document.getElementById("patch-graft").appendChild(clip(gen, "GRAFT-CQT's render"));
  }

  // ======================================================================
  // Section 3: the listening examples
  // ======================================================================
  function drawExamples(ex) {
    var state = {
      size: Number(store("graft.size")) || 10,
      domain: store("graft.domain") || "nsynth",
      set: "selected"
    };
    if (ex.sizes.indexOf(state.size) < 0) state.size = 10;
    if (ex.domains.indexOf(state.domain) < 0) state.domain = "nsynth";

    var ctl = document.getElementById("ex-controls");
    ctl.appendChild(segmented("Domain", ex.domains.map(function (d) { return { value: d, label: DOMAIN_LABEL[d] }; }), state.domain,
      function (v) { state.domain = v; store("graft.domain", v); render(); }));
    ctl.appendChild(segmented("Graph size nₘₐₓ", ex.sizes.map(function (s) { return { value: s, label: String(s) }; }), state.size,
      function (v) { state.size = v; store("graft.size", String(v)); render(); }));
    ctl.appendChild(segmented("Examples", [
      { value: "selected", label: "Selected" }, { value: "random", label: "Random" }
    ], state.set, function (v) { state.set = v; render(); }));

    var notice = document.getElementById("ex-notice");
    var host = document.getElementById("ex-table");
    // GRAFT first: the columns nearest the condition are the ones a phone
    // reader sees without scrolling.  The charts and Table 1 keep the paper's order.
    var arms = ex.arms.slice().reverse();

    function noticeText(set) {
      var how;
      if (state.set === "random") {
        how = "<b>Random</b>: six conditions drawn uniformly (fixed seed) from the 64 exported, excluding the selected ones.";
      } else if (set.selected_by === "author") {
        how = "<b>Selected</b>: chosen by listening, from the 64 exported conditions; the <b>Random</b> set beside it is the control on that choice.";
      } else {
        how = "<b>Selected</b>: the six conditions with the lowest mean MSS across the three GRAFT variants. This ranks by our own metric, so read the <b>Random</b> set beside it.";
      }
      return how + " For every method, baselines included, each graph shown is the best of " + ex.best_of +
        " samples by " + String(ex.best_of_metric || "MSS").toUpperCase() + " to the condition; Table&nbsp;1 scores single samples. " +
        "The number under a render is that example&rsquo;s paired MSS (lower is closer).";
    }

    function render() {
      stopCurrent(); player.pause();
      host.innerHTML = "";
      var set = ex.sets["n" + state.size + "/" + state.domain];
      if (!set || set.pending) {
        notice.innerHTML = "";
        host.appendChild(el("div", { class: "pending-box", text:
          "In domain, each graph size is its own corpus, so its conditioning clips differ from nₘₐₓ = 10’s. " +
          "These examples are being added." }));
        return;
      }
      notice.innerHTML = noticeText(set);
      var rows = set[state.set];

      var table = el("table", { class: "ex" });
      var cg = el("colgroup");
      cg.appendChild(el("col", { class: "c-cond" }));
      var lastFam = null;
      arms.forEach(function (a) {
        if (lastFam && a.family !== lastFam) cg.appendChild(el("col", { class: "c-sep" }));
        cg.appendChild(el("col", { class: "c-arm" }));
        lastFam = a.family;
      });
      table.appendChild(cg);

      var thead = el("thead");
      var fam = el("tr", { class: "fam" }, [el("th", { text: "" })]);
      var head = el("tr", {}, [el("th", { text: "Condition" })]);
      lastFam = null;
      var famSpan = null;
      arms.forEach(function (a) {
        if (a.family !== lastFam) {
          if (lastFam) { fam.appendChild(el("th", { class: "sep" })); head.appendChild(el("th", { class: "sep" })); }
          famSpan = el("th", { text: FAMILY_LABEL[a.family], colspan: "1" });
          fam.appendChild(famSpan);
        } else {
          famSpan.setAttribute("colspan", String(Number(famSpan.getAttribute("colspan")) + 1));
        }
        var sw = el("span", { class: "sw" }); sw.style.borderTopColor = STYLE[a.key].colour;
        sw.style.borderTopStyle = STYLE[a.key].emph ? "solid" : "solid";
        head.appendChild(el("th", {}, [sw, document.createTextNode(a.label)]));
        lastFam = a.family;
      });
      thead.appendChild(fam);
      thead.appendChild(head);
      table.appendChild(thead);

      var tbody = el("tbody");
      rows.forEach(function (r) {
        var title = el("div", { class: "title" }, [document.createTextNode(r.note || " ")]);
        title.appendChild(el("span", { text: (r.note ? " · " : "") + "#" + r.id }));
        var gbtn = el("button", { class: "graph-btn", type: "button", text: "show graphs" });
        var cond = el("td", { class: "cond" }, [title, clip(r.condition, "condition " + r.id),
          el("div", { class: "ex-meta" }, [gbtn])]);
        var tr = el("tr", {}, [cond]);
        var best = null;
        arms.forEach(function (a) {
          var c = r.cells[a.key];
          if (c && c.rendered && c.mss != null && (best === null || c.mss < best)) best = c.mss;
        });
        lastFam = null;
        arms.forEach(function (a) {
          if (lastFam && a.family !== lastFam) tr.appendChild(el("td", { class: "sep" }));
          lastFam = a.family;
          var c = r.cells[a.key];
          var td = el("td");
          if (!c) { td.appendChild(noRender("not exported")); tr.appendChild(td); return; }
          if (c.rendered && c.audio) td.appendChild(clip(c, a.label + ", condition " + r.id));
          else td.appendChild(noRender("graph does not render"));
          var meta = el("div", { class: "ex-meta" });
          var nodes = c.n_nodes != null ? Math.round(c.n_nodes) + " nodes" : "";
          if (c.rendered && c.mss != null) {
            meta.appendChild(el("span", { class: c.mss === best ? "good" : "", text: "MSS " + c.mss.toFixed(2) }));
          } else meta.appendChild(el("span", { text: " " }));
          meta.appendChild(el("span", { text: nodes + (c.exact === 1 ? " · exact" : "") }));
          td.appendChild(meta);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);

        // the graphs, on demand
        var grow = null;
        gbtn.addEventListener("click", function () {
          if (grow) { grow.remove(); grow = null; gbtn.textContent = "show graphs"; return; }
          grow = el("tr", { class: "graph-row" });
          var c0 = el("td", { class: "cond" });
          if (r.target) { c0.appendChild(el("div", { class: "ex-meta", text: "reference graph" })); c0.appendChild(el("img", { src: r.target, alt: "Reference graph", loading: "lazy" })); }
          else c0.appendChild(el("div", { class: "none", text: state.domain === "in-domain" ? "" : "No reference graph out of domain." }));
          grow.appendChild(c0);
          var lf = null;
          arms.forEach(function (a) {
            if (lf && a.family !== lf) grow.appendChild(el("td", { class: "sep" }));
            lf = a.family;
            var c = r.cells[a.key], td = el("td");
            if (c && c.graph) td.appendChild(el("img", { src: c.graph, alt: a.label + " graph", loading: "lazy" }));
            else td.appendChild(el("div", { class: "none", text: "drawing not exported for this example" }));
            grow.appendChild(td);
          });
          tr.after(grow);
          gbtn.textContent = "hide graphs";
        });
      });
      table.appendChild(tbody);
      host.appendChild(el("div", { class: "ex-scroll" }, [table]));
    }
    render();
  }

  // ======================================================================
  // Charts (Figure 4, Figure 5): small multiples drawn as SVG
  // ======================================================================
  var tip = document.getElementById("tip");
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.style.display = "block";
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    tip.style.left = left + "px"; tip.style.top = top + "px";
  }
  function hideTip() { tip.style.display = "none"; }

  function marker(kind, x, y, s, colour, filled) {
    var f = filled ? colour : "#fff", a = { stroke: colour, "stroke-width": 1.3, fill: f };
    function poly(pts) { a.points = pts.map(function (p) { return (x + p[0] * s) + "," + (y + p[1] * s); }).join(" "); return sv("polygon", a); }
    switch (kind) {
      case "circle": a.cx = x; a.cy = y; a.r = s * 0.9; return sv("circle", a);
      case "square": a.x = x - s * 0.82; a.y = y - s * 0.82; a.width = s * 1.64; a.height = s * 1.64; return sv("rect", a);
      case "diamond": return poly([[0, -1.15], [1, 0], [0, 1.15], [-1, 0]]);
      case "tri-up": return poly([[0, -1.1], [1.05, 0.8], [-1.05, 0.8]]);
      case "tri-down": return poly([[0, 1.1], [1.05, -0.8], [-1.05, -0.8]]);
      case "cross":
        return sv("path", { d: "M" + (x - s) + "," + (y - s) + "L" + (x + s) + "," + (y + s) + "M" + (x - s) + "," + (y + s) + "L" + (x + s) + "," + (y - s), stroke: colour, "stroke-width": 1.6 });
    }
  }

  function legend(host, arms, hidden, onToggle) {
    host.innerHTML = "";
    arms.forEach(function (a) {
      var st = STYLE[a.key];
      var icon = sv("svg", { viewBox: "0 0 30 12", "aria-hidden": "true" }, [
        sv("line", { x1: 0, y1: 6, x2: 30, y2: 6, stroke: st.colour, "stroke-width": st.emph ? 2.4 : 1.6, "stroke-dasharray": st.dash }),
        marker(st.marker, 15, 6, 4, st.colour, st.fill)
      ]);
      var b = el("button", { type: "button", "aria-pressed": String(!hidden[a.key]) }, [icon, document.createTextNode(a.label)]);
      b.addEventListener("click", function () {
        hidden[a.key] = !hidden[a.key];
        b.setAttribute("aria-pressed", String(!hidden[a.key]));
        onToggle();
      });
      host.appendChild(b);
    });
  }

  /* One panel.  series: [{key,label,values:[v|null per x]}]. */
  function panel(opts) {
    var W = 300, H = opts.height || 170, m = { l: 40, r: 12, t: 8, b: 26 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var xs = opts.x, nx = xs.length;
    function X(i) { return m.l + (nx === 1 ? iw / 2 : (i * iw) / (nx - 1)); }
    var y0 = opts.ylim[0], y1 = opts.ylim[1];
    function Y(v) { return m.t + ih - ((v - y0) / (y1 - y0)) * ih; }
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opts.aria });

    var grid = sv("g", { class: "grid" }), axis = sv("g", { class: "axis" });
    opts.yticks.forEach(function (v) {
      grid.appendChild(sv("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
      axis.appendChild(sv("text", { x: m.l - 6, y: Y(v) + 3.5, "text-anchor": "end", text: opts.yfmt ? opts.yfmt(v) : String(v) }));
    });
    xs.forEach(function (x, i) {
      axis.appendChild(sv("text", { x: X(i), y: H - 8, "text-anchor": "middle", text: String(x) }));
    });
    axis.appendChild(sv("line", { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }));
    svg.appendChild(grid);
    svg.appendChild(axis);
    if (opts.ylabel) {
      svg.appendChild(sv("text", { x: 11, y: m.t + ih / 2, transform: "rotate(-90 11 " + (m.t + ih / 2) + ")", "text-anchor": "middle", text: opts.ylabel }));
    }

    var hoverG = sv("g", { class: "hover" });
    var vline = sv("line", { y1: m.t, y2: m.t + ih, visibility: "hidden" });
    hoverG.appendChild(vline);
    svg.appendChild(hoverG);

    var seriesG = {};
    // draw the emphasised series last, so it sits on top
    var order = opts.series.slice().sort(function (a, b) { return (STYLE[a.key].emph ? 1 : 0) - (STYLE[b.key].emph ? 1 : 0); });
    order.forEach(function (s) {
      var st = STYLE[s.key];
      var g = sv("g", { class: "series" + (st.emph ? " emph" : "") });
      var d = "", pen = false;
      s.values.forEach(function (v, i) {
        if (v == null) { pen = false; return; }
        d += (pen ? "L" : "M") + X(i) + "," + Y(v);
        pen = true;
      });
      g.appendChild(sv("path", { class: "line", d: d, stroke: st.colour, "stroke-dasharray": st.dash }));
      s.values.forEach(function (v, i) {
        if (v == null) return;
        g.appendChild(marker(st.marker, X(i), Y(v), st.emph ? 4.2 : 3.6, st.colour, st.fill));
      });
      seriesG[s.key] = g;
      svg.appendChild(g);
    });

    // hover: the nearest graph size, every visible method's value at it
    var hit = sv("rect", { x: m.l - 10, y: 0, width: iw + 20, height: H, fill: "transparent" });
    svg.appendChild(hit);
    function onMove(ev) {
      var r = svg.getBoundingClientRect();
      var px = ((ev.clientX - r.left) / r.width) * W;
      var i = Math.max(0, Math.min(nx - 1, Math.round(((px - m.l) / iw) * (nx - 1))));
      vline.setAttribute("x1", X(i)); vline.setAttribute("x2", X(i)); vline.setAttribute("visibility", "visible");
      var rowsHtml = opts.series.filter(function (s) { return !opts.hidden[s.key]; }).slice().sort(function (a, b) {
        var va = a.values[i], vb = b.values[i];
        if (va == null) return 1; if (vb == null) return -1;
        return opts.higherBetter ? vb - va : va - vb;
      }).map(function (s) {
        var st = STYLE[s.key], v = s.values[i];
        return "<tr><td><svg width='22' height='10' style='vertical-align:-1px'><line x1='0' y1='5' x2='22' y2='5' stroke='" + st.colour +
          "' stroke-width='2' stroke-dasharray='" + st.dash + "'/></svg></td><td>" + s.label + "</td><td class='v'>" +
          (v == null ? "no renders" : opts.vfmt(v)) + "</td></tr>";
      }).join("");
      showTip("<div class='h'>" + opts.title + " · n<sub>max</sub> = " + xs[i] + "</div><table>" + rowsHtml + "</table>", ev.clientX, ev.clientY);
    }
    hit.addEventListener("mousemove", onMove);
    hit.addEventListener("mouseleave", function () { vline.setAttribute("visibility", "hidden"); hideTip(); });

    return {
      svg: svg,
      restyle: function () {
        for (var k in seriesG) seriesG[k].classList.toggle("dim", !!opts.hidden[k]);
      }
    };
  }

  function drawScaling(res) {
    var arms = res.arms, sizes = [10, 20, 40], hidden = {};
    var host = document.getElementById("scaling-charts");
    var panels = [];
    var rowsSpec = [
      { metric: "mss", title: "paired MSS", ylabel: "MSS", ylim: [0, 5], yticks: [0, 1, 2, 3, 4, 5], vfmt: function (v) { return v.toFixed(3); }, higherBetter: false },
      { metric: "render", title: "render rate", ylabel: "render rate (%)", ylim: [0, 100], yticks: [0, 25, 50, 75, 100], vfmt: function (v) { return v.toFixed(1) + "%"; }, higherBetter: true }
    ];
    rowsSpec.forEach(function (spec) {
      ["in-domain", "nsynth", "esc50"].forEach(function (dom) {
        var series = arms.map(function (a) {
          return { key: a.key, label: a.label, values: sizes.map(function (s) { return res.table[s][a.key][dom][spec.metric]; }) };
        });
        var p = panel({
          x: sizes, ylim: spec.ylim, yticks: spec.yticks, ylabel: spec.ylabel, series: series, hidden: hidden,
          vfmt: spec.vfmt, higherBetter: spec.higherBetter, title: DOMAIN_LONG[dom] + ", " + spec.title,
          aria: spec.title + " against graph size, " + DOMAIN_LONG[dom]
        });
        panels.push(p);
        host.appendChild(el("div", { class: "chart" }, [el("p", { class: "ttl", text: DOMAIN_LONG[dom] + " · " + spec.title + (spec.higherBetter ? " ↑" : " ↓") }), p.svg]));
      });
    });
    host.appendChild(el("p", { style: "grid-column:1/-1;font-family:var(--sans);font-size:.78rem;color:var(--ink-3);margin:.2rem 0 0;text-align:center", html: "maximum graph size <i>n</i><sub>max</sub>" }));
    legend(document.getElementById("scaling-legend"), arms, hidden, function () { panels.forEach(function (p) { p.restyle(); }); });
  }

  function drawAE(res) {
    var arms = res.arms.filter(function (a) { return res.ae[a.key]; }), hidden = {};
    var host = document.getElementById("ae-charts");
    var panels = [];
    [
      { k: "mss", title: "(a) reconstruction MSS", ylim: [0.4, 1.2], yticks: [0.4, 0.6, 0.8, 1.0, 1.2], higher: false },
      { k: "cka", title: "(b) CKA to log-mel", ylim: [0, 0.6], yticks: [0, 0.2, 0.4, 0.6], higher: true }
    ].forEach(function (spec) {
      var p = panel({
        x: [10, 20, 40], ylim: spec.ylim, yticks: spec.yticks, hidden: hidden, height: 180, higherBetter: spec.higher,
        series: arms.map(function (a) { return { key: a.key, label: a.label, values: res.ae[a.key][spec.k] }; }),
        vfmt: function (v) { return v.toFixed(3); }, title: spec.title, aria: spec.title + " against graph size",
        yfmt: function (v) { return v.toFixed(1); }
      });
      panels.push(p);
      host.appendChild(el("div", { class: "chart" }, [el("p", { class: "ttl", text: spec.title + (spec.higher ? " ↑" : " ↓") }), p.svg]));
    });
    legend(document.getElementById("ae-legend"), arms, hidden, function () { panels.forEach(function (p) { p.restyle(); }); });
  }

  // ======================================================================
  // Table 1, booktabs
  // ======================================================================
  function drawTable(res) {
    var tbl = document.getElementById("main-table");
    var ctl = document.getElementById("tbl-controls");
    var state = { domain: "in-domain" };
    ctl.appendChild(segmented("Audio", ["in-domain", "nsynth", "esc50"].map(function (d) { return { value: d, label: DOMAIN_LABEL[d] }; }), state.domain,
      function (v) { state.domain = v; render(); }));

    var GRAPH = [["node_mae", "|Δn|", 2, "↓"], ["edge_mae", "|Δe|", 2, "↓"], ["exact", "gr.%", 1, "↑"], ["f1", "F1", 3, "↑"]];
    var AUDIO = [["render", "rend.%", 1, "↑"], ["mss", "MSS", 3, "↓"], ["sot", "SOT", 3, "↓"], ["wmfcc", "wMFCC", 2, "↓"], ["rms", "RMS", 3, "↓"]];

    function render() {
      tbl.innerHTML = "";
      var thead = el("thead");
      thead.appendChild(el("tr", { class: "grp" }, [
        el("th", { class: "blank" }),
        el("th", { colspan: String(GRAPH.length), text: "graph (in domain)" }),
        el("th", { colspan: String(AUDIO.length), text: "audio: " + DOMAIN_LONG[state.domain] })
      ]));
      var h = el("tr", {}, [el("th", { text: "method" })]);
      GRAPH.concat(AUDIO).forEach(function (c) { h.appendChild(el("th", { html: c[1] + " <span class='dir'>" + c[3] + "</span>" })); });
      thead.appendChild(h);
      tbl.appendChild(thead);
      var tb = el("tbody");
      [10, 20, 40].forEach(function (s) {
        tb.appendChild(el("tr", { class: "block" }, [el("td", { colspan: String(1 + GRAPH.length + AUDIO.length), html: "<i>n</i><sub>max</sub> = " + s })]));
        res.arms.forEach(function (a) {
          var row = res.table[s][a.key];
          var tr = el("tr", { class: a.family === "baseline" ? "" : "ours" }, [el("td", { text: a.label })]);
          [["graph", GRAPH], [state.domain, AUDIO]].forEach(function (blk) {
            var d = row[blk[0]], best = d._best || [];
            blk[1].forEach(function (c) {
              var v = d[c[0]];
              tr.appendChild(el("td", { class: (v == null ? "na" : "") + (best.indexOf(c[0]) >= 0 ? " best" : ""), text: fmt(v, c[2]) }));
            });
          });
          tb.appendChild(tr);
        });
      });
      tbl.appendChild(tb);
    }
    render();
  }

  // ------------------------------------------------------------ lightbox
  // Any graph drawing opens at full size; Escape or a click closes it.
  function wireLightbox() {
    var box = el("div", { class: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": "Graph drawing" }, [el("img", { alt: "" })]);
    document.body.appendChild(box);
    function close() { box.classList.remove("open"); }
    box.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t.tagName === "IMG" && (t.classList.contains("graph") || t.closest(".traj-target") || t.closest(".graph-row"))) {
        box.firstChild.src = t.src; box.firstChild.alt = t.alt; box.classList.add("open");
      }
    });
  }

  // ------------------------------------------------------------ misc
  function wireCopy() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (b) {
      b.addEventListener("click", function () {
        var t = document.getElementById(b.getAttribute("data-copy")).textContent;
        if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () {
          b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500);
        });
      });
    });
  }
  function typeset() {
    if (window.renderMathInElement) {
      window.renderMathInElement(document.body, {
        delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
        throwOnError: false
      });
    }
  }

  function fail(where, err) {
    var box = document.getElementById(where);
    if (box) box.appendChild(el("div", { class: "pending-box", text:
      location.protocol === "file:" ? "This figure reads its data with fetch(), which browsers block on file:// pages. Serve the directory (python -m http.server) to view it."
        : "Could not load data: " + err.message }));
  }

  function start() {
    wireCopy();
    wireLightbox();
    typeset();
    getJSON("static/data/examples.json").then(function (ex) {
      var sr = document.getElementById("sr-note");
      var served = ex.served_sample_rates || [], model = ex.model_sample_rate;
      var full = served.filter(function (r) { return r !== model; })[0];
      if (sr) sr.textContent = "Audio: 4 s, mono, lossless FLAC, not loudness-normalised. " + (full
        ? "Generated graphs and in-domain targets are rendered at " + (full / 1000) + " kHz; out-of-domain recordings are played at " +
          (model / 1000) + " kHz, the rate the model hears."
        : "Rendered at " + (model / 1000) + " kHz, the rate the model is trained and evaluated at.");
      drawTrajectories(ex);
      drawPatch(ex);
      drawExamples(ex);
    }).catch(function (e) { fail("traj", e); fail("ex-table", e); });
    getJSON("static/data/results.json").then(function (res) {
      drawScaling(res);
      drawAE(res);
      drawTable(res);
    }).catch(function (e) { fail("scaling-charts", e); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
