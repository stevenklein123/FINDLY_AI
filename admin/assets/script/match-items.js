import { supabase } from "./supabase-client.js";
import { requireAdmin, subscribeToTables } from "./admin-common.js";
import { el, itemCard } from "./item-card.js";

const list = document.querySelector("#list");

const message = (text, isError = false) =>
  list.replaceChildren(
    el("p", { class: `status${isError ? " status--error" : ""}` }, text),
  );

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
    el("span", { class: "score__label" }, `${pct}%`),
  );
}

function matchPanel(match) {
  const button = el("button", { class: "claim-btn", type: "button" }, "CLAIM");

  button.addEventListener("click", async () => {
    const owner = match.lost.full_name || "the owner";
    if (!confirm(`Mark "${match.lost.item_name}" as claimed by ${owner}?`))
      return;

    button.disabled = true;
    const { error } = await supabase.rpc("claim_match", {
      p_match_id: match.id,
    });
    if (error) {
      alert(`Couldn't claim: ${error.message}`);
      button.disabled = false;
      return;
    }
    load();
  });

  return el(
    "section",
    { class: "pair" },
    itemCard(match.lost, "lost"),
    itemCard(match.found, "found"),
    scoreBar(match.score),
    button,
  );
}

async function load() {
  const { data, error } = await supabase
    .from("admin_matches")
    .select("*")
    .in("status", ["pending", "confirmed"])
    .order("score", { ascending: false });

  if (error) return message(`Couldn't load matches: ${error.message}`, true);
  if (!data.length) return message("No matches yet.");
  list.replaceChildren(...data.map(matchPanel));
}

(async function init() {
  if (!(await requireAdmin())) return;
  message("Loading…");
  await load();
  subscribeToTables(
    "matches-page",
    ["matches", "found_items", "claim_items"],
    load,
  );
})();
