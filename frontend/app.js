const STAGES = ["ingest", "features", "ml", "graph", "decision", "response"];
let feedCache = [];
let lastResultEntry = null;

const TAB_META = {
  overview: { title: "Overview", sub: "Live pipeline status and portfolio-level signal" },
  score: { title: "Score & Decide", sub: "Score a transaction, run a scenario, inspect the drivers" },
  feed: { title: "Live Feed", sub: "Every transaction scored this session" },
  roadmap: { title: "Roadmap", sub: "Operational layers not built yet" },
};

function switchTab(tab) {
  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tab}`);
  });
  const meta = TAB_META[tab];
  if (meta) {
    document.getElementById("topbar-title").textContent = meta.title;
    document.getElementById("topbar-sub").textContent = meta.sub;
  }
}

function setupTabs() {
  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function setDefaultTimestamp() {
  const el = document.getElementById("f-timestamp");
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  el.value = now.toISOString().slice(0, 16);
}

function animatePipeline() {
  return new Promise((resolve) => {
    STAGES.forEach((stage, i) => {
      setTimeout(() => {
        document.querySelectorAll(".pipeline-stage").forEach((el) => el.classList.remove("active"));
        const el = document.querySelector(`.pipeline-stage[data-stage="${stage}"]`);
        if (el) el.classList.add("active");
        if (i === STAGES.length - 1) {
          setTimeout(() => {
            document.querySelectorAll(".pipeline-stage").forEach((el2) => el2.classList.remove("active"));
            resolve();
          }, 220);
        }
      }, i * 150);
    });
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function decisionClass(decision) {
  if (decision === "approve") return "decision-approve";
  if (decision === "step-up") return "decision-step-up";
  return "decision-block";
}

function statusColor(decision) {
  if (decision === "approve") return "var(--status-good)";
  if (decision === "step-up") return "var(--status-warning)";
  return "var(--status-critical)";
}

function gaugeColor(score) {
  if (score < 0.3) return "var(--status-good)";
  if (score < 0.7) return "var(--status-warning)";
  return "var(--status-critical)";
}

function renderResult(entry, isPreview = false) {
  if (!isPreview) lastResultEntry = entry;
  document.getElementById("result-empty").style.display = "none";
  document.getElementById("result-body").style.display = "block";
  document.getElementById("r-preview-badge").style.display = isPreview ? "inline-block" : "none";

  const badge = document.getElementById("r-decision");
  badge.textContent = entry.decision;
  badge.className = "decision-badge " + decisionClass(entry.decision);

  const pct = Math.round(entry.risk_score * 100);
  document.getElementById("r-score").textContent = pct + "%";
  const fill = document.getElementById("r-gauge-fill");
  fill.style.width = pct + "%";
  fill.style.background = gaugeColor(entry.risk_score);

  const flagEl = document.getElementById("r-flag");
  if (entry.flagged_reason === "puppet_signature") {
    flagEl.style.display = "block";
    flagEl.textContent = "⚠ Coercion pattern detected — puppet_score + session amount rule (Section 5.1) overrode the ML decision.";
  } else {
    flagEl.style.display = "none";
  }

  renderShapStemplot(entry);

  document.getElementById("r-puppet").textContent = entry.puppet_score;
  const gf = document.getElementById("r-graph-flags");
  gf.innerHTML = "";
  Object.entries(entry.graph_flags || {}).forEach(([k, v]) => {
    const span = document.createElement("span");
    span.textContent = `${k}: ${v} (stub)`;
    gf.appendChild(span);
  });
}

function prependFeedRow(entry) {
  feedCache.unshift(entry);
  renderFeed();
}

function renderFeed() {
  const body = document.getElementById("feed-body");
  const empty = document.getElementById("feed-empty");
  if (feedCache.length === 0) {
    body.innerHTML = "";
    empty.style.display = "block";
  } else {
    empty.style.display = "none";
    body.innerHTML = "";
    feedCache.slice(0, 50).forEach((entry, idx) => {
      const tr = document.createElement("tr");
      const time = new Date(entry.timestamp);
      const badgeClass = decisionClass(entry.decision);
      tr.innerHTML = `
        <td>${isNaN(time) ? escapeHtml(entry.timestamp) : time.toLocaleTimeString()}</td>
        <td>${escapeHtml(entry.sender_id)}</td>
        <td>${escapeHtml(entry.receiver_id)}</td>
        <td>₹${Number(entry.amount).toLocaleString("en-IN")}</td>
        <td>${escapeHtml(entry.channel)}</td>
        <td>${(entry.risk_score * 100).toFixed(0)}%</td>
        <td><span class="decision-badge ${badgeClass}">${escapeHtml(entry.decision)}</span></td>
      `;
      tr.addEventListener("click", () => {
        renderResult(feedCache[idx]);
        switchTab("score");
      });
      body.appendChild(tr);
    });
  }
  renderCharts();
}

function renderCharts() {
  renderDecisionBarChart();
  renderLineChart();
  renderStatSparklines();
  renderChannelDonut();
  renderRiskScatter();
  renderFeatureImportance();
  renderTopSenders();
}

function renderShapStemplot(entry) {
  const wrap = document.getElementById("shap-stemplot");
  const sub = document.getElementById("shap-chart-sub");
  const shap = entry ? entry.shap_values || {} : {};
  const rows = Object.entries(shap);
  wrap.innerHTML = "";
  if (rows.length === 0) {
    wrap.innerHTML = '<div class="viz-empty">Score a transaction or run a scenario to see feature drivers.</div>';
    sub.textContent = "Selected transaction — drivers of the risk score";
    return;
  }
  sub.textContent = `Transaction ${entry.transaction_id || ""} — drivers of the risk score`;
  const maxAbs = Math.max(0.0001, ...rows.map(([, v]) => Math.abs(v)));
  rows.forEach(([name, val]) => {
    const pct = Math.min(50, (Math.abs(val) / maxAbs) * 50).toFixed(1);
    const positive = val >= 0;
    const color = positive ? "var(--div-pos)" : "var(--div-neg)";
    const row = document.createElement("div");
    row.className = "stem-row";
    row.innerHTML = `
      <div class="stem-label">${escapeHtml(name)}</div>
      <div class="stem-track">
        <div class="stem-baseline"></div>
        <div class="stem-bar" style="${positive ? "left" : "right"}:50%; width:${pct}%; background:${color};"></div>
        <div class="stem-dot" style="left:calc(50% ${positive ? "+" : "-"} ${pct}%); background:${color};"></div>
      </div>
      <div class="stem-val">${val.toFixed(3)}</div>
    `;
    wrap.appendChild(row);
  });
}

function renderDecisionBarChart() {
  const wrap = document.getElementById("decision-barchart");
  wrap.innerHTML = "";
  if (feedCache.length === 0) {
    wrap.innerHTML = '<div class="viz-empty">No transactions yet — score one or run a scenario.</div>';
    return;
  }
  const counts = { approve: 0, "step-up": 0, block: 0 };
  feedCache.forEach((e) => {
    if (counts[e.decision] !== undefined) counts[e.decision]++;
  });
  const max = Math.max(1, ...Object.values(counts));
  Object.entries(counts).forEach(([label, count]) => {
    const pct = (count / max) * 100;
    const row = document.createElement("div");
    row.className = "viz-bar-row";
    row.innerHTML = `
      <div class="viz-bar-label">${escapeHtml(label)}</div>
      <div class="viz-bar-track"><div class="viz-bar-fill" style="width:${pct}%; background:${statusColor(label)};"></div></div>
      <div class="viz-bar-value">${count}</div>
    `;
    wrap.appendChild(row);
  });
}

// Catmull-Rom -> cubic Bezier, for a smooth (not jagged) trend line
function smoothPathD(pts) {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]}`;
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function renderLineChart() {
  const wrap = document.getElementById("risk-linechart");
  if (feedCache.length === 0) {
    wrap.innerHTML = '<div class="viz-empty">No transactions yet — score one or run a scenario.</div>';
    return;
  }
  const points = feedCache.slice(0, 20).slice().reverse();
  const W = 900, H = 220, padL = 30, padR = 16, padT = 16, padB = 14;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xFor = (i) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yFor = (v) => padT + (1 - v) * plotH;
  const baselineY = yFor(0);

  const xy = points.map((p, i) => [xFor(i), yFor(p.risk_score)]);
  const lineD = smoothPathD(xy);
  const areaD = `${lineD} L ${xy[xy.length - 1][0].toFixed(1)} ${baselineY.toFixed(1)} L ${xy[0][0].toFixed(1)} ${baselineY.toFixed(1)} Z`;

  const last = points[points.length - 1];
  const lastXY = xy[xy.length - 1];
  const lastPct = Math.round(last.risk_score * 100);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="riskTrendGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" style="stop-color:var(--series-1); stop-opacity:0.22" />
        <stop offset="100%" style="stop-color:var(--series-1); stop-opacity:0" />
      </linearGradient>
    </defs>`;
  [0, 0.3, 0.7, 1].forEach((v) => {
    const y = yFor(v).toFixed(1);
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" style="stroke:var(--gridline); stroke-width:1;" />`;
    svg += `<text x="${padL - 8}" y="${(Number(y) + 3).toFixed(1)}" text-anchor="end" style="fill:var(--text-muted); font-size:11px;">${v}</text>`;
  });
  svg += `<path d="${areaD}" style="fill:url(#riskTrendGradient); stroke:none;" />`;
  svg += `<path d="${lineD}" style="fill:none; stroke:var(--series-1); stroke-width:2; stroke-linejoin:round; stroke-linecap:round;" />`;
  svg += `<circle cx="${lastXY[0].toFixed(1)}" cy="${lastXY[1].toFixed(1)}" r="4" style="fill:var(--series-1); stroke:var(--surface); stroke-width:2;">
    <title>${escapeHtml(last.sender_id)} → ${escapeHtml(last.receiver_id)}: ${lastPct}% (${escapeHtml(last.decision)})</title>
  </circle>`;
  const labelBelow = lastXY[1] < padT + 14;
  const labelY = labelBelow ? lastXY[1] + 16 : lastXY[1] - 10;
  svg += `<text x="${(lastXY[0] - 8).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="end" style="fill:var(--text); font-size:12px; font-weight:600;">${lastPct}%</text>`;
  svg += `</svg>`;
  wrap.innerHTML = svg;
}

