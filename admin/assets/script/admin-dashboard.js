import { supabase } from "./supabase-client.js";
import { requireAdmin, subscribeToTables } from "./admin-common.js";

const DEFAULT_AVATAR = "../assets/avatar.jpg";
const FALLBACK_AVATAR =
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150";

const $ = (sel) => document.querySelector(sel);
const statEls = document.querySelectorAll("[data-stat]");
const pad = (n) => String(n ?? 0).padStart(2, "0");

function renderProfile({ display_name, avatar_url }) {
  $("#admin-name").textContent = display_name || "Admin";

  const img = $("#admin-avatar");
  img.onerror = () => {
    img.onerror = null; // iwas infinite loop
    img.src = FALLBACK_AVATAR;
  };
  img.src = avatar_url || DEFAULT_AVATAR;
}

async function loadStats() {
  const { data, error } = await supabase.rpc("admin_dashboard_stats");
  if (error) {
    console.error("Failed to load stats:", error.message);
    return;
  }

  const stats = Array.isArray(data) ? data[0] : data;
  statEls.forEach((el) => {
    el.textContent = pad(stats?.[el.dataset.stat]);
    el.classList.remove("is-loading");
  });
}

(async function init() {
  const admin = await requireAdmin();
  if (!admin) return;

  renderProfile(admin);
  statEls.forEach((el) => el.classList.add("is-loading"));
  await loadStats();

  // Real updates: kahit anong bago/pagbabago sa tables, mag-re-count agad.
  subscribeToTables(
    "admin-dashboard",
    ["found_items", "claim_items", "matches"],
    loadStats,
  );
})();
