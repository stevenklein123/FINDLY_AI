import { requireAdmin, adminFetch } from "./admin-common.js";
import { el, itemCard } from "./item-card.js";

const list = document.querySelector("#list");

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const message = (text, isError = false) => {
  if (list) {
    list.replaceChildren(
      el("p", { class: `status${isError ? " status--error" : ""}` }, text),
    );
  }
};

function claimedPanel(match) {
  const badge = el("span", { class: "badge", title: "Claimed" });
  badge.innerHTML = CHECK_SVG;

  return el(
    "section",
    { class: "pair pair--claimed" },
    itemCard(match.lost_items, "lost"),
    itemCard(match.found_items, "found"),
    badge,
  );
}

async function loadClaimed() {
  message("Loading claimed items from server…");
  try {
    const data = await adminFetch("/admin/list/claimed");
    if (!Array.isArray(data)) {
      return message("Failed to parse claimed items from backend.", true);
    }
    if (!data.length) {
      return message("Nothing has been claimed yet.");
    }
    list.replaceChildren(...data.map(claimedPanel));
  } catch (err) {
    console.error("Claimed items load error:", err);
    message(`Could not load claimed items: ${err.message}`, true);
  }
}

(async function init() {
  const session = await requireAdmin();
  if (!session) return;
  await loadClaimed();
})();