function sparklinePathD(values, W, H, pad) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xFor = (i) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const yFor = (v) => pad + (1 - (v - min) / range) * (H - pad * 2);
  return smoothPathD(values.map((v, i) => [xFor(i), yFor(v)]));
}

function renderSparklineInto(elId, values, color) {
  const el = document.getElementById(elId);
  if (values.length < 2) {
    el.innerHTML = "";
    return;
  }
  const d = sparklinePathD(values, 120, 26, 3);
  el.innerHTML = `<path d="${d}" style="fill:none; stroke:${color}; stroke-width:2; stroke-linecap:round; stroke-linejoin:round;" />`;
}

function renderStatSparklines() {
  const N = 12;
  const chrono = feedCache.slice().reverse();
  const recent = chrono.slice(-N);
  if (recent.length < 2) {
    ["stat-sparkline-tx", "stat-sparkline-alerts", "stat-sparkline-avg"].forEach((id) => {
      document.getElementById(id).innerHTML = "";
    });
    return;
  }
  const startCount = chrono.length - recent.length;
  const txCounts = recent.map((_, i) => startCount + i + 1);

  let blockedSoFar = chrono.slice(0, startCount).filter((e) => e.decision === "block").length;
  const alertCounts = recent.map((e) => {
    if (e.decision === "block") blockedSoFar++;
    return blockedSoFar;
  });

  const riskScores = recent.map((e) => e.risk_score);

  renderSparklineInto("stat-sparkline-tx", txCounts, "var(--series-1)");
  renderSparklineInto("stat-sparkline-alerts", alertCounts, "var(--status-critical)");
  renderSparklineInto("stat-sparkline-avg", riskScores, "var(--series-1)");
}

