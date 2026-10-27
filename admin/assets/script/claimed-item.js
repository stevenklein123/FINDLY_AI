import { supabase } from "./supabase-client.js";
import { requireAdmin, subscribeToTables } from "./admin-common.js";
import { el, itemCard } from "./item-card.js";

const list = document.querySelector("#list");

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const message = (text, isError = false) =>
  list.replaceChildren(
    el("p", { class: `status${isError ? " status--error" : ""}` }, text),
  );

function claimedPanel(match) {
  const badge = el("span", { class: "badge", title: "Claimed" });
  badge.innerHTML = CHECK_SVG; // static markup, no user data

  return el(
    "section",
    { class: "pair pair--claimed" },
    itemCard(match.lost, "lost"),
    itemCard(match.found, "found"),
    badge,
  );
}

async function load() {
  const { data, error } = await supabase
    .from("admin_matches")
    .select("*")
    .eq("status", "claimed")
    .order("claimed_at", { ascending: false });

  if (error)
    return message(`Couldn't load claimed items: ${error.message}`, true);
  if (!data.length) return message("Nothing has been claimed yet.");
  list.replaceChildren(...data.map(claimedPanel));
}

(async function init() {
  if (!(await requireAdmin())) return;
  message("Loading…");
  await load();
  subscribeToTables("claimed-page", ["matches"], load);
})();
