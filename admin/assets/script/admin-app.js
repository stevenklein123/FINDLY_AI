import { requireAdmin, adminFetch } from "./admin-common.js";

const DEFAULT_AVATAR = "../assets/avatar.jpg";
const FALLBACK_AVATAR =
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150";

const $ = (sel) => document.querySelector(sel);
const statEls = document.querySelectorAll("[data-stat]");
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

(async function init() {
  const session = await requireAdmin();
  if (!session) return;

  renderProfile(session.user);
  statEls.forEach((el) => el.classList.add("is-loading"));
  await loadStats();
})();