const CHANNEL_ORDER = ["UPI", "NEFT", "IMPS", "CARD"];
const CHANNEL_COLORS = {
  UPI: "var(--series-1)",
  NEFT: "var(--series-2)",
  IMPS: "var(--series-3)",
  CARD: "var(--series-4)",
};

function renderChannelDonut() {
  const wrap = document.getElementById("channel-donut");
  wrap.innerHTML = "";
  if (feedCache.length === 0) {
    wrap.innerHTML = '<div class="viz-empty">No transactions yet — score one or run a scenario.</div>';
    return;
  }
  const counts = { UPI: 0, NEFT: 0, IMPS: 0, CARD: 0 };
  feedCache.forEach((e) => {
    if (counts[e.channel] !== undefined) counts[e.channel]++;
  });
  const total = feedCache.length;

  const cx = 64, cy = 64, r = 48, strokeW = 16;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  let segments = "";
  CHANNEL_ORDER.forEach((label) => {
    const count = counts[label];
    if (count === 0) return;
    const frac = count / total;
    const dash = frac * circumference;
    segments += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" style="stroke:${CHANNEL_COLORS[label]}" stroke-width="${strokeW}"
      stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})">
      <title>${label}: ${count} (${Math.round(frac * 100)}%)</title>
    </circle>`;
    offset += dash;
  });

  const svg = `
    <svg class="donut-svg" viewBox="0 0 128 128">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" style="stroke:var(--surface-alt)" stroke-width="${strokeW}" />
      ${segments}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" style="fill:var(--text); font-size:22px; font-weight:700;">${total}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" style="fill:var(--text-muted); font-size:10px;">transactions</text>
    </svg>`;

  const legendRows = CHANNEL_ORDER.map((label) => `
    <div class="donut-legend-row">
      <span class="dot-label"><span class="legend-dot" style="background:${CHANNEL_COLORS[label]}"></span><span class="name">${label}</span></span>
      <span class="count">${counts[label]}</span>
    </div>`).join("");

  wrap.innerHTML = `<div class="donut-wrap">${svg}<div class="donut-legend">${legendRows}</div></div>`;
}

function formatAmountShort(v) {
  if (v >= 100000) return `₹${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
  return `₹${v}`;
}

function renderRiskScatter() {
  const wrap = document.getElementById("risk-scatter");
  if (feedCache.length === 0) {
    wrap.innerHTML = '<div class="viz-empty">No transactions yet — score one or run a scenario.</div>';
    return;
  }
  const W = 420, H = 220, padL = 30, padR = 14, padT = 14, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const amounts = feedCache.map((e) => Math.max(1, e.amount));
  const logMin = Math.floor(Math.log10(Math.min(...amounts)));
  const logMax = Math.ceil(Math.log10(Math.max(...amounts)));
  const domainMin = logMin, domainMax = Math.max(logMax, logMin + 1);

  const xFor = (amount) => padL + ((Math.log10(Math.max(1, amount)) - domainMin) / (domainMax - domainMin)) * plotW;
  const yFor = (score) => padT + (1 - score) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  [0, 0.3, 0.7, 1].forEach((v) => {
    const y = yFor(v).toFixed(1);
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" style="stroke:var(--gridline); stroke-width:1;" />`;
    svg += `<text x="${padL - 6}" y="${(Number(y) + 3).toFixed(1)}" text-anchor="end" style="fill:var(--text-muted); font-size:9px;">${v}</text>`;
  });
  for (let p = domainMin; p <= domainMax; p++) {
    const x = xFor(10 ** p).toFixed(1);
    svg += `<text x="${x}" y="${H - padB + 12}" text-anchor="middle" style="fill:var(--text-muted); font-size:9px;">${formatAmountShort(10 ** p)}</text>`;
  }
  feedCache.forEach((e) => {
    const cx = xFor(e.amount).toFixed(1);
    const cy = yFor(e.risk_score).toFixed(1);
    const tip = `${escapeHtml(e.sender_id)} → ${escapeHtml(e.receiver_id)}: ${formatAmountShort(e.amount)}, ${(e.risk_score * 100).toFixed(0)}% (${escapeHtml(e.decision)})`;
    svg += `<circle cx="${cx}" cy="${cy}" r="4" style="fill:${statusColor(e.decision)}; opacity:0.85; stroke:var(--surface); stroke-width:1.5;"><title>${tip}</title></circle>`;
  });
  svg += `</svg>`;
  wrap.innerHTML = svg;
}

function renderFeatureImportance() {
  const wrap = document.getElementById("feature-importance-chart");
  wrap.innerHTML = "";
  const withShap = feedCache.filter((e) => e.shap_values);
  if (withShap.length === 0) {
    wrap.innerHTML = '<div class="viz-empty">No transactions yet — score one or run a scenario.</div>';
    return;
  }
  const sums = {};
  withShap.forEach((e) => {
    Object.entries(e.shap_values).forEach(([name, val]) => {
      sums[name] = (sums[name] || 0) + Math.abs(val);
    });
  });
  const ranked = Object.entries(sums)
    .map(([name, sum]) => [name, sum / withShap.length])
    .sort((a, b) => b[1] - a[1]);
  const max = Math.max(0.0001, ...ranked.map(([, v]) => v));
  ranked.forEach(([name, avg]) => {
    const pct = (avg / max) * 100;
    const row = document.createElement("div");
    row.className = "viz-bar-row";
    row.innerHTML = `
      <div class="viz-bar-label" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="viz-bar-track"><div class="viz-bar-fill" style="width:${pct}%; background:var(--series-1);"></div></div>
      <div class="viz-bar-value">${avg.toFixed(2)}</div>
    `;
    wrap.appendChild(row);
  });
}

const DECISION_RANK = { block: 2, "step-up": 1, approve: 0 };

function renderTopSenders() {
  const wrap = document.getElementById("top-senders-table");
  wrap.innerHTML = "";
  if (feedCache.length === 0) {
    wrap.innerHTML = '<div class="viz-empty">No transactions yet — score one or run a scenario.</div>';
    return;
  }
  const bySender = {};
  feedCache.forEach((e) => {
    if (!bySender[e.sender_id]) {
      bySender[e.sender_id] = { count: 0, maxRisk: 0, worst: "approve", totalAmount: 0 };
    }
    const s = bySender[e.sender_id];
    s.count++;
    s.maxRisk = Math.max(s.maxRisk, e.risk_score);
    s.totalAmount += e.amount;
    if (DECISION_RANK[e.decision] > DECISION_RANK[s.worst]) s.worst = e.decision;
  });
  const ranked = Object.entries(bySender)
    .sort((a, b) => DECISION_RANK[b[1].worst] - DECISION_RANK[a[1].worst] || b[1].maxRisk - a[1].maxRisk)
    .slice(0, 6);

  const rows = ranked
    .map(([sender, s]) => `
      <tr>
        <td>${escapeHtml(sender)}</td>
        <td>${s.count}</td>
        <td>${(s.maxRisk * 100).toFixed(0)}%</td>
        <td>${formatAmountShort(Math.round(s.totalAmount))}</td>
        <td><span class="decision-badge ${decisionClass(s.worst)}">${escapeHtml(s.worst)}</span></td>
      </tr>`)
    .join("");

  wrap.innerHTML = `
    <div class="mini-table-wrap">
      <table>
        <thead><tr><th>Sender</th><th>Txns</th><th>Max risk</th><th>Total amount</th><th>Worst outcome</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function loadStats() {
  const res = await fetch("/api/v1/stats");
  const stats = await res.json();
  document.getElementById("stat-tx").textContent = stats.transactions;
  document.getElementById("stat-alerts").textContent = stats.alerts;
  document.getElementById("stat-avg").textContent = stats.avg_risk_score.toFixed(2);
}

async function loadFeed() {
  const res = await fetch("/api/v1/feed?limit=50");
  feedCache = await res.json();
  renderFeed();
}

async function submitScore(e) {
  e.preventDefault();
  const body = {
    transaction_id: "tx_" + Math.random().toString(16).slice(2, 10),
    sender_id: document.getElementById("f-sender").value,
    receiver_id: document.getElementById("f-receiver").value,
    amount: parseFloat(document.getElementById("f-amount").value),
    channel: document.getElementById("f-channel").value,
    timestamp: document.getElementById("f-timestamp").value,
  };
  const animation = animatePipeline();
  const res = await fetch("/api/v1/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  await animation;
  if (!res.ok) {
    alert("Scoring failed: " + JSON.stringify(result));
    return;
  }
  const entry = { ...body, ...result };
  renderResult(entry);
  prependFeedRow(entry);
  loadStats();
}

async function runScenario(scenario) {
  const animation = animatePipeline();
  const res = await fetch(`/api/v1/simulate/${scenario}`, { method: "POST" });
  const data = await res.json();
  await animation;
  if (!res.ok) {
    alert("Simulation failed: " + JSON.stringify(data));
    return;
  }
  data.results.forEach((r) => {
    feedCache.unshift(r);
  });
  renderFeed();
  if (data.results.length) {
    renderResult(data.results[data.results.length - 1]);
  }
  loadStats();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---- live threshold controls ----

let currentThresholds = { approve: 0.3, block: 0.7, puppetScore: 0.7, puppetAmount: 100000 };

function decisionForThresholds(entry, t) {
  let decision = entry.risk_score < t.approve ? "approve" : entry.risk_score < t.block ? "step-up" : "block";
  let flagged_reason = null;
  if (entry.puppet_score > t.puppetScore && (entry.session_amount_1h || 0) > t.puppetAmount) {
    decision = "block";
    flagged_reason = "puppet_signature";
  }
  return { decision, flagged_reason };
}

function recomputeFeedDecisions() {
  feedCache.forEach((e) => {
    const { decision, flagged_reason } = decisionForThresholds(e, currentThresholds);
    e.decision = decision;
    e.flagged_reason = flagged_reason;
  });
  renderFeed();
  if (lastResultEntry) renderResult(lastResultEntry);
}

function updateThresholdLabels() {
  document.getElementById("th-approve-val").textContent = currentThresholds.approve.toFixed(2);
  document.getElementById("th-block-val").textContent = currentThresholds.block.toFixed(2);
  document.getElementById("th-puppet-val").textContent = currentThresholds.puppetScore.toFixed(2);
  document.getElementById("th-amount-val").textContent = "₹" + Math.round(currentThresholds.puppetAmount).toLocaleString("en-IN");
}

const persistThresholds = debounce(async () => {
  const status = document.getElementById("th-status");
  status.textContent = "Saving…";
  try {
    const res = await fetch("/api/v1/admin/thresholds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approve_threshold: currentThresholds.approve,
        block_threshold: currentThresholds.block,
        puppet_score_threshold: currentThresholds.puppetScore,
        puppet_session_amount_threshold: currentThresholds.puppetAmount,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    status.textContent = "Applied — the next transaction scored will use these";
    setTimeout(() => {
      if (status.textContent.startsWith("Applied")) status.textContent = "";
    }, 2500);
  } catch (err) {
    status.textContent = "Couldn't save (approve must be ≤ block)";
  }
}, 400);

function onThresholdChange() {
  currentThresholds.approve = parseFloat(document.getElementById("th-approve").value);
  currentThresholds.block = parseFloat(document.getElementById("th-block").value);
  currentThresholds.puppetScore = parseFloat(document.getElementById("th-puppet").value);
  currentThresholds.puppetAmount = parseFloat(document.getElementById("th-amount").value);
  if (currentThresholds.approve > currentThresholds.block) {
    currentThresholds.block = currentThresholds.approve;
    document.getElementById("th-block").value = currentThresholds.block;
  }
  updateThresholdLabels();
  recomputeFeedDecisions();
  persistThresholds();
}

async function initThresholds() {
  try {
    const res = await fetch("/api/v1/admin/thresholds");
    const t = await res.json();
    currentThresholds = {
      approve: t.approve_threshold,
      block: t.block_threshold,
      puppetScore: t.puppet_score_threshold,
      puppetAmount: t.puppet_session_amount_threshold,
    };
  } catch (e) {
    /* keep defaults if the server isn't reachable yet */
  }
  document.getElementById("th-approve").value = currentThresholds.approve;
  document.getElementById("th-block").value = currentThresholds.block;
  document.getElementById("th-puppet").value = currentThresholds.puppetScore;
  document.getElementById("th-amount").value = currentThresholds.puppetAmount;
  updateThresholdLabels();
}

function setupThresholdControls() {
  ["th-approve", "th-block", "th-puppet", "th-amount"].forEach((id) => {
    document.getElementById(id).addEventListener("input", onThresholdChange);
  });
  document.getElementById("th-reset").addEventListener("click", () => {
    currentThresholds = { approve: 0.3, block: 0.7, puppetScore: 0.7, puppetAmount: 100000 };
    document.getElementById("th-approve").value = 0.3;
    document.getElementById("th-block").value = 0.7;
    document.getElementById("th-puppet").value = 0.7;
    document.getElementById("th-amount").value = 100000;
    updateThresholdLabels();
    recomputeFeedDecisions();
    persistThresholds();
  });
}

// ---- what-if amount slider (live preview, nothing saved) ----

const AMOUNT_MIN = 100;
const AMOUNT_MAX = 200000;

function sliderToAmount(pos) {
  return Math.round(AMOUNT_MIN * Math.pow(AMOUNT_MAX / AMOUNT_MIN, pos / 100));
}

function amountToSlider(amount) {
  return (100 * Math.log(Math.max(AMOUNT_MIN, amount) / AMOUNT_MIN)) / Math.log(AMOUNT_MAX / AMOUNT_MIN);
}

const previewScore = debounce(async () => {
  const timestamp = document.getElementById("f-timestamp").value;
  const amount = parseFloat(document.getElementById("f-amount").value);
  if (!timestamp || !amount || amount <= 0) return;
  const body = {
    transaction_id: "preview_" + Math.random().toString(16).slice(2, 8),
    sender_id: document.getElementById("f-sender").value || "preview_user",
    receiver_id: document.getElementById("f-receiver").value || "preview_receiver",
    amount,
    channel: document.getElementById("f-channel").value,
    timestamp,
  };
  try {
    const res = await fetch("/api/v1/score/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) return;
    renderResult({ ...body, ...result }, true);
  } catch (e) {
    /* transient preview failure — leave last shown result as-is */
  }
}, 300);

function setupAmountSlider() {
  const numberInput = document.getElementById("f-amount");
  const slider = document.getElementById("f-amount-slider");
  slider.value = amountToSlider(parseFloat(numberInput.value));

  slider.addEventListener("input", () => {
    numberInput.value = sliderToAmount(parseFloat(slider.value));
    previewScore();
  });
  numberInput.addEventListener("input", () => {
    const amount = parseFloat(numberInput.value);
    if (!isNaN(amount)) slider.value = amountToSlider(amount);
    previewScore();
  });
  ["f-sender", "f-receiver", "f-channel", "f-timestamp"].forEach((id) => {
    document.getElementById(id).addEventListener("input", previewScore);
    document.getElementById(id).addEventListener("change", previewScore);
  });
}

// ---- auto-play live traffic ----

let autoplayTimer = null;
const AUTO_SENDERS = ["auto_user_1", "auto_user_2", "auto_user_3", "auto_user_4"];
const AUTO_RECEIVERS = ["merchant_grocery", "merchant_electric_co", "friend_raj", "landlord_flat3b"];
const AUTO_CHANNELS_NORMAL = ["UPI", "UPI", "UPI", "NEFT", "IMPS"];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomAutoTransaction() {
  const spike = Math.random() < 0.15;
  const now = new Date();
  if (spike && Math.random() < 0.5) now.setHours(randomChoice([1, 2, 3, 23]));
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return {
    transaction_id: "auto_" + Math.random().toString(16).slice(2, 10),
    sender_id: randomChoice(AUTO_SENDERS),
    receiver_id: spike ? `new_receiver_${Math.random().toString(16).slice(2, 7)}` : randomChoice(AUTO_RECEIVERS),
    amount: spike ? Math.round(20000 + Math.random() * 60000) : Math.round(300 + Math.random() * 3000),
    channel: spike ? randomChoice(["IMPS", "NEFT"]) : randomChoice(AUTO_CHANNELS_NORMAL),
    timestamp: now.toISOString().slice(0, 19),
  };
}

async function autoplayTick() {
  const body = randomAutoTransaction();
  try {
    const res = await fetch("/api/v1/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (res.ok) {
      prependFeedRow({ ...body, ...result });
      loadStats();
    }
  } catch (e) {
    /* transient error — keep the loop alive */
  }
  if (autoplayTimer !== null) {
    autoplayTimer = setTimeout(autoplayTick, 1800);
  }
}

function setAutoplayUI(playing) {
  document.getElementById("autoplay-toggle").classList.toggle("playing", playing);
  document.getElementById("autoplay-label").textContent = playing ? "Pause live traffic" : "Start live traffic";
}

function toggleAutoplay() {
  if (autoplayTimer !== null) {
    clearTimeout(autoplayTimer);
    autoplayTimer = null;
    setAutoplayUI(false);
  } else {
    autoplayTimer = -1;
    setAutoplayUI(true);
    autoplayTick();
  }
}

function setupDisclaimerModal() {
  const overlay = document.getElementById("disclaimer-overlay");
  const closeBtn = document.getElementById("disclaimer-close");
  const reopenBtn = document.getElementById("disclaimer-reopen");

  const close = () => overlay.classList.add("hidden");
  const open = () => overlay.classList.remove("hidden");

  closeBtn.addEventListener("click", close);
  reopenBtn.addEventListener("click", open);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setDefaultTimestamp();
  setupDisclaimerModal();
  setupTabs();
  setupAmountSlider();
  setupThresholdControls();
  document.getElementById("autoplay-toggle").addEventListener("click", toggleAutoplay);
  renderShapStemplot(null);
  initThresholds();
  loadFeed();
  loadStats();
  document.getElementById("score-form").addEventListener("submit", submitScore);
  document.querySelectorAll("[data-scenario]").forEach((btn) => {
    btn.addEventListener("click", () => runScenario(btn.dataset.scenario));
  });
});
