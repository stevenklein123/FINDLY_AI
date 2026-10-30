import { requireAdmin, adminFetch } from "./admin-common.js";
import { el, itemCard } from "./item-card.js";

const list = document.querySelector("#list");

const message = (text, isError = false) => {
  if (list) {
    list.replaceChildren(
      el("p", { class: `status${isError ? " status--error" : ""}` }, text),
    );
  }
};

function scoreBar(score) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  return el(
    "div",
    {
      class: "score",
      role: "meter",
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": pct,
    },
    el("div", { class: "score__mask", style: `width:${100 - pct}%` }),
    el("span", { class: "score__label" }, `Match Score: ${pct}%`),
  );
}

function matchPanel(match) {
  const isClaimed = match.status === "claimed";
  const lostItem = match.claim_items;
  const foundItem = match.found_items;

  const children = [
    itemCard(lostItem, "lost"),
    itemCard(foundItem, "found"),
    scoreBar(match.score),
  ];

  if (!isClaimed) {
    const claimBtn = el(
      "button",
      { class: "claim-btn", type: "button" },
      match.status === "pending" ? "Approve Claim" : "Mark as Claimed",
    );

    claimBtn.addEventListener("click", async () => {
      const itemName = lostItem?.item_name || foundItem?.item_name || "this item";
      if (!confirm(`Mark "${itemName}" as CLAIMED in the system?`)) return;

      claimBtn.disabled = true;
      claimBtn.textContent = "Processing…";

      try {
        const res = await adminFetch(`/admin/claim/${match.id}`, {
          method: "POST",
        });
        if (res?.ok) {
          alert("Successfully marked as claimed!");
          await loadMatches();
        } else {
          alert("Failed to mark as claimed.");
          claimBtn.disabled = false;
          claimBtn.textContent = "Mark as Claimed";
        }
      } catch (err) {
        console.error("Claim error:", err);
        alert(`Error: ${err.message}`);
        claimBtn.disabled = false;
        claimBtn.textContent = "Mark as Claimed";
      }
    });

    children.push(claimBtn);
  } else {
    children.push(
      el(
        "p",
        {
          class: "status",
          style: "color: #16a34a; font-weight: bold; margin: 0.5rem 0;",
        },
        "✓ ALREADY CLAIMED",
      ),
    );
  }

  return el("section", { class: "pair" }, ...children);
}

async function loadMatches() {
  message("Loading matches from server…");
  try {
    const data = await adminFetch("/admin/list/match_items");
    if (!Array.isArray(data)) {
      return message("Failed to parse matches from backend.", true);
    }
    if (!data.length) {
      return message("No match records found.");
    }
    list.replaceChildren(...data.map(matchPanel));
  } catch (err) {
    console.error("Match load error:", err);
    message(`Could not load matches: ${err.message}`, true);
  }
}

(async function init() {
  const session = await requireAdmin();
  if (!session) return;
  await loadMatches();
})();
