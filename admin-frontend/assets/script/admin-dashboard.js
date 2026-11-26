import { requireAdmin, adminFetch, logoutAdmin } from "./admin-common.js";

const DEFAULT_AVATAR = "../assets/avatar.jpg";
const FALLBACK_AVATAR =
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150";

const $ = (sel) => document.querySelector(sel);
const statEls = document.querySelectorAll("[data-stat]");
const perfEls = document.querySelectorAll("[data-perf]");
const pad = (n) => String(n ?? 0).padStart(2, "0");

function renderProfile(user) {
  const name =
    user.user_metadata?.full_name ||
    (user.email ? user.email.split("@")[0] : "Admin");
  const nameEl = $("#admin-name");
  if (nameEl) nameEl.textContent = name;

  const img = $("#admin-avatar");
  if (img) {
    img.onerror = () => {
      img.onerror = null;
      img.src = FALLBACK_AVATAR;
    };
    img.src = user.user_metadata?.avatar_url || DEFAULT_AVATAR;
  }
}

async function loadStats() {
  try {
    const stats = await adminFetch("/admin/summary");
    if (!stats) return;

    statEls.forEach((el) => {
      const key = el.dataset.stat;
      el.textContent = pad(stats[key]);
      el.classList.remove("is-loading");
    });
  } catch (err) {
    console.error("Failed to load dashboard stats from backend:", err);
    statEls.forEach((el) => {
      el.textContent = "!";
      el.classList.remove("is-loading");
    });
  }
}

// ---------------------------------------------------------------------------
// AR101: Performance metrics
// ---------------------------------------------------------------------------
function fmtMs(v) {
  if (v < 0.1) return `${(v * 1000).toFixed(1)} µs`;
  if (v < 1000) return `${Number(v.toFixed(3))} ms`;
  return `${(v / 1000).toFixed(2)} s`;
}

const FORMATTERS = {
  hours: (v) => {
    if (v < 1 / 60) return `${(v * 3600).toFixed(0)} sec`;
    if (v < 1) return `${(v * 60).toFixed(1)} min`;
    if (v < 48) return `${v.toFixed(1)} hrs`;
    return `${(v / 24).toFixed(1)} days`;
  },
  ms: fmtMs,
  us: (v) => `${v} µs`,
  sec: (v) => `${v} s`,
  x: (v) => `${Number(v).toLocaleString()}×`,
  pct: (v) => `${(v * 100).toFixed(1)}%`,
  num: (v) => Number(v).toLocaleString(),
  text: (v) => String(v),
};

function getPath(obj, path) {
  return path.split(".").reduce((o, key) => (o == null ? o : o[key]), obj);
}

function setStatus(text) {
  const status = $("#perf-status");
  if (status) status.textContent = text;
}

function renderPerformance(data) {
  perfEls.forEach((el) => {
    const value = getPath(data, el.dataset.perf);
    const format = FORMATTERS[el.dataset.fmt] || FORMATTERS.text;
    el.textContent = value == null ? "--" : format(value);
  });

  const matches = data.time_to_find?.count ?? 0;
  const hits = data.cache?.hits ?? 0;
  const misses = data.cache?.misses ?? 0;
  if (matches === 0) {
    setStatus("No matches yet, so there is nothing to measure.");
  } else if (hits === 0 || misses === 0) {
    setStatus(
      "Cache and speedup numbers need at least one hit and one miss. Click \"Refresh metrics\" within the cache lifetime.",
    );
  } else {
    setStatus(`Based on ${matches} match(es) and ${hits + misses} dashboard requests.`);
  }
}

async function loadPerformance() {
  try {
    const data = await adminFetch("/admin/performance");
    if (!data) return;
    renderPerformance(data);
  } catch (err) {
    console.error("Failed to load performance metrics:", err);
    setStatus(
      "Could not load performance metrics. Check that the backend is running with the new code.",
    );
  }
}

function addCell(row, text) {
  const td = document.createElement("td");
  td.textContent = text;
  row.appendChild(td);
}

function renderBenchmark(result) {
  const body = $("#bench-body");
  if (!body) return;
  body.textContent = "";
  const dash = (v, f) => (v == null ? "--" : f(v));

  result.setups.forEach((s) => {
    const row = document.createElement("tr");
    addCell(row, s.name);
    addCell(row, s.requests);
    addCell(row, s.hits);
    addCell(row, s.misses);
    addCell(row, FORMATTERS.pct(s.hit_ratio));
    addCell(row, dash(s.hit_time_ms, fmtMs));
    addCell(row, dash(s.miss_penalty_ms, fmtMs));
    addCell(row, dash(s.amat_ms, fmtMs));
    addCell(row, dash(s.avg_ms, fmtMs));
    addCell(row, dash(s.speedup, FORMATTERS.x));
    body.appendChild(row);
  });
}

async function runBenchmark(btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Running (a few seconds)...";
  try {
    const result = await adminFetch("/admin/benchmark?n=10");
    if (result) renderBenchmark(result);
  } catch (err) {
    console.error("Benchmark failed:", err);
    setStatus("The benchmark could not run. Check that the backend is running with the new code.");
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

(async function init() {
  const session = await requireAdmin();
  if (!session) return;

  renderProfile(session.user);
  statEls.forEach((el) => el.classList.add("is-loading"));
  await loadStats();
  await loadPerformance();

  // Refresh: re-reads the counts (a cache hit or miss), then the metrics
  const refreshBtn = $("#perfRefreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      await loadStats();
      await loadPerformance();
      refreshBtn.disabled = false;
    });
  }

  // Cache benchmark (3 setups, read-only)
  const benchBtn = $("#perfBenchBtn");
  if (benchBtn) {
    benchBtn.addEventListener("click", () => runBenchmark(benchBtn));
  }

  // Attach logout handler
  const logoutBtn = $("#adminLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      logoutBtn.textContent = "Signing out...";
      await logoutAdmin();
    });
  }
})();